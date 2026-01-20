// PDF解析模块：使用pdf.js提取论文信息
'use strict';

// 加载pdf.js库（需要从CDN或本地文件加载）
let pdfjsLib = null;

// 初始化pdf.js
async function initPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  
  // 尝试从本地加载
  try {
    // 这里需要先下载pdf.js库文件
    // 或者使用CDN版本
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    document.head.appendChild(script);
    
    return new Promise((resolve) => {
      script.onload = () => {
        pdfjsLib = window.pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(pdfjsLib);
      };
    });
  } catch (error) {
    console.error('加载pdf.js失败:', error);
    throw error;
  }
}

// 从文件路径读取PDF（在background script中使用）
async function parsePdfFromFile(filePath) {
  // 注意：由于浏览器安全限制，需要将文件转换为ArrayBuffer
  // 这里提供一个接口，实际实现需要根据浏览器API调整
  return {
    metadata: await extractMetadata(filePath),
    text: await extractText(filePath)
  };
}

// 从URL读取PDF
async function parsePdfFromUrl(url) {
  await initPdfJs();
  
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    
    // 提取元数据
    const metadata = await pdf.getMetadata();
    
    // 提取文本（前500字符）
    const text = await extractFirst500Chars(pdf);
    
    return {
      metadata: metadata.info || {},
      text: text
    };
  } catch (error) {
    console.error('解析PDF失败:', error);
    throw error;
  }
}

// 提取PDF元数据
async function extractMetadata(pdf) {
  try {
    const metadata = await pdf.getMetadata();
    return {
      title: metadata.info?.Title || '',
      author: metadata.info?.Author || '',
      subject: metadata.info?.Subject || '',
      keywords: metadata.info?.Keywords || '',
      creator: metadata.info?.Creator || '',
      producer: metadata.info?.Producer || '',
      creationDate: metadata.info?.CreationDate || '',
      modDate: metadata.info?.ModDate || ''
    };
  } catch (error) {
    console.error('提取元数据失败:', error);
    return {};
  }
}

// 提取PDF前500字符
async function extractFirst500Chars(pdf) {
  try {
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 3); // 最多读取前3页
    
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + ' ';
      
      if (fullText.length >= 500) {
        break;
      }
    }
    
    return fullText.substring(0, 500);
  } catch (error) {
    console.error('提取文本失败:', error);
    return '';
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
  
  // 日期正则表达式（匹配多种格式）
  const datePatterns = [
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/g,  // YYYY-MM-DD
    /(\d{1,2}[-/]\d{1,2}[-/]\d{4})/g,  // MM-DD-YYYY
    /([A-Z][a-z]+ \d{1,2}, \d{4})/g,   // Month DD, YYYY
    /(\d{4})/g                          // YYYY
  ];
  
  let foundDate = null;
  
  // 先查找关键词附近的日期
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
  
  // 如果没找到，在整个文本中搜索日期
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

// 从文本中提取第一作者
function extractFirstAuthor(text, metadata) {
  // 优先从元数据获取
  if (metadata.author) {
    const authors = metadata.author.split(/[,;]/);
    return authors[0].trim();
  }
  
  // 从文本中提取（常见模式）
  const authorPatterns = [
    /^([A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+)/,  // First M. Last
    /^([A-Z][a-z]+, [A-Z]\.)/,              // Last, F.
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

// 导出函数
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parsePdfFromUrl,
    extractDateFromText,
    extractFirstAuthor,
    extractFirst500Chars
  };
}

