// 验证报告页面脚本
'use strict';

let isVerifying = false;
let verificationResults = [];
let currentTab = null;

// 提取文件名前缀（用于显示）- 固定输出前2个字符加*
function getFilePrefix(fileName) {
  if (!fileName) return '';
  
  // 去掉文件扩展名
  let nameWithoutExt = fileName;
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex > 0) {
    nameWithoutExt = fileName.substring(0, lastDotIndex);
  }
  
  // 固定取前2个字符，然后加上*
  const prefix = nameWithoutExt.substring(0, 2);
  return prefix ? prefix + '*' : '';
}

// 标准化日期字符串为 YYYY-MM-DD 格式
function normalizeDateString(dateStr) {
  if (!dateStr) return '';
  
  // 处理中文日期格式：YYYY年MM月DD日 或 YYYY年MM月
  const chineseDateMatch = dateStr.match(/(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日?)?/);
  if (chineseDateMatch) {
    const year = chineseDateMatch[1];
    const month = String(chineseDateMatch[2]).padStart(2, '0');
    const day = chineseDateMatch[3] ? String(chineseDateMatch[3]).padStart(2, '0') : '15'; // 如果没有日期，默认15号
    return `${year}-${month}-${day}`;
  }
  
  // 如果已经是YYYY-MM-DD格式
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // 处理 "Month DD, YYYY" 格式 (如: "August 9, 2025")
  const monthDayYearMatch = dateStr.match(/([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthDayYearMatch) {
    const monthNames = {
      'January': '01', 'February': '02', 'March': '03', 'April': '04',
      'May': '05', 'June': '06', 'July': '07', 'August': '08',
      'September': '09', 'October': '10', 'November': '11', 'December': '12'
    };
    const month = monthNames[monthDayYearMatch[1]];
    if (month) {
      const day = monthDayYearMatch[2].padStart(2, '0');
      const year = monthDayYearMatch[3];
      return `${year}-${month}-${day}`;
    }
  }
  
  // 处理 "DD Month YYYY" 格式 (如: "9 August 2025")
  const dayMonthYearMatch = dateStr.match(/(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})/);
  if (dayMonthYearMatch) {
    const monthNames = {
      'January': '01', 'February': '02', 'March': '03', 'April': '04',
      'May': '05', 'June': '06', 'July': '07', 'August': '08',
      'September': '09', 'October': '10', 'November': '11', 'December': '12'
    };
    const month = monthNames[dayMonthYearMatch[2]];
    if (month) {
      const day = dayMonthYearMatch[1].padStart(2, '0');
      const year = dayMonthYearMatch[3];
      return `${year}-${month}-${day}`;
    }
  }
  
  // 处理 YYYY-MM-DD 或 YYYY/MM/DD 格式
  const ymdMatch = dateStr.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // 如果无法解析，返回原字符串
  return dateStr;
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('startVerifyBtn').addEventListener('click', startVerification);
  document.getElementById('stopVerifyBtn').addEventListener('click', stopVerification);
  document.getElementById('exportBtn').addEventListener('click', exportReport);
  
  // 设置拖放事件（仅PDF文件）
  const fileUploadArea = document.getElementById('fileUploadArea');
  if (fileUploadArea) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      fileUploadArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    
    ['dragenter', 'dragover'].forEach(eventName => {
      fileUploadArea.addEventListener(eventName, () => {
        fileUploadArea.style.borderColor = '#667eea';
        fileUploadArea.style.background = '#e6eafc';
      });
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
      fileUploadArea.addEventListener(eventName, () => {
        fileUploadArea.style.borderColor = '#ccc';
        fileUploadArea.style.background = '#f9f9f9';
      });
    });
    
    fileUploadArea.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        const jsonFile = files.find(file => 
          file.type === 'application/json' || file.name.toLowerCase().endsWith('.json')
        );
        const pdfFiles = files.filter(file => 
          file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        );
        
        if (jsonFile) {
          console.log('[验证页面] 检测到拖放的JSON文件:', jsonFile.name);
          await handleJsonFileUpload(jsonFile);
        } else if (pdfFiles.length > 0) {
          // 如果拖放的是PDF文件，直接处理（恢复之前的直接拖放功能）
          console.log('[验证页面] 检测到拖放的PDF文件（直接验证模式）:', pdfFiles.map(f => f.name));
          await handlePdfFilesUpload(pdfFiles);
        } else {
          alert('请拖入PDF文件');
        }
      }
    });
  }
  
  // 设置PDF文件上传区域（用于手动上传无法访问的文件）
  const pdfUploadArea = document.getElementById('pdfUploadArea');
  const pdfFileInput = document.getElementById('pdfFileInput');
  const pdfFileSelectBtn = document.getElementById('pdfFileSelectBtn');
  
  if (pdfFileSelectBtn && pdfFileInput) {
    pdfFileSelectBtn.addEventListener('click', () => {
      pdfFileInput.click();
    });
  }
  
  if (pdfFileInput) {
    pdfFileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        await handlePdfFilesUpload(files);
      }
    });
  }
  
  if (pdfUploadArea) {
    // 设置拖放事件
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      pdfUploadArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    
    ['dragenter', 'dragover'].forEach(eventName => {
      pdfUploadArea.addEventListener(eventName, () => {
        pdfUploadArea.style.borderColor = '#28a745';
        pdfUploadArea.style.background = '#d4edda';
      });
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
      pdfUploadArea.addEventListener(eventName, () => {
        pdfUploadArea.style.borderColor = '#28a745';
        pdfUploadArea.style.background = '#f0fff4';
      });
    });
    
    pdfUploadArea.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer.files).filter(file => 
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      );
      if (files.length > 0) {
        console.log('[验证页面] 检测到拖放的PDF文件:', files.map(f => f.name));
        await handlePdfFilesUpload(files);
      } else {
        alert('请拖入PDF文件');
      }
    });
  }
  
  // 检查是否有单个论文验证请求
  chrome.storage.local.get(['singlePaperVerification'], (result) => {
    if (result.singlePaperVerification) {
      const { paper, downloadedFiles } = result.singlePaperVerification;
      console.log('[验证页面] 检测到单个论文验证请求:', paper);
      console.log('[验证页面] 关联的文件:', downloadedFiles);
      
      // 保存论文信息到currentVerificationPaper，以便拖放文件时使用
      chrome.storage.local.set({ currentVerificationPaper: paper }, () => {
        console.log('[验证页面] 已保存论文信息，可以拖放文件进行验证');
      });
      
      // 检查是否有可用的文件
      const availableFiles = (downloadedFiles || []).filter(f => f.url && !f.url.startsWith('file://'));
      
      if (availableFiles.length > 0) {
        // 如果有可用文件，自动开始验证
        console.log('[验证页面] 找到可用文件，自动开始验证');
        startSinglePaperVerification(paper, availableFiles);
      } else {
        // 如果没有可用文件，显示PDF上传区域，让用户拖放文件
        console.log('[验证页面] 未找到可用文件，显示上传区域');
        showPdfUploadArea(paper);
        updateProgress(0, '请拖入PDF文件进行验证（支持多个文件）');
        
        // 更新上传区域的提示信息
        const pdfUploadArea = document.getElementById('pdfUploadArea');
        if (pdfUploadArea) {
          const infoDiv = pdfUploadArea.querySelector('div[style*="margin-bottom: 10px; color: #666; font-size: 14px;"]');
          if (infoDiv) {
            infoDiv.innerHTML = `论文信息已加载，请拖入PDF文件进行验证：<br>• ${paper.title || '未知标题'}<br>• 第一作者: ${paper.firstAuthor || '未知'}<br>• 日期: ${paper.date || '未知'}`;
          }
        }
      }
      
      // 清除存储
      chrome.storage.local.remove('singlePaperVerification');
    } else {
      // 显示开始验证按钮
      const startBtn = document.getElementById('startVerifyBtn');
      if (startBtn) {
        startBtn.style.display = 'none';
      }
      document.getElementById('progressText').textContent = '准备开始验证...';
    }
  });
});

