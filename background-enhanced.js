// 增强版后台脚本：集成pdf.js实现完整功能
'use strict';

// 存储已下载的论文信息
let downloadedPapers = [];

// 从storage加载已下载论文列表
chrome.storage.local.get(['papers'], (result) => {
  if (result.papers) {
    downloadedPapers = result.papers;
  }
});

// 加载pdf.js（在background中使用）
let pdfjsLib = null;
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  
  try {
    // 使用CDN加载pdf.js
    const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    const script = await response.text();
    eval(script); // 在background中执行
    
    pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    
    return pdfjsLib;
  } catch (error) {
    console.error('[论文助手] 加载pdf.js失败:', error);
    // 如果CDN失败，尝试使用本地文件
    return null;
  }
}

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadPdf') {
    handlePdfDownload(request.url, request.pageUrl, request.pageTitle);
    sendResponse({ success: true });
  }
  return true;
});

// 处理PDF下载
async function handlePdfDownload(pdfUrl, pageUrl, pageTitle) {
  try {
    console.log('[论文助手] 开始下载PDF:', pdfUrl);
    
    // 第一阶段：先尝试从URL直接解析PDF（不下载）
    try {
      const paperInfo = await parsePdfFromUrl(pdfUrl);
      console.log('[论文助手] PDF元数据提取成功:', paperInfo);
      
      // 如果解析成功，再下载文件
      downloadAndRename(pdfUrl, paperInfo, pageUrl, pageTitle);
    } catch (error) {
      console.log('[论文助手] 从URL解析失败，使用下载方式:', error);
      // 如果从URL解析失败，使用原来的下载方式
      downloadPdfFile(pdfUrl, pageUrl, pageTitle);
    }
    
  } catch (error) {
    console.error('[论文助手] 处理失败:', error);
  }
}

// 从URL直接解析PDF（不下载）
async function parsePdfFromUrl(url) {
  await loadPdfJs();
  
  if (!pdfjsLib) {
    throw new Error('pdf.js未加载');
  }
  
  try {
    const loadingTask = pdfjsLib.getDocument({
      url: url,
      withCredentials: false
    });
    const pdf = await loadingTask.promise;
    
    // 提取元数据
    const metadata = await pdf.getMetadata();
    const info = metadata.info || {};
    
    // 提取前500字符
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 3);
    
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + ' ';
      
      if (fullText.length >= 500) {
        break;
      }
    }
    
    const first500Chars = fullText.substring(0, 500);
    
    // 提取日期
    const extractedDate = extractDateFromText(first500Chars + ' ' + (info.Title || ''));
    
    // 提取第一作者
    const firstAuthor = extractFirstAuthor(first500Chars, info);
    
    return {
      title: info.Title || '',
      author: info.Author || '',
      keywords: info.Keywords ? info.Keywords.split(/[,;]/).map(k => k.trim()) : [],
      extractedDate: extractedDate,
      firstAuthor: firstAuthor || info.Author || '',
      first500Chars: first500Chars,
      creationDate: info.CreationDate || '',
      modDate: info.ModDate || ''
    };
    
  } catch (error) {
    console.error('[论文助手] 解析PDF失败:', error);
    throw error;
  }
}

// 从文本中提取日期
function extractDateFromText(text) {
  const dateKeywords = [
    'Communicated by',
    'Received',
    'Published in',
    'Accepted',
    'Submitted',
    'Available online',
    'Published',
    'Date of publication',
    'Received date',
    'Accepted date',
    'Publication date'
  ];
  
  const datePatterns = [
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/g,
    /(\d{1,2}[-/]\d{1,2}[-/]\d{4})/g,
    /([A-Z][a-z]+ \d{1,2}, \d{4})/g,
    /(\d{4})/g
  ];
  
  let foundDate = null;
  
  for (const keyword of dateKeywords) {
    const keywordIndex = text.indexOf(keyword);
    if (keywordIndex !== -1) {
      const context = text.substring(keywordIndex, keywordIndex + 100);
      
      for (const pattern of datePatterns) {
        const match = context.match(pattern);
        if (match) {
          foundDate = match[0];
          break;
        }
      }
      
      if (foundDate) break;
    }
  }
  
  if (!foundDate) {
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        foundDate = match[0];
        break;
      }
    }
  }
  
  return foundDate || null;
}