// 查找arXiv论文详情页面的标签页
function findArxivPaperTab() {
  chrome.tabs.query({}, (tabs) => {
    // 优先查找包含arxiv.org/abs/的标签页（论文详情页）
    let arxivTab = tabs.find(tab => tab.url && tab.url.includes('arxiv.org/abs/'));
    
    // 如果没有找到详情页，尝试查找列表页（向后兼容）
    if (!arxivTab) {
      arxivTab = tabs.find(tab => tab.url && tab.url.includes('arxiv.org/list/'));
    }
    
    if (arxivTab) {
      currentTab = arxivTab;
      if (arxivTab.url.includes('arxiv.org/abs/')) {
        document.getElementById('progressText').textContent = `已找到arXiv论文页面: ${arxivTab.title}`;
      } else {
        document.getElementById('progressText').textContent = `已找到arXiv列表页面: ${arxivTab.title}`;
      }
    } else {
      // 如果没有找到arXiv页面，检查是否有已保存的论文可以验证
      chrome.storage.local.get(['papers'], (result) => {
        const papers = result.papers || [];
        if (papers.length > 0) {
          // 有已保存的论文，允许从论文列表验证
          document.getElementById('startVerifyBtn').disabled = false;
          document.getElementById('progressText').textContent = `已找到 ${papers.length} 篇已保存的论文，可以开始验证`;
        } else {
          document.getElementById('startVerifyBtn').disabled = true;
          document.getElementById('progressText').textContent = '请先打开arXiv论文详情页面（如 https://arxiv.org/abs/2512.21231）或列表页面，或者先保存一些论文到列表';
        }
      });
    }
  });
}

// 开始验证
async function startVerification() {
  if (isVerifying) return;
  
  isVerifying = true;
  verificationResults = [];
  
  document.getElementById('startVerifyBtn').disabled = true;
  document.getElementById('stopVerifyBtn').disabled = false;
  document.getElementById('resultsList').innerHTML = '';
  
  updateStats(0, 0, 0);
  updateProgress(0, '正在提取论文信息...');
  
  try {
    let papers = [];
    
    // 如果找到了arXiv页面，使用页面验证
    if (currentTab && currentTab.url) {
      // 如果是论文详情页（/abs/），直接验证当前论文
      if (currentTab.url.includes('arxiv.org/abs/')) {
      updateProgress(10, '正在从当前页面提取论文信息...');
      
      // 从当前页面提取论文元数据
      const metadata = await extractCurrentPageMetadata();
      
      if (!metadata || !metadata.arxivId) {
        throw new Error('无法从页面提取论文信息，请确保在arXiv论文详情页面');
      }
      
      // 构造PDF URL
      const pdfUrl = `https://arxiv.org/pdf/${metadata.arxivId}.pdf`;
      
      // 构造论文对象
      const paper = {
        title: metadata.title || '未知标题',
        firstAuthor: metadata.firstAuthor || '',
        authors: metadata.authors || [],
        date: metadata.date || '',
        arxivId: metadata.arxivId,
        pdfUrl: pdfUrl,
        pageUrl: currentTab.url
      };
      
      papers = [paper];
      updateStats(1, 0, 0);
      updateProgress(20, `开始验证: ${paper.title.substring(0, 50)}...`);
      
      } else if (currentTab.url.includes('arxiv.org/list/')) {
        // 如果是列表页，提取所有论文
        updateProgress(10, '正在提取论文列表...');
        papers = await extractPapersFromPage();
        
        if (!papers || papers.length === 0) {
          throw new Error('未找到论文列表');
        }
        
        updateStats(papers.length, 0, 0);
        updateProgress(20, `找到 ${papers.length} 篇论文，开始验证...`);
      }
    }
    
    // 如果没有找到arXiv页面，从已保存的论文列表验证
    if (papers.length === 0) {
      updateProgress(10, '正在从已保存的论文列表加载...');
      
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['papers'], resolve);
      });
      
      papers = (result.papers || []).map(paper => {
        // 尝试从webMetadata中获取文件链接
        let pdfUrl = paper.originalUrl || paper.pageUrl || '';
        
        // 如果pdfUrl是网页URL而不是PDF文件URL，尝试从webMetadata中获取
        if (pdfUrl && !pdfUrl.toLowerCase().endsWith('.pdf') && !pdfUrl.includes('/pdf/')) {
          // 检查webMetadata中是否有fileLinks
          if (paper.webMetadata && paper.webMetadata.fileLinks && paper.webMetadata.fileLinks.length > 0) {
            // 优先使用PDF文件
            const pdfFile = paper.webMetadata.fileLinks.find(f => 
              f.name && f.name.toLowerCase().endsWith('.pdf')
            );
            if (pdfFile && pdfFile.url) {
              pdfUrl = pdfFile.url;
            } else if (paper.webMetadata.fileLinks[0] && paper.webMetadata.fileLinks[0].url) {
              pdfUrl = paper.webMetadata.fileLinks[0].url;
            }
          }
        }
        
        return {
          title: paper.title || '未知标题',
          firstAuthor: paper.firstAuthor || '未知作者',
          authors: paper.authors || paper.allAuthors || [],
          date: paper.date || paper.extractedDate || '',
          pdfUrl: pdfUrl,
          pageUrl: paper.pageUrl || '',
          webMetadata: paper.webMetadata || {
            title: paper.title,
            firstAuthor: paper.firstAuthor,
            authors: paper.authors || paper.allAuthors || [],
            date: paper.date || paper.extractedDate,
            fileLinks: paper.webMetadata?.fileLinks || []
          }
        };
      });
      
      if (papers.length === 0) {
        throw new Error('未找到已保存的论文，请先保存一些论文到列表');
      }
      
      updateStats(papers.length, 0, 0);
      updateProgress(20, `找到 ${papers.length} 篇已保存的论文，开始验证...`);
    }
    
    // 对每篇论文执行验证
    for (let i = 0; i < papers.length; i++) {
      if (!isVerifying) break; // 检查是否停止
      
      const paper = papers[i];
      const progress = 20 + (i / papers.length) * 80;
      updateProgress(progress, `正在验证: ${paper.title.substring(0, 50)}...`);
      
      try {
        const result = await verifyPaper(paper);
        verificationResults.push(result);
        
        // 更新统计（只要有一个匹配项成功就算匹配成功）
        const matchCount = verificationResults.filter(r => 
          r.matchResult && (r.matchResult.authorMatch || r.matchResult.dateMatch || r.matchResult.titleMatch)
        ).length;
        
        updateStats(papers.length, i + 1, matchCount);
        renderResult(result);
        
      } catch (error) {
        console.error(`验证论文失败: ${paper.title}`, error);
        const errorResult = {
          ...paper,
          error: error.message,
          matchResult: null
        };
        verificationResults.push(errorResult);
        renderResult(errorResult);
      }
      
      // 延迟以避免过快请求
      await sleep(500);
    }
    
    updateProgress(100, '验证完成！');
    
  } catch (error) {
    console.error('验证过程失败:', error);
    updateProgress(0, `错误: ${error.message}`);
  } finally {
    isVerifying = false;
    document.getElementById('startVerifyBtn').disabled = false;
    document.getElementById('stopVerifyBtn').disabled = true;
  }
}

// 停止验证
function stopVerification() {
  isVerifying = false;
  document.getElementById('startVerifyBtn').disabled = false;
  document.getElementById('stopVerifyBtn').disabled = true;
  updateProgress(0, '验证已停止');
}

// 从页面提取论文列表
function extractPapersFromPage() {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(currentTab.id, { action: 'extractListPapers' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.papers) {
        resolve(response.papers);
      } else {
        reject(new Error('无法提取论文列表'));
      }
    });
  });
}

// 从当前页面提取单篇论文的元数据（用于验证）
function extractCurrentPageMetadata() {
  return new Promise((resolve, reject) => {
    if (!currentTab) {
      reject(new Error('未找到arXiv论文页面'));
      return;
    }
    
    // 检查是否是arXiv论文详情页
    if (!currentTab.url.includes('arxiv.org/abs/')) {
      reject(new Error('请先打开arXiv论文详情页面'));
      return;
    }
    
    chrome.tabs.sendMessage(currentTab.id, { action: 'extractArxivMetadata' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.metadata) {
        resolve(response.metadata);
      } else {
        reject(new Error('无法从页面提取论文信息'));
      }
    });
  });
}

// 验证单篇论文（支持多个文件）
async function verifyPaper(paper, providedFiles = []) {
  // 如果paper.webMetadata已存在，直接使用，不需要从页面提取
  let webMetadata = paper.webMetadata || null;
  let pageTab = null;
  
  // 如果没有webMetadata，才尝试从页面提取
  if (!webMetadata) {
    try {
      // 如果paper有pageUrl，尝试从该页面提取元数据
      if (paper.pageUrl && paper.pageUrl.includes('arxiv.org/abs/')) {
        // 打开或切换到该论文页面
        pageTab = await new Promise((resolve, reject) => {
          chrome.tabs.query({ url: paper.pageUrl }, (tabs) => {
            if (tabs && tabs.length > 0) {
              resolve(tabs[0]);
            } else {
              // 如果标签页不存在，创建新标签页
              chrome.tabs.create({ url: paper.pageUrl, active: false }, (tab) => {
                // 等待页面加载
                setTimeout(() => resolve(tab), 2000);
              });
            }
          });
        });
        
        // 从页面提取元数据
        webMetadata = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(pageTab.id, { action: 'extractArxivMetadata' }, (response) => {
            if (chrome.runtime.lastError) {
              console.warn('[验证] 无法从页面提取元数据，使用列表中的信息:', chrome.runtime.lastError);
              // 如果提取失败，使用列表中的信息
              resolve({
                firstAuthor: paper.firstAuthor || '',
                allAuthors: paper.authors || [],
                date: paper.date || '',
                title: paper.title || '',
                arxivId: paper.arxivId || ''
              });
            } else if (response && response.metadata) {
              resolve(response.metadata);
            } else {
              // 使用列表中的信息作为备用
              resolve({
                firstAuthor: paper.firstAuthor || '',
                allAuthors: paper.authors || [],
                date: paper.date || '',
                title: paper.title || '',
                arxivId: paper.arxivId || ''
              });
            }
          });
        });
      } else {
        // 如果没有pageUrl，使用列表中的信息
        webMetadata = {
          firstAuthor: paper.firstAuthor || '',
          allAuthors: paper.authors || [],
          date: paper.date || '',
          title: paper.title || '',
          arxivId: paper.arxivId || ''
        };
      }
    } catch (error) {
      console.warn('[验证] 提取网页元数据失败，使用列表中的信息:', error);
      webMetadata = {
        firstAuthor: paper.firstAuthor || '',
        allAuthors: paper.authors || [],
        date: paper.date || '',
        title: paper.title || '',
        arxivId: paper.arxivId || ''
      };
    }
  }
  
  // 如果有日期，尝试解析并提取所有日期信息
  if (webMetadata.date) {
    try {
      const parsedDate = new Date(webMetadata.date);
      if (!isNaN(parsedDate.getTime())) {
        const year = parsedDate.getFullYear();
        const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
        const day = String(parsedDate.getDate()).padStart(2, '0');
        // 提交日期通常作为received日期
        webMetadata.dates = {
          received: `${year}-${month}-${day}`,
          accepted: null,
          published: null,
          other: []
        };
      }
    } catch (e) {
      console.warn('[验证] 日期解析失败:', e);
    }
  }
  
  // 查找要验证的文件（优先使用提供的文件，然后使用webMetadata.fileLinks）
  let filesToVerify = [];
  
  // 方法0：使用提供的已下载文件（从popup传递过来的）
  if (providedFiles && providedFiles.length > 0) {
    for (const file of providedFiles) {
      if (file.url || file.downloadId) {
        // 如果有downloadId，尝试从Chrome下载历史获取文件URL
        if (file.downloadId && !file.url) {
          try {
            const downloads = await new Promise((resolve) => {
              chrome.downloads.search({ id: file.downloadId }, resolve);
            });
            if (downloads && downloads.length > 0 && downloads[0].url && 
                !downloads[0].url.startsWith('blob:') && !downloads[0].url.startsWith('file:')) {
              filesToVerify.push({ 
                name: file.name || downloads[0].filename.split(/[/\\]/).pop() || '文件', 
                url: downloads[0].url, 
                type: 'pdf',
                downloadId: file.downloadId,
                label: file.label || ''
              });
            } else if (downloads && downloads.length > 0 && downloads[0].filename) {
              // 如果是本地文件，标记为需要手动加载
              filesToVerify.push({ 
                name: file.name || downloads[0].filename.split(/[/\\]/).pop() || '文件', 
                url: 'file://' + downloads[0].filename.replace(/\\/g, '/'), 
                type: 'pdf',
                downloadId: file.downloadId,
                label: file.label || '',
                isLocalFile: true
              });
            }
          } catch (e) {
            console.warn('[验证] 无法获取下载文件信息:', e);
          }
        } else if (file.url) {
          filesToVerify.push({ 
            name: file.name || '文件', 
            url: file.url, 
            type: 'pdf',
            downloadId: file.downloadId,
            label: file.label || ''
          });
        }
      }
    }
    console.log('[验证页面] 从providedFiles找到文件:', filesToVerify);
  }
  
  // 方法1：从webMetadata.fileLinks获取文件（最多3个）
  if (filesToVerify.length === 0 && webMetadata && webMetadata.fileLinks && webMetadata.fileLinks.length > 0) {
    filesToVerify = webMetadata.fileLinks
      .filter(f => f.fileUrl && (f.fileUrl.toLowerCase().endsWith('.pdf') || f.fileUrl.includes('/pdf/') || f.fileName && f.fileName.toLowerCase().endsWith('.pdf')))
      .slice(0, 3)
      .map(f => ({
        name: f.fileName || f.label || 'PDF',
        url: f.fileUrl,
        type: 'pdf',
        downloadId: f.downloadId,
        label: f.label || ''
      }));
    console.log('[验证页面] 从webMetadata找到文件链接:', filesToVerify);
  }
  
  // 方法2：如果从webMetadata没找到，尝试从页面查找
  if (filesToVerify.length === 0 && pageTab) {
    try {
      const filesResponse = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(pageTab.id, { action: 'findConfiguredFiles' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response || { files: [] });
          }
        });
      });
      
      filesToVerify = (filesResponse.files || []).slice(0, 3); // 最多3个文件
      console.log('[验证页面] 从页面找到配置的文件:', filesToVerify);
    } catch (error) {
      console.warn('[验证页面] 查找配置文件失败:', error);
    }
  }
  
  // 如果还是没找到，检查paper.pdfUrl是否是有效的PDF URL
  if (filesToVerify.length === 0 && paper.pdfUrl) {
    // 检查是否是有效的PDF URL
    if (paper.pdfUrl.toLowerCase().endsWith('.pdf') || paper.pdfUrl.includes('/pdf/')) {
      filesToVerify = [{ name: 'PDF', url: paper.pdfUrl, type: 'pdf' }];
    } else {
      console.warn('[验证页面] paper.pdfUrl不是有效的PDF URL:', paper.pdfUrl);
      // 如果pdfUrl是网页URL，无法验证，返回错误
      return {
        ...paper,
        error: '未找到有效的PDF文件URL，无法进行验证',
        matchResult: null
      };
    }
  }
  
  // 如果文件少于3个且paper.pdfUrl是有效的PDF，补充默认PDF
  if (filesToVerify.length < 3 && paper.pdfUrl && 
      (paper.pdfUrl.toLowerCase().endsWith('.pdf') || paper.pdfUrl.includes('/pdf/')) &&
      !filesToVerify.find(f => f.url === paper.pdfUrl)) {
    filesToVerify.push({ name: 'PDF', url: paper.pdfUrl, type: 'pdf', label: '论文全文' });
  }
  
  // 如果还是没有文件，返回错误（但允许手动上传）
  if (filesToVerify.length === 0) {
    return {
      ...paper,
      error: '未找到可验证的文件，请手动上传PDF文件',
      matchResult: null,
      allowManualUpload: true
    };
  }
  
  // 验证每个文件（最多3个）
  const fileResults = [];
  let overallAuthorMatch = false; // 只要有一个文件匹配作者就通过
  let overallDateMatch = false; // 只要有一个文件匹配日期就通过
  let overallTitleMatch = false; // 只要有一个文件匹配标题就通过
  
  // 记录匹配成功的文件信息
  let matchedAuthorFile = null; // { fileName, fileLabel, matchResult }
  let matchedDateFile = null;
  let matchedTitleFile = null;
  
  // 验证所有文件（不限制数量，处理所有提供的文件）
  for (let i = 0; i < filesToVerify.length; i++) {
    const file = filesToVerify[i];
    console.log(`[验证页面] 验证文件 ${i + 1}/${filesToVerify.length}: ${file.name} (${file.url})`);
    
    try {
      const fileResult = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('验证超时（60秒）'));
        }, 60000);
        
        chrome.runtime.sendMessage({
          action: 'verifyPaper',
          pdfUrl: file.url,
          pageUrl: paper.pageUrl || currentTab?.url || '',
          webMetadata: webMetadata,
          fileInfo: { 
            name: file.name, 
            type: file.type,
            filePath: file.filePath,
            downloadId: file.downloadId
          }
        }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            resolve(response.result);
          } else {
            reject(new Error(response?.error || '验证失败'));
          }
        });
      });
      
      fileResult.fileName = file.name || '未知文件';
      fileResult.fileUrl = file.url;
      fileResult.fileLabel = file.label || '';
      fileResults.push(fileResult);
      
      console.log(`[验证页面] 文件 ${i + 1} 验证完成:`, {
        fileName: fileResult.fileName,
        authorMatch: fileResult.matchResult?.authorMatch,
        dateMatch: fileResult.matchResult?.dateMatch,
        titleMatch: fileResult.matchResult?.titleMatch
      });
      
      // 检查每个匹配项（作者、日期、标题），只要有一个文件匹配就记录
      if (fileResult.matchResult) {
        // 检查作者匹配
        if (fileResult.matchResult.authorMatch && !overallAuthorMatch) {
          overallAuthorMatch = true;
          matchedAuthorFile = {
            fileName: fileResult.fileName,
            fileLabel: fileResult.fileLabel,
            matchResult: fileResult.matchResult
          };
          console.log(`[验证页面] 作者匹配成功，文件: ${fileResult.fileName}`);
        }
        
        // 检查日期匹配
        if (fileResult.matchResult.dateMatch && !overallDateMatch) {
          overallDateMatch = true;
          matchedDateFile = {
            fileName: fileResult.fileName,
            fileLabel: fileResult.fileLabel,
            matchResult: fileResult.matchResult
          };
          console.log(`[验证页面] 日期匹配成功，文件: ${fileResult.fileName}`);
        }
        
        // 检查标题匹配
        if (fileResult.matchResult.titleMatch && !overallTitleMatch) {
          overallTitleMatch = true;
          matchedTitleFile = {
            fileName: fileResult.fileName,
            fileLabel: fileResult.fileLabel,
            matchResult: fileResult.matchResult
          };
          console.log(`[验证页面] 标题匹配成功，文件: ${fileResult.fileName}`);
        }
      }
    } catch (error) {
      console.error(`[验证页面] 文件 ${file.name} 验证失败:`, error);
      fileResults.push({
        fileName: file.name,
        fileUrl: file.url,
        fileLabel: file.label || '',
        error: error.message,
        matchResult: null
      });
      // 继续处理下一个文件，不中断循环
    }
  }
  
  console.log(`[验证页面] 所有文件验证完成，共 ${fileResults.length} 个文件，匹配结果:`, {
    overallAuthorMatch,
    overallDateMatch,
    overallTitleMatch,
    matchedAuthorFile: matchedAuthorFile?.fileName,
    matchedDateFile: matchedDateFile?.fileName,
    matchedTitleFile: matchedTitleFile?.fileName
  });
  
  // 只要有一个文件匹配了作者、标题或日期中的任意一个，就算整体匹配成功
  const overallMatch = overallAuthorMatch || overallDateMatch || overallTitleMatch;
  
  // 返回合并的验证结果
  return {
    title: paper.title || '未知标题',
    firstAuthor: webMetadata.firstAuthor || '',
    authors: webMetadata.allAuthors || [],
    date: webMetadata.date || '',
    arxivId: paper.arxivId || '',
    pageUrl: paper.pageUrl || currentTab?.url || '',
    files: fileResults,
    overallMatch: overallMatch, // 只要有一个文件匹配了任意一项就通过
    matchResult: {
      authorMatch: overallAuthorMatch,
      dateMatch: overallDateMatch,
      titleMatch: overallTitleMatch,
      // 记录匹配成功的文件信息
      matchedAuthorFile: matchedAuthorFile,
      matchedDateFile: matchedDateFile,
      matchedTitleFile: matchedTitleFile
    }
  };
}