// 提取第一作者
function extractFirstAuthor(text, metadata) {
  if (metadata.author) {
    const authors = metadata.author.split(/[,;]/);
    return authors[0].trim();
  }
  
  const authorPatterns = [
    /^([A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+)/,
    /^([A-Z][a-z]+, [A-Z]\.)/,
    /Author[s]?:\s*([^\n]+)/i,
    /By:\s*([^\n]+)/i
  ];
  
  for (const pattern of authorPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return null;
}

// 下载并重命名文件
async function downloadAndRename(pdfUrl, paperInfo, pageUrl, pageTitle) {
  const date = paperInfo.extractedDate || paperInfo.creationDate || '未知日期';
  const author = paperInfo.firstAuthor || paperInfo.author || '未知作者';
  const title = paperInfo.title || '未知标题';
  
  // 清理文件名
  const cleanDate = date.replace(/[<>:"/\\|?*]/g, '_').substring(0, 20);
  const cleanAuthor = author.replace(/[<>:"/\\|?*]/g, '_').substring(0, 30);
  const cleanTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
  
  const newFileName = `${cleanDate}_${cleanAuthor}_${cleanTitle}.pdf`;
  
  // 下载文件
  chrome.downloads.download({
    url: pdfUrl,
    filename: newFileName,
    conflictAction: 'uniquify',
    saveAs: false
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('[论文助手] 下载失败:', chrome.runtime.lastError);
      return;
    }
    
    // 监听下载完成
    chrome.downloads.onChanged.addListener(function listener(delta) {
      if (delta.id === downloadId && delta.state && delta.state.current === 'complete') {
        chrome.downloads.onChanged.removeListener(listener);
        
        chrome.downloads.search({ id: downloadId }, (results) => {
          if (results && results[0]) {
            const filePath = results[0].filename;
            
            // 保存论文信息
            const paperData = {
              ...paperInfo,
              originalUrl: pdfUrl,
              pageUrl: pageUrl,
              pageTitle: pageTitle,
              downloadId: downloadId,
              filePath: filePath,
              downloadTime: new Date().toISOString()
            };
            
            downloadedPapers.push(paperData);
            chrome.storage.local.set({ papers: downloadedPapers });
            
            console.log('[论文助手] 论文已保存:', paperData);
            
            // 通知popup更新
            chrome.runtime.sendMessage({
              action: 'paperDownloaded',
              paper: paperData
            });
          }
        });
      }
    });
  });
}

// 原始下载方式（备用）
function downloadPdfFile(pdfUrl, pageUrl, pageTitle) {
  chrome.downloads.download({
    url: pdfUrl,
    saveAs: false,
    conflictAction: 'uniquify'
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('[论文助手] 下载失败:', chrome.runtime.lastError);
      return;
    }
    
    chrome.downloads.onChanged.addListener(function listener(delta) {
      if (delta.id === downloadId && delta.state && delta.state.current === 'complete') {
        chrome.downloads.onChanged.removeListener(listener);
        
        chrome.downloads.search({ id: downloadId }, (results) => {
          if (results && results[0]) {
            const filePath = results[0].filename;
            
            // 保存基本信息
            const paperData = {
              title: '待提取',
              author: '待提取',
              date: '待提取',
              originalUrl: pdfUrl,
              pageUrl: pageUrl,
              pageTitle: pageTitle,
              downloadId: downloadId,
              filePath: filePath,
              downloadTime: new Date().toISOString()
            };
            
            downloadedPapers.push(paperData);
            chrome.storage.local.set({ papers: downloadedPapers });
          }
        });
      }
    });
  });
}