// 更新统计信息
function updateStats(total, processed, matched) {
  document.getElementById('totalCount').textContent = total;
  document.getElementById('processedCount').textContent = processed;
  document.getElementById('matchCount').textContent = matched;
}

// 更新进度
function updateProgress(percent, text) {
  document.getElementById('progressFill').style.width = percent + '%';
  document.getElementById('progressText').textContent = text;
}

// 渲染单个结果
function renderResult(result) {
  const resultsList = document.getElementById('resultsList');
  
  // 移除空状态
  const emptyState = resultsList.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }
  
  const item = document.createElement('div');
  item.className = 'result-item';
  item.setAttribute('data-paper-title', escapeHtml(result.title || '未知标题'));
  
  if (result.error) {
    item.classList.add('pending');
  } else if (result.overallMatch !== undefined) {
    if (result.overallMatch) {
      item.classList.add('match');
    } else {
      item.classList.add('mismatch');
    }
  } else {
    item.classList.add('pending');
  }
  
  const matchStatus = result.error ? 
    '<span class="match-status pending">错误</span>' :
    (result.overallMatch !== undefined ? 
      (result.overallMatch ?
        '<span class="match-status success">✓ 匹配成功</span>' :
        '<span class="match-status failed">✗ 匹配失败</span>') :
      '<span class="match-status pending">处理中...</span>');
  
  // 不再显示每个文件的详细结果，只显示三个匹配区块
  
  // 如果只有一个文件（向后兼容），使用原来的显示方式
  const matchResult = result.matchResult || (result.files && result.files[0] ? result.files[0].matchResult : {});
  const dateMatchDetails = matchResult.dateMatchDetails || null;
  const authorMatchDetails = matchResult.authorMatchDetails || {};
  const titleMatchDetails = matchResult.titleMatchDetails || {};
  
  // 检查是否有错误信息
  const pdfTextError = result.pdfTextData && result.pdfTextData.error ? result.pdfTextData.error : null;
  const ocrError = result.ocrData && result.ocrData.error ? result.ocrData.error : null;
  
  // 构建日期匹配结果HTML（显示匹配的文件）
  let dateMatchHtml = '';
  if (dateMatchDetails || result.matchResult) {
    const matchResult = result.matchResult || {};
    const dateMatched = matchResult.dateMatch || false;
    const matchedDateFile = matchResult.matchedDateFile;
    
    // 从所有文件中收集日期信息
    let allDates = [];
    let webDate = '';
    let webDateNormalized = '';
    
    // 首先从result对象获取日期（优先级最高）
    if (result && result.paper) {
      webDate = result.paper.date || result.paper.extractedDate || '';
    }
    if (!webDate && result && result.date) {
      webDate = result.date;
    }
    
    // 按文件分组收集日期信息
    const datesByFile = [];
    if (result.files && result.files.length > 0) {
      result.files.forEach(file => {
        if (file.matchResult && file.matchResult.dateMatchDetails) {
          const details = file.matchResult.dateMatchDetails;
          const fileName = file.fileName || '';
          const filePrefix = getFilePrefix(fileName);
          const fileLabel = file.fileLabel || filePrefix;
          
          // 使用第一个文件的webDate和webDateNormalized
          if (!webDate && details.webDate) {
            webDate = details.webDate;
          }
          if (!webDateNormalized && details.webDateNormalized) {
            webDateNormalized = details.webDateNormalized;
          }
          
          // 收集该文件的所有日期
          const fileDates = [];
          if (details.allPdfDates && details.allPdfDates.length > 0) {
            fileDates.push(...details.allPdfDates);
          }
          if (details.allOcrDates && details.allOcrDates.length > 0) {
            fileDates.push(...details.allOcrDates);
          }
          
          if (fileDates.length > 0) {
            datesByFile.push({
              filePrefix: filePrefix,
              fileName: fileName,
              fileLabel: fileLabel,
              dates: fileDates
            });
          }
        }
      });
    }
    
    // 如果没有从文件中获取到，使用dateMatchDetails（这种情况通常没有文件信息）
    if (datesByFile.length === 0 && dateMatchDetails) {
      // 尝试从matchedDateFile获取文件名
      const dateFile = matchedDateFile || (result.files && result.files[0]);
      const fileName = dateFile?.fileName || '';
      const filePrefix = getFilePrefix(fileName);
      const fileLabel = dateFile?.fileLabel || filePrefix;
      
      const fileDates = [];
      if (dateMatchDetails.allPdfDates && dateMatchDetails.allPdfDates.length > 0) {
        fileDates.push(...dateMatchDetails.allPdfDates);
      }
      if (dateMatchDetails.allOcrDates && dateMatchDetails.allOcrDates.length > 0) {
        fileDates.push(...dateMatchDetails.allOcrDates);
      }
      
      if (fileDates.length > 0) {
        datesByFile.push({
          filePrefix: filePrefix,
          fileName: fileName,
          fileLabel: fileLabel,
          dates: fileDates
        });
      }
      
      webDate = dateMatchDetails.webDate || webDate;
      webDateNormalized = dateMatchDetails.webDateNormalized || webDateNormalized;
    }
    
    // 确保webDate总是有值（最后的后备方案）
    if (!webDate) {
      webDate = '未提取';
    }
    
    if (dateMatched && matchedDateFile) {
      // 匹配成功，显示匹配的文件
      const fileDisplayName = matchedDateFile.fileLabel ? 
        `${matchedDateFile.fileLabel} (${matchedDateFile.fileName})` : 
        matchedDateFile.fileName;
      dateMatchHtml = `
        <div class="result-detail-item">
          <div class="result-detail-label"><span style="color: #28a745;">✓</span> 日期匹配结果</div>
          <div class="result-detail-value">
            <span style="color: #28a745;">✓ 匹配成功</span><br>
            <span style="font-size: 12px; color: #666;">匹配文件：${escapeHtml(fileDisplayName)}</span><br>
            网页日期：${escapeHtml(webDate || '未提取')}${webDateNormalized ? `（标准化日期：${escapeHtml(webDateNormalized)}）` : ''}<br>
            ${datesByFile.length > 0 ? datesByFile.map(fileInfo => {
              const datesStr = fileInfo.dates.map(d => `${d.type}: ${d.original}`).join(', ');
              return `${fileInfo.filePrefix}.pdf中所有日期: ${datesStr}`;
            }).join('<br>') : '未提取'}
          </div>
        </div>
      `;
    } else {
      // 未匹配
      dateMatchHtml = `
        <div class="result-detail-item">
          <div class="result-detail-label">日期匹配结果</div>
          <div class="result-detail-value">
            <span style="color: #dc3545;">✗ 未匹配</span><br>
            网页日期：${escapeHtml(webDate || '未提取')}${webDateNormalized ? `（标准化日期：${escapeHtml(webDateNormalized)}）` : ''}<br>
            ${datesByFile.length > 0 ? datesByFile.map(fileInfo => {
              const datesStr = fileInfo.dates.map(d => `${d.type}: ${d.original}`).join(', ');
              return `${fileInfo.filePrefix}.pdf中所有日期: ${datesStr}`;
            }).join('<br>') : '未提取'}
          </div>
        </div>
      `;
    }
  } else {
    // 没有日期匹配详情，尝试从matchResult获取
    const matchResult = result.matchResult || {};
    const dateMatched = matchResult.dateMatch || false;
    const matchedDateFile = matchResult.matchedDateFile;
    
    // 初始化webDate变量（在else分支中需要重新定义）
    let webDate = '';
    let webDateNormalized = '';
    
    // 确保webDate有值
    if (!webDate) {
      webDate = result.paper?.date || result.paper?.extractedDate || result.date || '未提取';
    }
    
    // 按文件分组收集日期信息（从result.files）
    const datesByFileElse = [];
    if (result.files && result.files.length > 0) {
      result.files.forEach(file => {
        if (file.matchResult && file.matchResult.dateMatchDetails) {
          const details = file.matchResult.dateMatchDetails;
          const fileName = file.fileName || '';
          const filePrefix = getFilePrefix(fileName);
          const fileLabel = file.fileLabel || filePrefix;
          
          const fileDates = [];
          if (details.allPdfDates && details.allPdfDates.length > 0) {
            fileDates.push(...details.allPdfDates);
          }
          if (details.allOcrDates && details.allOcrDates.length > 0) {
            fileDates.push(...details.allOcrDates);
          }
          
          if (fileDates.length > 0) {
            datesByFileElse.push({
              filePrefix: filePrefix,
              fileName: fileName,
              fileLabel: fileLabel,
              dates: fileDates
            });
          }
        }
      });
    }
    
    if (dateMatched && matchedDateFile) {
      const fileDisplayName = matchedDateFile.fileLabel ? 
        `${matchedDateFile.fileLabel} (${matchedDateFile.fileName})` : 
        matchedDateFile.fileName;
      dateMatchHtml = `
        <div class="result-detail-item">
          <div class="result-detail-label"><span style="color: #28a745;">✓</span> 日期匹配结果</div>
          <div class="result-detail-value">
            <span style="color: #28a745; font-weight: bold;">✓ 匹配成功</span><br>
            <span class="detail-text">匹配文件：${escapeHtml(fileDisplayName)}</span><br>
            <span class="detail-text">网页日期：${escapeHtml(webDate || '未提取')}${webDateNormalized ? `（标准化日期：${escapeHtml(webDateNormalized)}）` : ''}</span><br>
            ${datesByFileElse.length > 0 ? datesByFileElse.map(fileInfo => {
              const datesStr = fileInfo.dates.map(d => `${d.type}: ${d.original}`).join(', ');
              return `<span class="detail-text">${fileInfo.filePrefix}.pdf中所有日期: ${datesStr}</span>`;
            }).join('<br>') : '<span class="detail-text">未提取</span>'}
          </div>
        </div>
      `;
    } else {
      dateMatchHtml = `
        <div class="result-detail-item">
          <div class="result-detail-label">日期匹配结果</div>
          <div class="result-detail-value">
            <span style="color: #dc3545; font-weight: bold;">✗ 未匹配</span><br>
            <span class="detail-text">网页日期：${escapeHtml(webDate || '未提取')}${webDateNormalized ? `（标准化日期：${escapeHtml(webDateNormalized)}）` : ''}</span><br>
            ${datesByFileElse.length > 0 ? datesByFileElse.map(fileInfo => {
              const datesStr = fileInfo.dates.map(d => `${d.type}: ${d.original}`).join(', ');
              return `<span class="detail-text">${fileInfo.filePrefix}.pdf中所有日期: ${datesStr}</span>`;
            }).join('<br>') : '<span class="detail-text">未提取</span>'}
          </div>
        </div>
      `;
    }
  }
  
  // 构建作者匹配结果HTML（按文件分组显示）
  let authorMatchHtml = '';
  const authorMatchedStatus = matchResult.authorMatch || false;
  const matchedAuthorFile = matchResult.matchedAuthorFile;
  
  // 按文件分组收集作者信息
  const authorsByFile = [];
  let webAuthor = '';
  
  if (result.files && result.files.length > 0) {
    result.files.forEach(file => {
      if (file.matchResult && file.matchResult.authorMatchDetails) {
        const details = file.matchResult.authorMatchDetails;
        const fileName = file.fileName || '';
        const filePrefix = getFilePrefix(fileName);
        const fileLabel = file.fileLabel || filePrefix;
        
        // 使用第一个文件的webAuthor
        if (!webAuthor && details.webAuthor) {
          webAuthor = details.webAuthor;
        }
        
        const pdfAuthor = details.pdfFirstAuthor || details.ocrFirstAuthor || '未提取';
        authorsByFile.push({
          filePrefix: filePrefix,
          fileName: fileName,
          fileLabel: fileLabel,
          pdfAuthor: pdfAuthor,
          isMatched: file.matchResult?.authorMatch || false
        });
      }
    });
  }
  
  // 如果没有从文件中获取到，使用authorMatchDetails
  if (authorsByFile.length === 0 && authorMatchDetails) {
    webAuthor = authorMatchDetails.webAuthor || '';
    const pdfAuthor = authorMatchDetails.pdfFirstAuthor || authorMatchDetails.ocrFirstAuthor || '未提取';
    const dateFile = matchedAuthorFile || (result.files && result.files[0]);
    const fileName = dateFile?.fileName || '';
    const filePrefix = fileName.length >= 2 ? fileName.substring(0, 2) : fileName;
    const fileLabel = dateFile?.fileLabel || filePrefix;
    
    authorsByFile.push({
      filePrefix: filePrefix,
      fileName: fileName,
      fileLabel: fileLabel,
      pdfAuthor: pdfAuthor,
      isMatched: authorMatchedStatus
    });
  }
  
  if (authorMatchedStatus && matchedAuthorFile) {
    // 匹配成功
    const matchType = matchedAuthorFile.matchResult?.authorMatchType === 'equal' ? '共一作者' : '第一作者';
    authorMatchHtml = `
      <div class="result-detail-item">
        <div class="result-detail-label"><span style="color: #28a745;">✓</span> 作者匹配结果</div>
        <div class="result-detail-value">
          <span style="color: #28a745; font-weight: bold;">✓ 匹配成功到 ${matchType}</span><br>
          <span class="detail-text">网页作者：${escapeHtml(webAuthor || '未提取')}</span><br>
          ${authorsByFile.length > 0 ? authorsByFile.map(fileInfo => {
            const matchMark = fileInfo.isMatched ? '<span style="color: #28a745;">✓</span>' : '<span style="color: #dc3545;">✗</span>';
            return `<span class="detail-text">${matchMark} ${fileInfo.filePrefix}.pdf中 第一作者：${escapeHtml(fileInfo.pdfAuthor)}</span>`;
          }).join('<br>') : '<span class="detail-text">pdf中 第一作者：未提取</span>'}
        </div>
      </div>
    `;
  } else {
    // 未匹配
    authorMatchHtml = `
      <div class="result-detail-item">
        <div class="result-detail-label">作者匹配结果</div>
        <div class="result-detail-value">
          <span style="color: #dc3545; font-weight: bold;">✗ 未匹配</span><br>
          <span class="detail-text">网页作者：${escapeHtml(webAuthor || '未提取')}</span><br>
          ${authorsByFile.length > 0 ? authorsByFile.map(fileInfo => {
            return `<span class="detail-text">${fileInfo.filePrefix}.pdf中 第一作者：${escapeHtml(fileInfo.pdfAuthor)}</span>`;
          }).join('<br>') : '<span class="detail-text">pdf中 第一作者：未提取</span>'}
        </div>
      </div>
    `;
  }
  
  // 构建标题匹配结果HTML（按文件分组显示）
  let titleMatchHtml = '';
  const titleMatchedStatus = matchResult.titleMatch || false;
  const matchedTitleFile = matchResult.matchedTitleFile;
  
  // 按文件分组收集标题信息
  const titlesByFile = [];
  let webTitle = '';
  
  if (result.files && result.files.length > 0) {
    result.files.forEach(file => {
      if (file.matchResult && file.matchResult.titleMatchDetails) {
        const details = file.matchResult.titleMatchDetails;
        const fileName = file.fileName || '';
        const filePrefix = getFilePrefix(fileName);
        const fileLabel = file.fileLabel || filePrefix;
        
        // 使用第一个文件的webTitle
        if (!webTitle && details.webTitle) {
          webTitle = details.webTitle;
        }
        
        const pdfTitle = details.pdfTitle || details.ocrTitle || '未提取';
        titlesByFile.push({
          filePrefix: filePrefix,
          fileName: fileName,
          fileLabel: fileLabel,
          pdfTitle: pdfTitle,
          isMatched: file.matchResult?.titleMatch || false
        });
      }
    });
  }
  
  // 如果没有从文件中获取到，使用titleMatchDetails
  if (titlesByFile.length === 0 && titleMatchDetails) {
    webTitle = titleMatchDetails.webTitle || '';
    const pdfTitle = titleMatchDetails.pdfTitle || titleMatchDetails.ocrTitle || '未提取';
    const dateFile = matchedTitleFile || (result.files && result.files[0]);
    const fileName = dateFile?.fileName || '';
    const filePrefix = fileName.length >= 2 ? fileName.substring(0, 2) : fileName;
    const fileLabel = dateFile?.fileLabel || filePrefix;
    
    titlesByFile.push({
      filePrefix: filePrefix,
      fileName: fileName,
      fileLabel: fileLabel,
      pdfTitle: pdfTitle,
      isMatched: titleMatchedStatus
    });
  }
  
  if (titleMatchedStatus && matchedTitleFile) {
    // 匹配成功
    titleMatchHtml = `
      <div class="result-detail-item">
        <div class="result-detail-label"><span style="color: #28a745;">✓</span> 论文标题匹配结果</div>
        <div class="result-detail-value">
          <span style="color: #28a745; font-weight: bold;">✓ 匹配成功到 标题</span><br>
          <span class="detail-text" style="display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">网页标题：${escapeHtml(webTitle || '未提取')}</span>
          ${titlesByFile.length > 0 ? titlesByFile.map(fileInfo => {
            const matchMark = fileInfo.isMatched ? '<span style="color: #28a745;">✓</span>' : '<span style="color: #dc3545;">✗</span>';
            return `<span class="detail-text" style="margin-top:4px; display:block;">${matchMark} ${fileInfo.filePrefix}.pdf中 标题：${escapeHtml(fileInfo.pdfTitle)}</span>`;
          }).join('') : '<span class="detail-text" style="margin-top:4px; display:block; color:#999;">pdf中 标题：未提取</span>'}
        </div>
      </div>
    `;
  } else {
    // 未匹配
    titleMatchHtml = `
      <div class="result-detail-item">
        <div class="result-detail-label">论文标题匹配结果</div>
        <div class="result-detail-value">
          <span style="color: #dc3545; font-weight: bold;">✗ 未匹配</span><br>
          <span class="detail-text" style="display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">网页标题：${escapeHtml(webTitle || '未提取')}</span>
          ${titlesByFile.length > 0 ? titlesByFile.map(fileInfo => {
            return `<span class="detail-text" style="margin-top:4px; display:block;">${fileInfo.filePrefix}.pdf中 标题：${escapeHtml(fileInfo.pdfTitle)}</span>`;
          }).join('') : '<span class="detail-text" style="margin-top:4px; display:block; color:#999;">pdf中 标题：未提取</span>'}
        </div>
      </div>
    `;
  }
  
  // 显示匹配的文件信息汇总（如果有多个文件匹配了不同项）
  let matchedFilesSummaryHtml = '';
  const matchedFiles = [];
  if (matchResult.matchedAuthorFile) {
    matchedFiles.push({ type: '作者', file: matchResult.matchedAuthorFile });
  }
  if (matchResult.matchedDateFile) {
    matchedFiles.push({ type: '日期', file: matchResult.matchedDateFile });
  }
  if (matchResult.matchedTitleFile) {
    matchedFiles.push({ type: '标题', file: matchResult.matchedTitleFile });
  }
  
  if (matchedFiles.length > 0) {
    matchedFilesSummaryHtml = `
      <div class="result-detail-item" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e0e0e0;">
        <div class="result-detail-label" style="color: #28a745; font-weight: 600;">✓ 匹配成功的文件</div>
        <div class="result-detail-value">
          ${matchedFiles.map(mf => {
            const fileDisplayName = mf.file.fileLabel ? 
              `${mf.file.fileLabel} (${mf.file.fileName})` : 
              mf.file.fileName;
            return `<div style="margin-bottom: 5px;">
              <span style="color: #28a745;">✓</span> ${mf.type}：${escapeHtml(fileDisplayName)}
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }
  
  // 获取匹配状态（用于边框颜色）
  const authorMatched = authorMatchedStatus;
  const titleMatched = titleMatchedStatus;
  const dateMatched = matchResult.dateMatch || false;
  
  // 按匹配类型分组显示：三个区块（作者、标题、日期）使用 CSS Grid 两列布局
  item.innerHTML = `
    <div class="result-title">${escapeHtml(result.title || '未知标题')}</div>
    <div class="result-details">
      <div class="match-card ${dateMatched ? 'success' : 'fail'}">
        ${dateMatchHtml}
      </div>
      <div class="match-card ${authorMatched ? 'success' : 'fail'}">
        ${authorMatchHtml}
      </div>
      <div class="match-card ${titleMatched ? 'success' : 'fail'}">
        ${titleMatchHtml}
      </div>
    </div>
    ${matchStatus}
    ${result.error ? `<div style="color: #dc3545; margin-top: 8px; font-size: 12px;">错误: ${escapeHtml(result.error)}</div>` : ''}
  `;
  
  resultsList.appendChild(item);
  resultsList.scrollTop = resultsList.scrollHeight;
}

// 开始单个论文验证
async function startSinglePaperVerification(paper, downloadedFiles) {
  isVerifying = true;
  verificationResults = [];
  
  document.getElementById('startVerifyBtn').disabled = true;
  document.getElementById('stopVerifyBtn').disabled = false;
  document.getElementById('resultsList').innerHTML = '';
  
  updateStats(1, 0, 0);
  updateProgress(10, `开始验证: ${paper.title || '未知标题'}...`);
  
  try {
    // 验证论文
    const result = await verifyPaper(paper, downloadedFiles);
    
    // 如果没有找到文件，显示文件上传区域
    if (result.allowManualUpload || (result.files && result.files.length === 0)) {
      showFileUploadArea(paper);
    }
    
    verificationResults.push(result);
    
    // 渲染结果
    renderResult(result);
    
    // 更新统计
    const matched = result.overallMatch ? 1 : 0;
    updateStats(1, 1, matched);
    updateProgress(100, '验证完成！');
    
  } catch (error) {
    console.error('单个论文验证失败:', error);
    updateProgress(0, `错误: ${error.message}`);
    
    // 显示文件上传区域
    showFileUploadArea(paper);
    
    // 添加错误结果
    const errorResult = {
      title: paper.title || '未知标题',
      firstAuthor: paper.firstAuthor || '',
      error: error.message,
      overallMatch: false,
      allowManualUpload: true
    };
    verificationResults.push(errorResult);
    renderResult(errorResult);
    updateStats(1, 1, 0);
  } finally {
    isVerifying = false;
    document.getElementById('startVerifyBtn').disabled = false;
    document.getElementById('stopVerifyBtn').disabled = true;
  }
}

// 显示PDF文件上传区域
function showPdfUploadArea(paper) {
  const pdfUploadArea = document.getElementById('pdfUploadArea');
  if (pdfUploadArea) {
    pdfUploadArea.style.display = 'block';
  }
}

// 处理手动上传的PDF文件
async function handlePdfFilesUpload(files) {
  try {
    updateProgress(10, `正在处理 ${files.length} 个PDF文件...`);
    
    // 获取当前论文信息（从存储中，使用Promise）
    const storageResult = await new Promise((resolve) => {
      chrome.storage.local.get(['currentVerificationPaper'], resolve);
    });
    
    let currentPaper = storageResult.currentVerificationPaper;
    
    // 如果没有论文信息，尝试从最近的验证结果获取
    if (!currentPaper && verificationResults.length > 0) {
      const lastResult = verificationResults[verificationResults.length - 1];
      currentPaper = {
        title: lastResult.title || '',
        firstAuthor: lastResult.firstAuthor || '',
        authors: lastResult.authors || [],
        date: lastResult.date || '',
        webMetadata: {
          title: lastResult.title || '',
          firstAuthor: lastResult.firstAuthor || '',
          authors: lastResult.authors || [],
          date: lastResult.date || ''
        }
      };
    }
    
    // 如果没有论文信息，创建一个空的论文对象（允许直接拖放文件验证）
    if (!currentPaper) {
      console.log('[验证页面] 未找到论文信息，使用空论文信息进行验证（直接拖放模式）');
      currentPaper = {
        title: '',
        firstAuthor: '',
        authors: [],
        date: '',
        pageUrl: '',
        webMetadata: {
          title: '',
          firstAuthor: '',
          authors: [],
          date: ''
        }
      };
    }
    
    // 将文件转换为base64数据（而不是blob URL，因为blob URL在content script中无法访问）
    const filesToVerify = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // 读取文件为base64
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const arrayBuffer = e.target.result;
          const uint8Array = new Uint8Array(arrayBuffer);
          let binaryString = '';
          const chunkSize = 8192;
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.slice(i, i + chunkSize);
            binaryString += String.fromCharCode.apply(null, chunk);
          }
          const base64 = btoa(binaryString);
          resolve({
            base64: base64,
            fileName: file.name
          });
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });
      
      // 使用data URL格式，这样background script可以直接识别
      filesToVerify.push({
        name: file.name,
        url: `data:application/pdf;base64,${fileData.base64}`, // 使用data URL
        type: 'pdf',
        label: '手动上传',
        fileData: fileData.base64, // 保存base64数据以便后续使用
        fileName: fileData.fileName
      });
    }
    
    // 开始验证
    await startSinglePaperVerification(currentPaper, filesToVerify);
    
    // 隐藏上传区域
    const pdfUploadArea = document.getElementById('pdfUploadArea');
    if (pdfUploadArea) {
      pdfUploadArea.style.display = 'none';
    }
    
  } catch (error) {
    console.error('[验证页面] PDF文件处理失败:', error);
    updateProgress(0, `错误: ${error.message}`);
    alert(`处理PDF文件失败: ${error.message}`);
  }
}

// 显示文件上传区域
function showFileUploadArea(paper) {
  // 这个函数保留用于向后兼容，但不执行任何操作
  return;
}

// 处理手动上传的文件
async function handleManualFileUpload(file, paper, fileIndex = 0, totalFiles = 1) {
  const uploadArea = document.getElementById('fileUploadArea');
  if (uploadArea && fileIndex === 0) {
    uploadArea.innerHTML = '<div style="text-align: center; color: #666;">正在处理文件...</div>';
  }
  
  const progressBase = 20;
  const progressPerFile = 70 / totalFiles;
  const currentProgress = progressBase + (fileIndex * progressPerFile);
  updateProgress(currentProgress, `正在读取文件 ${fileIndex + 1}/${totalFiles}: ${file.name}...`);
  
  try {
    // 读取文件为ArrayBuffer，然后转换为base64
    const fileReader = new FileReader();
    const fileData = await new Promise((resolve, reject) => {
      fileReader.onload = (e) => {
        const arrayBuffer = e.target.result;
        const uint8Array = new Uint8Array(arrayBuffer);
        let binaryString = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.slice(i, i + chunkSize);
          binaryString += String.fromCharCode.apply(null, chunk);
        }
        const base64 = btoa(binaryString);
        resolve({
          base64: base64,
          arrayBuffer: arrayBuffer,
          fileName: file.name
        });
      };
      fileReader.onerror = reject;
      fileReader.readAsArrayBuffer(file);
    });
    
    const parseProgress = progressBase + (fileIndex * progressPerFile) + (progressPerFile * 0.3);
    updateProgress(parseProgress, `正在解析PDF ${fileIndex + 1}/${totalFiles}: ${file.name}...`);
    
    // 找到一个有content script的标签页（优先使用论文页面）
    let targetTab = null;
    
    // 方法1：尝试找到论文页面
    if (paper.pageUrl) {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({}, (allTabs) => {
          // 精确匹配或部分匹配
          const matched = allTabs.find(tab => 
            tab.url && (
              tab.url === paper.pageUrl || 
              tab.url.includes(new URL(paper.pageUrl).hostname)
            )
          );
          resolve(matched ? [matched] : []);
        });
      });
      if (tabs && tabs.length > 0) {
        targetTab = tabs[0];
        console.log('[验证] 找到论文页面标签页:', targetTab.url);
      }
    }
    
    // 方法2：如果没找到，尝试找到任何有content script的标签页
    if (!targetTab) {
      const allTabs = await new Promise((resolve) => {
        chrome.tabs.query({}, resolve);
      });
      // 优先选择论文相关的页面（排除chrome://和chrome-extension://页面）
      targetTab = allTabs.find(tab => 
        tab.url && 
        !tab.url.startsWith('chrome://') && 
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('about:') &&
        (
          tab.url.includes('kecaihui-tm-zz.cast.org.cn') ||
          tab.url.includes('arxiv.org') ||
          tab.url.includes('ieee.org') ||
          tab.url.startsWith('http://') ||
          tab.url.startsWith('https://')
        )
      );
      
      if (targetTab) {
        console.log('[验证] 找到备用标签页:', targetTab.url);
      }
    }
    
    if (!targetTab) {
      throw new Error('无法找到可用的网页标签页。请确保至少打开一个网页（如论文页面），然后重试。');
    }
    
    // 快速检查content script是否已加载（最多等待1秒）
    let contentScriptReady = false;
    for (let i = 0; i < 5; i++) {
      try {
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(targetTab.id, { action: 'ping' }, (response) => {
            if (chrome.runtime.lastError) {
              // Content script可能还没加载，等待后重试
              if (i < 4) {
                setTimeout(() => resolve(), 200); // 每次等待200ms
              } else {
                // 最后一次，直接继续（可能ping没处理但其他功能正常）
                console.warn('[验证] Content script ping失败，但继续尝试发送消息');
                resolve();
              }
            } else if (response && response.loaded) {
              console.log('[验证] Content script已加载');
              contentScriptReady = true;
              resolve();
            } else {
              resolve();
            }
          });
        });
        if (contentScriptReady) break;
      } catch (e) {
        console.warn('[验证] Content script检查出错:', e);
        if (i < 4) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }
    
    // 发送到content script解析
    const parseResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('PDF解析超时（60秒），请重试'));
      }, 60000);
      
      console.log('[验证] 发送parsePdfFromData到标签页:', targetTab.id, targetTab.url);
      
      // 使用Promise包装，确保正确处理超时和错误
      const messagePromise = new Promise((resolveMsg, rejectMsg) => {
        chrome.tabs.sendMessage(targetTab.id, {
          action: 'parsePdfFromData',
          fileData: fileData.base64,  // 注意：参数名是 fileData
          fileName: fileData.fileName
        }, (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            // 如果是消息通道关闭错误，可能是超时，尝试等待一下
            if (errorMsg.includes('message port closed') || errorMsg.includes('Receiving end does not exist')) {
              console.warn('[验证] 消息通道关闭，可能是处理时间过长，等待重试...');
              // 不立即拒绝，而是等待一下看看是否有延迟响应
              setTimeout(() => {
                rejectMsg(new Error(`无法连接到content script: ${errorMsg}。请确保论文页面（${paper.pageUrl || '未知'}）已打开并刷新页面。`));
              }, 2000);
            } else {
              rejectMsg(new Error(`无法连接到content script: ${errorMsg}。请确保论文页面（${paper.pageUrl || '未知'}）已打开并刷新页面。`));
            }
          } else if (response && response.success !== undefined) {
            // 即使success为false，也认为是有效响应
            resolveMsg(response);
          } else {
            // 如果没有响应，可能是超时
            rejectMsg(new Error('PDF解析超时或未收到响应'));
          }
        });
      });
      
      // 使用Promise.race来处理超时
      Promise.race([
        messagePromise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('PDF解析超时（60秒）')), 60000);
        })
      ]).then((response) => {
        clearTimeout(timeout);
        if (response && response.success) {
          console.log('[验证] PDF解析成功，响应:', response);
          // content.js直接返回result对象，所以response本身就是result
          resolve(response);
        } else {
          const errorMsg = response?.error || 'PDF解析失败';
          console.error('[验证] PDF解析失败:', errorMsg, '响应:', response);
          reject(new Error(errorMsg));
        }
      }).catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    
    updateProgress(70, '正在匹配验证...');
    
    // 检查parseResult是否有效
    console.log('[验证] parseResult检查:', {
      hasParseResult: !!parseResult,
      success: parseResult?.success,
      error: parseResult?.error,
      title: parseResult?.title,
      author: parseResult?.author
    });
    
    if (!parseResult || !parseResult.success) {
      const errorMsg = parseResult?.error || 'PDF解析失败';
      console.error('[验证] parseResult无效:', parseResult);
      throw new Error(errorMsg);
    }
    
    // 将parseResult转换为matchVerification期望的格式
    const pdfDataForVerification = {
      title: parseResult.title || '',
      firstAuthor: parseResult.author || parseResult.firstAuthor || '',
      allAuthors: parseResult.author ? [parseResult.author] : (parseResult.allAuthors || []),
      date: parseResult.creationDate || parseResult.date || '',
      dates: parseResult.extractedDates ? {
        received: parseResult.extractedDates.received ? normalizeDateString(parseResult.extractedDates.received) : null,
        accepted: parseResult.extractedDates.accepted ? normalizeDateString(parseResult.extractedDates.accepted) : null,
        published: parseResult.extractedDates.availableOnline ? normalizeDateString(parseResult.extractedDates.availableOnline) : null,
        other: parseResult.extractedDates.allDates ? parseResult.extractedDates.allDates.map(d => normalizeDateString(d)).filter(d => d) : []
      } : null
    };
    
    // 获取论文的webMetadata
    const webMetadata = paper.webMetadata || {
      title: paper.title,
      firstAuthor: paper.firstAuthor,
      authors: paper.authors || paper.allAuthors || [],
      date: paper.date || paper.extractedDate,
      fileLinks: []
    };
    
    // 调用background验证
    const verifyResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('验证请求超时（30秒），请重试'));
      }, 30000);
      
      // 使用Promise包装，确保正确处理超时和错误
      const messagePromise = new Promise((resolveMsg, rejectMsg) => {
        console.log('[验证] 准备发送verifyPaperData消息到background script...');
        const messageStartTime = Date.now();
        
        chrome.runtime.sendMessage({
          action: 'verifyPaperData',
          pdfData: pdfDataForVerification,
          webMetadata: webMetadata,
          fileName: file.name
        }, (response) => {
          const elapsedTime = Date.now() - messageStartTime;
          console.log(`[验证] 收到background script响应，耗时: ${elapsedTime}ms`, response);
          
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            console.error(`[验证] 消息发送失败（耗时: ${elapsedTime}ms）:`, errorMsg);
            // 如果是消息通道关闭错误，可能是超时，尝试等待一下
            if (errorMsg.includes('message port closed') || errorMsg.includes('Receiving end does not exist')) {
              console.warn('[验证] 消息通道关闭，可能是处理时间过长，等待重试...');
              // 不立即拒绝，而是等待一下看看是否有延迟响应
              setTimeout(() => {
                rejectMsg(new Error(`无法连接到background script: ${errorMsg}`));
              }, 2000);
            } else {
              rejectMsg(new Error(`无法连接到background script: ${errorMsg}`));
            }
          } else if (response && response.success !== undefined) {
            // 即使success为false，也认为是有效响应
            console.log('[验证] 收到有效响应:', response);
            resolveMsg(response);
          } else {
            // 如果没有响应，可能是超时
            console.warn('[验证] 未收到有效响应，可能是超时');
            rejectMsg(new Error('验证请求未收到响应'));
          }
        });
      });
      
      // 使用Promise.race来处理超时
      Promise.race([
        messagePromise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('验证请求超时（30秒）')), 30000);
        })
      ]).then((response) => {
        clearTimeout(timeout);
        if (response && response.success) {
          resolve(response.result);
        } else {
          reject(new Error(response?.error || '验证失败'));
        }
      }).catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    
    // 检查是否已有验证结果（多个文件时）
    let existingResult = verificationResults.find(r => r.title === (paper.title || '未知标题'));
    
    if (!existingResult) {
      // 创建新结果
      existingResult = {
        title: paper.title || '未知标题',
        firstAuthor: webMetadata.firstAuthor || '',
        authors: webMetadata.authors || [],
        date: webMetadata.date || '',
        files: [],
        overallMatch: false,
        matchResult: {
          authorMatch: false,
          dateMatch: false,
          titleMatch: false,
          matchedAuthorFile: null,
          matchedDateFile: null,
          matchedTitleFile: null
        }
      };
      verificationResults.push(existingResult);
    }
    
    // 确保 files 数组存在
    if (!existingResult.files) {
      existingResult.files = [];
    }
    
    // 检查是否已经验证过这个文件（避免重复验证）
    const existingFile = existingResult.files.find(f => f.fileName === file.name);
    if (existingFile) {
      console.log(`[验证] 文件 ${file.name} 已经验证过，跳过重复验证`);
      // 如果是最后一个文件，完成处理
      if (fileIndex === totalFiles - 1) {
        updateProgress(100, `验证完成！共处理 ${totalFiles} 个文件`);
        if (uploadArea) {
          uploadArea.style.display = 'none';
        }
      } else {
        const nextProgress = progressBase + ((fileIndex + 1) * progressPerFile);
        updateProgress(nextProgress, `文件 ${fileIndex + 1}/${totalFiles} 已存在，跳过...`);
      }
      return; // 跳过重复验证
    }
    
    // 确保 matchResult 存在
    if (!existingResult.matchResult) {
      existingResult.matchResult = {
        authorMatch: false,
        dateMatch: false,
        titleMatch: false,
        matchedAuthorFile: null,
        matchedDateFile: null,
        matchedTitleFile: null
      };
    }
    
    // 添加当前文件的结果
    const fileResult = {
      fileName: file.name,
      fileLabel: `手动上传 ${fileIndex + 1}`,
      matchResult: verifyResult.matchResult,
      pdfData: parseResult
    };
    existingResult.files.push(fileResult);
    
    // 更新整体匹配状态（只要有一个文件匹配了任意一项就成功）
    if (verifyResult.matchResult) {
      if (verifyResult.matchResult.authorMatch && !existingResult.matchResult.authorMatch) {
        existingResult.matchResult.authorMatch = true;
        existingResult.matchResult.matchedAuthorFile = {
          fileName: file.name,
          fileLabel: `手动上传 ${fileIndex + 1}`,
          matchResult: verifyResult.matchResult
        };
      }
      if (verifyResult.matchResult.dateMatch && !existingResult.matchResult.dateMatch) {
        existingResult.matchResult.dateMatch = true;
        existingResult.matchResult.matchedDateFile = {
          fileName: file.name,
          fileLabel: `手动上传 ${fileIndex + 1}`,
          matchResult: verifyResult.matchResult
        };
      }
      if (verifyResult.matchResult.titleMatch && !existingResult.matchResult.titleMatch) {
        existingResult.matchResult.titleMatch = true;
        existingResult.matchResult.matchedTitleFile = {
          fileName: file.name,
          fileLabel: `手动上传 ${fileIndex + 1}`,
          matchResult: verifyResult.matchResult
        };
      }
    }
    
    existingResult.overallMatch = existingResult.matchResult.authorMatch || 
                                  existingResult.matchResult.dateMatch || 
                                  existingResult.matchResult.titleMatch;
    
    // 重新渲染结果（更新现有结果）
    const resultsList = document.getElementById('resultsList');
    const existingItem = resultsList.querySelector(`[data-paper-title="${escapeHtml(paper.title || '未知标题')}"]`);
    if (existingItem) {
      existingItem.remove();
    }
    renderResult(existingResult);
    
    // 更新统计
    const matchedCount = verificationResults.filter(r => r.overallMatch).length;
    updateStats(verificationResults.length, verificationResults.length, matchedCount);
    
    // 如果是最后一个文件，完成处理
    if (fileIndex === totalFiles - 1) {
      updateProgress(100, `验证完成！共处理 ${totalFiles} 个文件`);
      if (uploadArea) {
        uploadArea.style.display = 'none';
      }
    } else {
      const nextProgress = progressBase + ((fileIndex + 1) * progressPerFile);
      updateProgress(nextProgress, `文件 ${fileIndex + 1}/${totalFiles} 处理完成，继续处理下一个...`);
    }
    
  } catch (error) {
    console.error('手动文件验证失败:', error);
    updateProgress(0, `错误: ${error.message}`);
    
    if (uploadArea) {
      uploadArea.innerHTML = `
        <div style="text-align: center;">
          <div style="color: #dc3545; margin-bottom: 10px;">错误: ${escapeHtml(error.message)}</div>
          <button class="btn btn-secondary" onclick="location.reload()">重试</button>
        </div>
      `;
    }
  }
}

// 导出报告
function exportReport() {
  if (verificationResults.length === 0) {
    alert('没有可导出的结果');
    return;
  }
  
  const report = {
    timestamp: new Date().toISOString(),
    total: verificationResults.length,
    matched: verificationResults.filter(r => 
      r.matchResult && r.matchResult.authorMatch && r.matchResult.dateMatch
    ).length,
    results: verificationResults
  };
  
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `verification-report-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 工具函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

