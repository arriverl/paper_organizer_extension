// Popup脚本：管理面板逻辑
'use strict';

let papers = [];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Popup] DOM已加载，开始初始化');
  
  // 检查必要的DOM元素是否存在
  const paperList = document.getElementById('paperList');
  if (!paperList) {
    console.error('[Popup] 错误：找不到paperList元素！');
    return;
  }
  console.log('[Popup] ✓ 找到paperList元素');
  
  loadPapers();
  loadDownloadDirectory(); // 加载保存的下载目录
  
  const refreshBtn = document.getElementById('refreshBtn');
  const clearBtn = document.getElementById('clearBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const saveDirBtn = document.getElementById('saveDirBtn');
  
  if (refreshBtn) refreshBtn.addEventListener('click', loadPapers);
  if (clearBtn) clearBtn.addEventListener('click', clearPapers);
  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (saveDirBtn) saveDirBtn.addEventListener('click', saveDownloadDirectory);
  
  // 检查当前页面并显示相应按钮
  checkCurrentPage();
  
  // 监听来自background的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'paperDownloaded') {
      console.log('[Popup] 收到论文下载通知，刷新列表');
      loadPapers();
    }
  });
  
  console.log('[Popup] ✓ 初始化完成');
});

// 加载保存的下载目录
function loadDownloadDirectory() {
  chrome.storage.local.get(['downloadDirectory'], (result) => {
    const dirInput = document.getElementById('downloadDirInput');
    if (dirInput) {
      // 如果已保存，使用保存的值；否则使用默认值
      const defaultDir = 'D:\\360安全浏览器下载';
      const savedDir = result.downloadDirectory || defaultDir;
      
      dirInput.value = savedDir;
      
      // 如果之前没有保存过，自动保存默认值
      if (!result.downloadDirectory) {
        chrome.storage.local.set({ downloadDirectory: defaultDir }, () => {
          console.log('[Popup] 已设置默认下载目录:', defaultDir);
          updateDirStatus('已使用默认目录', 'green');
        });
      } else {
        updateDirStatus('已保存', 'green');
      }
    }
  });
}

// 保存下载目录
function saveDownloadDirectory() {
  const dirInput = document.getElementById('downloadDirInput');
  const downloadDir = dirInput.value.trim();
  
  if (!downloadDir) {
    updateDirStatus('目录不能为空', 'red');
    return;
  }
  
  // 验证路径格式（基本检查）
  const isValidPath = downloadDir.includes('\\') || downloadDir.startsWith('/') || downloadDir.match(/^[A-Za-z]:/);
  if (!isValidPath) {
    updateDirStatus('路径格式不正确，请使用绝对路径', 'red');
    return;
  }
  
  // 保存到storage
  chrome.storage.local.set({ downloadDirectory: downloadDir }, () => {
    updateDirStatus('已保存', 'green');
    console.log('[Popup] 下载目录已保存:', downloadDir);
  });
}

// 更新目录状态显示
function updateDirStatus(message, color) {
  const statusElement = document.getElementById('dirStatus');
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.style.color = color;
  }
}

// 检查当前页面类型
function checkCurrentPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      const url = tabs[0].url;
      
      // 检查是否是arXiv论文详情页
      if (url.includes('arxiv.org/abs/')) {
        showQuickProcessButton(tabs[0]);
      } else if (url.includes('arxiv.org/list/')) {
        showVerificationButton();
      } else {
        hideQuickButtons();
      }
    }
  });
}

// 显示快速处理按钮（arXiv论文详情页）
function showQuickProcessButton(tab) {
  const quickProcessBtn = document.getElementById('quickProcessBtn');
  if (quickProcessBtn) {
    quickProcessBtn.style.display = 'block';
    quickProcessBtn.addEventListener('click', () => quickProcessPaper(tab));
  } else {
    // 创建快速处理按钮
    const controls = document.querySelector('.controls');
    const btn = document.createElement('button');
    btn.id = 'quickProcessBtn';
    btn.className = 'btn btn-primary';
    btn.textContent = '一键处理论文';
    btn.style.marginTop = '10px';
    btn.addEventListener('click', () => quickProcessPaper(tab));
    controls.appendChild(btn);
  }
}

// 显示验证按钮（arXiv列表页）
function showVerificationButton() {
  const verifyBtn = document.getElementById('verifyBtn');
  if (verifyBtn) {
    verifyBtn.style.display = 'block';
  }
}

// 隐藏快速按钮
function hideQuickButtons() {
  const quickProcessBtn = document.getElementById('quickProcessBtn');
  if (quickProcessBtn) {
    quickProcessBtn.style.display = 'none';
  }
  const verifyBtn = document.getElementById('verifyBtn');
  if (verifyBtn) {
    verifyBtn.style.display = 'none';
  }
}

// 一键处理论文
function quickProcessPaper(tab) {
  chrome.tabs.sendMessage(tab.id, { action: 'quickProcessPaper' }, (response) => {
    if (chrome.runtime.lastError) {
      alert('处理失败: ' + chrome.runtime.lastError.message);
    } else if (response && response.success) {
      alert('论文处理成功！');
      loadPapers(); // 刷新列表
    } else {
      // 检查是否是重复论文的错误
      const errorMsg = response?.error || '未知错误';
      if (errorMsg.includes('重复') || errorMsg.includes('duplicate')) {
        alert('该论文已经处理过了');
      } else {
        alert('处理失败: ' + errorMsg);
      }
    }
  });
}

// 打开设置页面
function openSettings() {
  chrome.runtime.openOptionsPage();
}

// 加载论文列表
function loadPapers() {
  chrome.storage.local.get(['papers'], (result) => {
    papers = result.papers || [];
    console.log('[Popup] 加载论文列表，共', papers.length, '篇');
    if (papers.length > 0) {
      console.log('[Popup] 第一篇论文示例:', papers[0]);
    }
    renderPapers();
    updateStats();
  });
}

// 自动为所有论文生成JSON文件
function autoGenerateJsonFiles(sortedPapers) {
  if (sortedPapers.length === 0) {
    console.log('[自动生成JSON] 论文列表为空，跳过');
    return;
  }
  
  // 获取用户设置的下载目录
  chrome.storage.local.get(['downloadDirectory'], (result) => {
    const downloadDir = result.downloadDirectory || 'D:\\360安全浏览器下载';
    
    if (!downloadDir) {
      console.warn('[自动生成JSON] 未设置下载目录，跳过');
      return;
    }
    
    console.log('[自动生成JSON] 开始为', sortedPapers.length, '篇论文生成JSON文件');
    console.log('[自动生成JSON] 保存目录:', downloadDir);
    
    // 为每篇论文生成JSON
    sortedPapers.forEach((paper, index) => {
      setTimeout(() => {
        generateJsonForPaper(paper, downloadDir, index + 1, sortedPapers.length);
      }, index * 100); // 每100ms处理一篇，避免过快
    });
  });
}

// 为单篇论文生成JSON文件
function generateJsonForPaper(paper, downloadDir, currentIndex, totalCount) {
  console.log(`[自动生成JSON] [${currentIndex}/${totalCount}] 处理论文:`, paper.title);
  
  // 生成论文唯一标识
  const getPaperKey = (paperData) => {
    const title = (paperData.title || '').trim();
    const author = (paperData.firstAuthor || paperData.author || '').trim();
    const date = (paperData.extractedDate || paperData.date || '').trim();
    return `${title}|${author}|${date}`;
  };
  
  const paperKey = getPaperKey(paper);
  
  // 从background获取该论文的所有待处理文件信息
  chrome.runtime.sendMessage({
    action: 'getPendingFilesForPaper',
    paperKey: paperKey
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn(`[自动生成JSON] [${currentIndex}/${totalCount}] 获取待处理文件失败:`, chrome.runtime.lastError);
      // 使用已有数据生成JSON
      generateJsonWithPaperData(paper, downloadDir, currentIndex, totalCount);
      return;
    }
    
    if (!response || !response.success || !response.files || response.files.length === 0) {
      console.warn(`[自动生成JSON] [${currentIndex}/${totalCount}] 未找到待处理文件，使用已有数据`);
      generateJsonWithPaperData(paper, downloadDir, currentIndex, totalCount);
      return;
    }
    
    // 构建完整的元数据对象（包含所有文件信息）
    try {
      const metadata = {
        title: paper.title || '未知标题',
        firstAuthor: paper.firstAuthor || paper.author || '未知作者',
        allAuthors: paper.allAuthors || [],
        date: paper.extractedDate || paper.date || '',
        dates: paper.dates || {
          received: null,
          accepted: null,
          published: null,
          revised: null,
          other: []
        },
        pageUrl: paper.pageUrl || '',
        pageTitle: paper.pageTitle || '',
        originalUrl: paper.originalUrl || '',
        downloadTime: paper.downloadTime || new Date().toISOString(),
        downloadTimeFormatted: paper.downloadTime ? formatDate(paper.downloadTime) : '',
        files: []
      };
      
      // 从待处理文件中添加文件信息
      const separator = downloadDir.includes('\\') ? '\\' : '/';
      let pdfFilePath = null;
      for (const file of response.files) {
        const fileName = file.fileName || '未知文件';
        const fullPath = downloadDir + separator + fileName;
        
        // 如果是PDF文件，保存为pdfFilePath
        if ((file.fileType === 'pdf' || fileName.toLowerCase().endsWith('.pdf')) && !pdfFilePath) {
          pdfFilePath = fullPath;
        }
        
        metadata.files.push({
          type: file.fileType || '未知类型',
          fileName: fileName,
          filePath: fullPath,
          downloadTime: file.downloadTime ? new Date(file.downloadTime).toISOString() : paper.downloadTime || new Date().toISOString()
        });
      }
      
      // 添加pdfFilePath字段（用于验证）
      if (pdfFilePath) {
        metadata.pdfFilePath = pdfFilePath;
      } else if (metadata.files.length > 0 && metadata.files[0].filePath) {
        // 如果没有PDF，使用第一个文件
        metadata.pdfFilePath = metadata.files[0].filePath;
      }
      
      // 生成并保存JSON文件
      downloadJsonFileToDirectory(metadata, downloadDir, currentIndex, totalCount);
    } catch (error) {
      console.error(`[自动生成JSON] [${currentIndex}/${totalCount}] 处理失败:`, error);
    }
  });
}

// 使用已有数据生成JSON
function generateJsonWithPaperData(paper, downloadDir, currentIndex, totalCount) {
  try {
    const metadata = {
      title: paper.title || '未知标题',
      firstAuthor: paper.firstAuthor || paper.author || '未知作者',
      allAuthors: paper.allAuthors || [],
      date: paper.extractedDate || paper.date || '',
      dates: paper.dates || {
        received: null,
        accepted: null,
        published: null,
        revised: null,
        other: []
      },
      pageUrl: paper.pageUrl || '',
      pageTitle: paper.pageTitle || '',
      originalUrl: paper.originalUrl || '',
      downloadTime: paper.downloadTime || new Date().toISOString(),
      downloadTimeFormatted: paper.downloadTime ? formatDate(paper.downloadTime) : '',
      files: []
    };
    
    if (paper.filePath) {
      metadata.files.push({
        type: '论文全文',
        fileName: paper.fileName || paper.filePath.split(/[/\\]/).pop() || '未知文件',
        filePath: paper.filePath,
        downloadTime: paper.downloadTime || new Date().toISOString()
      });
      // 添加pdfFilePath字段（用于验证）
      metadata.pdfFilePath = paper.filePath;
    }
    
    downloadJsonFileToDirectory(metadata, downloadDir, currentIndex, totalCount);
  } catch (error) {
    console.error(`[自动生成JSON] [${currentIndex}/${totalCount}] 处理失败:`, error);
  }
}

// 将JSON文件保存到指定目录
function downloadJsonFileToDirectory(metadata, downloadDir, currentIndex, totalCount) {
  const jsonContent = JSON.stringify(metadata, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  
  // 使用简单的文件名（标题前30字符 + 时间戳）
  const title = metadata.title || '未知标题';
  const sanitizedTitle = title
    .replace(/[<>:"/\\|?*()\x00-\x1F]/g, '_')
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 30);
  
  const timestamp = Date.now();
  const fileName = `${sanitizedTitle}_${timestamp}.json`;
  
  // 构建完整路径
  const separator = downloadDir.includes('\\') ? '\\' : '/';
  const filePath = downloadDir + separator + fileName;
  
  chrome.downloads.download({
    url: blobUrl,
    filename: filePath,
    saveAs: false,
    conflictAction: 'uniquify'
  }, (downloadId) => {
    URL.revokeObjectURL(blobUrl);
    
    if (chrome.runtime.lastError) {
      console.error(`[自动生成JSON] [${currentIndex}/${totalCount}] 下载失败:`, chrome.runtime.lastError);
    } else {
      console.log(`[自动生成JSON] [${currentIndex}/${totalCount}] ✓ JSON文件已生成:`, fileName);
      if (currentIndex === totalCount) {
        console.log('[自动生成JSON] ✅ 所有JSON文件生成完成');
      }
    }
  });
}

// 渲染论文列表
function renderPapers() {
  const paperList = document.getElementById('paperList');
  
  console.log('[Popup] 开始渲染论文列表，当前论文数:', papers.length);
  
  if (papers.length === 0) {
    paperList.innerHTML = '<div class="empty-state">暂无论文记录<br><small>点击网页上的PDF链接开始下载</small></div>';
    console.log('[Popup] 论文列表为空，显示空状态');
    return;
  }
  
  // 按下载时间排序（最新的在前）
  const sortedPapers = [...papers].sort((a, b) => {
    const timeA = new Date(a.downloadTime || 0).getTime();
    const timeB = new Date(b.downloadTime || 0).getTime();
    return timeB - timeA;
  });
  
  console.log('[Popup] 排序后论文数:', sortedPapers.length);
  
  const html = sortedPapers.map((paper, index) => {
    const title = paper.title || '未知标题';
    const firstAuthor = paper.firstAuthor || paper.author || '未知作者';
    const allAuthors = paper.allAuthors || (paper.author ? [paper.author] : []);
    const url = paper.originalUrl || paper.pageUrl || '#';
    const arxivId = paper.arxivId || '';
    
    // 日期信息
    const dates = paper.dates || {};
    const receivedDate = dates.received || null;
    const acceptedDate = dates.accepted || null;
    const publishedDate = dates.published || null;
    const otherDates = dates.other || [];
    const extractedDate = paper.extractedDate || paper.date || receivedDate || acceptedDate || publishedDate || '未知日期';
    
    // Equal Contribution信息
    const hasEqualContribution = paper.hasEqualContribution || false;
    const equalContributionAuthors = paper.equalContributionAuthors || [];
    const firstAuthorHasEqual = paper.firstAuthorHasEqual || false;
    
    // 构建详细信息HTML
    let detailsHtml = '';
    
    // 作者信息
    if (allAuthors.length > 0) {
      detailsHtml += `
        <div class="paper-detail-section">
          <div class="paper-detail-label">所有作者:</div>
          <div class="paper-detail-value">${allAuthors.map(a => escapeHtml(a)).join(', ')}</div>
        </div>
      `;
    }
    
    // Equal Contribution信息
    if (hasEqualContribution) {
      let ecInfo = '是';
      if (firstAuthorHasEqual) {
        ecInfo += ' ✓ (已验证: 第一作者在标记中)';
      } else if (equalContributionAuthors.length > 0) {
        ecInfo += ` ⚠ (检测到标记，但第一作者未在标记中)`;
        ecInfo += `<br><small>标记的作者: ${equalContributionAuthors.map(a => escapeHtml(a)).join(', ')}</small>`;
      }
      detailsHtml += `
        <div class="paper-detail-section">
          <div class="paper-detail-label">Equal Contribution:</div>
          <div class="paper-detail-value">${ecInfo}</div>
        </div>
      `;
    }
    
    // 日期信息
    if (receivedDate || acceptedDate || publishedDate || otherDates.length > 0) {
      detailsHtml += `
        <div class="paper-detail-section">
          <div class="paper-detail-label">日期信息:</div>
          <div class="paper-detail-value">
            ${receivedDate ? `<div><strong>Received:</strong> ${escapeHtml(receivedDate)}</div>` : ''}
            ${acceptedDate ? `<div><strong>Accepted:</strong> ${escapeHtml(acceptedDate)}</div>` : ''}
            ${publishedDate ? `<div><strong>Published:</strong> ${escapeHtml(publishedDate)}</div>` : ''}
            ${otherDates.length > 0 ? `<div><strong>其他日期:</strong> ${otherDates.map(d => escapeHtml(d)).join(', ')}</div>` : ''}
          </div>
        </div>
      `;
    }
    
    return `
      <div class="paper-item" data-index="${index}">
        <div class="paper-title">${escapeHtml(title)}</div>
        <div class="paper-meta">
          <div class="paper-meta-item">
            <strong>第一作者:</strong> ${escapeHtml(firstAuthor)}
          </div>
          <div class="paper-meta-item">
            <strong>日期:</strong> ${escapeHtml(extractedDate)}
          </div>
          ${arxivId ? `<div class="paper-meta-item"><strong>arXiv ID:</strong> ${escapeHtml(arxivId)}</div>` : ''}
          ${hasEqualContribution ? `<div class="paper-meta-item"><strong>Equal Contribution:</strong> 是 ${firstAuthorHasEqual ? '✓' : '⚠'}</div>` : ''}
          <div class="paper-meta-item">
            <strong>下载时间:</strong> ${formatDate(paper.downloadTime)}
          </div>
        </div>
        ${detailsHtml ? `<div class="paper-details" id="details-${index}" style="display: none;">${detailsHtml}</div>` : ''}
        <div class="paper-actions">
          <button class="btn btn-small btn-primary verify-btn" data-index="${index}" title="验证论文信息">验证</button>
        </div>
        <a href="${url}" target="_blank" class="paper-url">${url}</a>
      </div>
    `;
  }).join('');
  
  console.log('[Popup] 生成的HTML长度:', html.length, '字符');
  console.log('[Popup] 准备更新DOM，paperList元素:', paperList);
  paperList.innerHTML = html;
  console.log('[Popup] ✓ 论文列表已渲染完成，共', sortedPapers.length, '篇');
  
  // 绑定验证按钮事件
  document.querySelectorAll('.verify-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      verifySinglePaper(index);
    });
  });
  
  // 自动为所有论文生成JSON文件
  autoGenerateJsonFiles(sortedPapers);
}

// 更新统计信息
function updateStats() {
  document.getElementById('totalPapers').textContent = papers.length;
}

// 清空论文记录
function clearPapers() {
  if (confirm('确定要清空所有论文记录吗？此操作不可恢复。\n\n注意：此操作只会清空记录，不会删除已下载的文件。')) {
    // 通知background清空记录
    chrome.runtime.sendMessage({
      action: 'clearAllPapers'
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('清空记录失败:', chrome.runtime.lastError);
        alert('清空记录失败: ' + chrome.runtime.lastError.message);
        return;
      }
      
      // 清空本地数据
      chrome.storage.local.set({ papers: [] }, () => {
        papers = [];
        renderPapers();
        updateStats();
        console.log('论文记录已清空');
      });
    });
  }
}

// 工具函数：转义HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 工具函数：格式化日期
function formatDate(dateString) {
  if (!dateString) return '未知';
  const date = new Date(dateString);
  return date.toLocaleString('zh-CN');
}

// 切换详细信息显示
function toggleDetails(index) {
  const detailsDiv = document.getElementById(`details-${index}`);
  const btn = document.querySelector(`.toggle-details-btn[data-index="${index}"]`);
  
  if (detailsDiv && btn) {
    if (detailsDiv.style.display === 'none' || !detailsDiv.style.display) {
      detailsDiv.style.display = 'block';
      btn.textContent = '隐藏详细信息';
    } else {
      detailsDiv.style.display = 'none';
      btn.textContent = '显示详细信息';
    }
  }
}

// 验证单个论文（在新窗口中打开）
async function verifySinglePaper(index) {
  const sortedPapers = [...papers].sort((a, b) => {
    const timeA = new Date(a.downloadTime || 0).getTime();
    const timeB = new Date(b.downloadTime || 0).getTime();
    return timeB - timeA;
  });
  
  const paper = sortedPapers[index];
  if (!paper) {
    alert('论文不存在');
    return;
  }
  
  // 查找该论文关联的已下载文件
  const downloadedFiles = [];
  
  // 从 paper.webMetadata.fileLinks 获取文件信息
  if (paper.webMetadata && paper.webMetadata.fileLinks) {
    for (const fileLink of paper.webMetadata.fileLinks) {
      if (fileLink.fileUrl || fileLink.downloadId) {
        downloadedFiles.push({
          name: fileLink.fileName || fileLink.label || '未知文件',
          url: fileLink.fileUrl || '',
          downloadId: fileLink.downloadId,
          label: fileLink.label || ''
        });
      }
    }
  }
  
  // 如果 paper 有 originalUrl 或 pdfUrl，也加入
  if (paper.originalUrl && !downloadedFiles.find(f => f.url === paper.originalUrl)) {
    downloadedFiles.push({
      name: '论文PDF',
      url: paper.originalUrl,
      downloadId: paper.downloadId,
      label: '论文全文'
    });
  }
  
  if (paper.pdfUrl && !downloadedFiles.find(f => f.url === paper.pdfUrl)) {
    downloadedFiles.push({
      name: '论文PDF',
      url: paper.pdfUrl,
      downloadId: paper.downloadId,
      label: '论文全文'
    });
  }
  
  // 打开新窗口进行验证
  const verificationUrl = chrome.runtime.getURL('verification.html');
  const newWindow = window.open(verificationUrl, '_blank', 'width=1200,height=800');
  
  // 等待窗口加载完成后，发送论文信息
  if (newWindow) {
    // 将论文信息和已下载文件存储到 chrome.storage，供验证页面读取
    chrome.storage.local.set({
      'singlePaperVerification': {
        paper: paper,
        index: index,
        downloadedFiles: downloadedFiles,
        timestamp: Date.now()
      }
    }, () => {
      console.log('[验证] 已保存论文信息和文件列表到存储，等待验证页面读取');
    });
  }
}

// 设置文件拖放区域
function setupFileDropZone(dropZone, index, paper, resultDiv) {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });
  
  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.add('drag-over');
    }, false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove('drag-over');
    }, false);
  });
  
  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        handleFileForVerification(file, paper, index, resultDiv);
      } else {
        alert('请选择PDF文件');
      }
    }
  }, false);
}

// 处理文件进行验证
async function handleFileForVerification(file, paper, index, resultDiv) {
  // 显示处理中
  resultDiv.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">正在读取文件...</div>';
  
  try {
    // 获取论文的webMetadata（从弹窗提取的信息）
    const webMetadata = paper.webMetadata || {
      title: paper.title,
      firstAuthor: paper.firstAuthor,
      authors: paper.authors || paper.allAuthors || [],
      date: paper.date || paper.extractedDate,
      fileLinks: []
    };
    
    // 读取文件为ArrayBuffer，然后转换为base64
    const fileReader = new FileReader();
    const fileData = await new Promise((resolve, reject) => {
      fileReader.onload = (e) => {
        const arrayBuffer = e.target.result;
        // 转换为base64字符串以便传递（使用chunk方式避免堆栈溢出）
        const uint8Array = new Uint8Array(arrayBuffer);
        let binaryString = '';
        const chunkSize = 8192; // 每次处理8KB
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
    
    // 显示验证中
    resultDiv.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">正在验证文件...</div>';
    
    // 找到当前活动标签页，以便在content script中解析
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });
    
    if (!tabs || tabs.length === 0) {
      throw new Error('无法找到活动标签页');
    }
    
    const activeTab = tabs[0];
    
    // 发送到content script解析PDF（使用文件数据而不是URL）
    const parseResult = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(activeTab.id, {
        action: 'parsePdfFromData',
        fileData: fileData.base64,
        fileName: fileData.fileName
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || 'PDF解析失败'));
        }
      });
    });
    
    if (!parseResult || !parseResult.success) {
      throw new Error(parseResult?.error || 'PDF解析失败');
    }
    
    // 提取PDF数据
    const pdfData = {
      title: parseResult.title || '',
      firstAuthor: parseResult.author || '',
      authors: parseResult.author ? parseResult.author.split(/[;,&]/).map(a => a.trim()).filter(a => a) : [],
      date: parseResult.creationDate || parseResult.modDate || '',
      fullText: parseResult.fullText || '',
      first500Chars: parseResult.first500Chars || '',
      extractedDates: parseResult.extractedDates || {} // 保存所有提取的日期
    };
    
    // 进行匹配验证（异步）
    const matchResult = await matchVerification(pdfData, webMetadata);
    
    // 构建验证结果
    const result = {
      pdfTextData: pdfData,
      matchResult: matchResult,
      timestamp: new Date().toISOString()
    };
    
    // 显示验证结果
    displayVerificationResult(result, file.name, resultDiv);
    
  } catch (error) {
    console.error('[验证] 验证失败:', error);
    resultDiv.innerHTML = `<div style="color: #f00; padding: 20px; background: #fee; border-radius: 5px;">验证失败: ${escapeHtml(error.message)}</div>`;
  }
}

// 加载拼音库（pinyin-pro）
async function loadPinyinLibrary() {
  if (window.pinyinPro) {
    return true; // 已经加载
  }
  
  return new Promise((resolve) => {
    // 检查是否已经加载
    if (window.pinyinPro) {
      resolve(true);
      return;
    }
    
    // 从CDN加载pinyin-pro (使用unpkg CDN，直接加载主文件)
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/pinyin-pro@3.12.0';
    script.onload = () => {
      console.log('[拼音库] pinyin-pro脚本加载完成');
      // 等待一下让库初始化
      setTimeout(() => {
        // 检查全局变量 window.pinyin (unpkg 通常导出为这个)
        if (window.pinyin && typeof window.pinyin === 'function') {
          console.log('[拼音库] pinyin-pro加载成功，找到 window.pinyin');
          resolve(true);
        } else if (window.pinyinPro) {
          console.log('[拼音库] pinyin-pro加载成功，找到 window.pinyinPro');
          resolve(true);
        } else {
          console.warn('[拼音库] pinyin-pro加载但未找到全局变量，将使用fallback');
          resolve(false);
        }
      }, 100);
    };
    script.onerror = () => {
      console.warn('[拼音库] pinyin-pro加载失败，使用fallback');
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

// 使用pinyin-pro转换中文为拼音
async function convertChineseToPinyinWithLibrary(chinese) {
  try {
    // 尝试加载库
    const loaded = await loadPinyinLibrary();
    
    // 检查多种可能的全局变量名
    let pinyinLib = window.pinyinPro || window.pinyin || window.PinyinPro;
    
    if (loaded && pinyinLib) {
      let pinyin = '';
      
      // 尝试不同的API调用方式
      if (typeof pinyinLib.pinyin === 'function') {
        // 方式1: pinyinPro.pinyin()
        pinyin = pinyinLib.pinyin(chinese, {
          toneType: 'none',
          type: 'all',
          v: true
        });
      } else if (typeof pinyinLib === 'function') {
        // 方式2: 直接调用函数
        pinyin = pinyinLib(chinese, {
          toneType: 'none',
          type: 'all',
          v: true
        });
      } else if (pinyinLib.convert && typeof pinyinLib.convert === 'function') {
        // 方式3: pinyinPro.convert()
        pinyin = pinyinLib.convert(chinese, {
          toneType: 'none',
          type: 'all',
          v: true
        });
      }
      
      if (pinyin && typeof pinyin === 'string' && pinyin.length > 0) {
        // pinyin-pro返回的是带空格的字符串，如 "wei jia jun" 或 "jian jiang wei"
        // 我们需要转换为 "Wei Jiajun" 格式（姓和名分开）
        const words = pinyin.split(/\s+/).filter(w => w.length > 0);
        if (words.length > 0) {
          // 首字母大写
          const capitalized = words.map(w => w.charAt(0).toUpperCase() + w.slice(1));
          const result = capitalized.join(' ');
          console.log('[拼音库] pinyin-pro转换成功:', chinese, '->', result);
          return result;
        }
        return pinyin;
      }
    }
  } catch (error) {
    console.warn('[拼音库] pinyin-pro转换失败:', error);
  }
  
  // 如果库加载失败，使用fallback
  return convertChineseToPinyinFallback(chinese);
}

// Fallback拼音转换（简化版）
function convertChineseToPinyinFallback(chinese) {
  if (!chinese || typeof chinese !== 'string') {
    return '';
  }
  
  // 如果已经是英文或包含非中文字符，直接返回
  if (!/[\u4e00-\u9fa5]/.test(chinese)) {
    return chinese.trim();
  }
  
  // 使用简化的拼音映射表
  const pinyinMap = {
    '何': 'He', '李': 'Li', '王': 'Wang', '张': 'Zhang', '刘': 'Liu', '陈': 'Chen',
    '杨': 'Yang', '赵': 'Zhao', '黄': 'Huang', '周': 'Zhou', '吴': 'Wu',
    '徐': 'Xu', '孙': 'Sun', '胡': 'Hu', '朱': 'Zhu', '高': 'Gao', '林': 'Lin',
    '郭': 'Guo', '马': 'Ma', '罗': 'Luo', '梁': 'Liang', '宋': 'Song',
    '郑': 'Zheng', '谢': 'Xie', '韩': 'Han', '唐': 'Tang', '冯': 'Feng', '于': 'Yu',
    '董': 'Dong', '萧': 'Xiao', '程': 'Cheng', '曹': 'Cao', '袁': 'Yuan', '邓': 'Deng',
    '许': 'Xu', '傅': 'Fu', '沈': 'Shen', '曾': 'Zeng', '彭': 'Peng', '吕': 'Lv',
    '苏': 'Su', '卢': 'Lu', '蒋': 'Jiang', '蔡': 'Cai', '贾': 'Jia', '丁': 'Ding',
    '魏': 'Wei', '薛': 'Xue', '叶': 'Ye', '阎': 'Yan', '余': 'Yu', '潘': 'Pan',
    '杜': 'Du', '戴': 'Dai', '夏': 'Xia', '钟': 'Zhong', '汪': 'Wang', '田': 'Tian',
    '任': 'Ren', '姜': 'Jiang', '范': 'Fan', '方': 'Fang', '石': 'Shi', '姚': 'Yao',
    '谭': 'Tan', '廖': 'Liao', '邹': 'Zou', '熊': 'Xiong', '金': 'Jin', '陆': 'Lu',
    '郝': 'Hao', '孔': 'Kong', '白': 'Bai', '崔': 'Cui', '康': 'Kang', '毛': 'Mao',
    '邱': 'Qiu', '秦': 'Qin', '江': 'Jiang', '史': 'Shi', '顾': 'Gu', '侯': 'Hou',
    '邵': 'Shao', '孟': 'Meng', '龙': 'Long', '万': 'Wan', '段': 'Duan', '雷': 'Lei',
    '钱': 'Qian', '汤': 'Tang', '尹': 'Yin', '黎': 'Li', '易': 'Yi', '常': 'Chang',
    '武': 'Wu', '乔': 'Qiao', '贺': 'He', '赖': 'Lai', '龚': 'Gong', '文': 'Wen',
    '厚': 'Hou', '凡': 'Fan', '成': 'Cheng', '琮': 'Cong', '瑜': 'Yu', '辰': 'Chen',
    '轩': 'Xuan', '金': 'Jin', '简': 'Jian', '江': 'Jiang', '伟': 'Wei', '肇': 'Zhao',
    '优': 'You', '卫': 'Wei', '佳': 'Jia', '俊': 'Jun', '丕': 'Pi', '苗': 'Miao',
    '飞': 'Fei'
  };
  
  let pinyin = '';
  for (const char of chinese) {
    if (pinyinMap[char]) {
      pinyin += pinyinMap[char].charAt(0).toUpperCase() + pinyinMap[char].slice(1) + ' ';
    } else if (/[\u4e00-\u9fa5]/.test(char)) {
      // 如果是中文但不在映射表中，保留原字符
      pinyin += char;
    } else {
      pinyin += char;
    }
  }
  
  // 清理多余空格
  pinyin = pinyin.replace(/\s+/g, ' ').trim();
  
  return pinyin;
}

// 匹配验证函数
async function matchVerification(pdfData, webMetadata) {
  const result = {
    titleMatch: false,
    authorMatch: false,
    dateMatch: false
  };
  
  // 标题匹配（支持模糊匹配和部分匹配）
  if (webMetadata.title && pdfData.title) {
    const webTitle = webMetadata.title.toLowerCase().trim();
    const pdfTitle = pdfData.title.toLowerCase().trim();
    
    // 移除常见的标点符号和多余空格，便于匹配
    const normalizeTitle = (str) => {
      return str.replace(/[:\-–—,;]/g, ' ').replace(/\s+/g, ' ').trim();
    };
    
    const normalizedWebTitle = normalizeTitle(webTitle);
    const normalizedPdfTitle = normalizeTitle(pdfTitle);
    
    // 完全匹配
    const exactMatch = normalizedWebTitle === normalizedPdfTitle;
    
    // 包含匹配（双向）
    const containsMatch = normalizedPdfTitle.includes(normalizedWebTitle) || 
                         normalizedWebTitle.includes(normalizedPdfTitle);
    
    // 相似度匹配（阈值降低到0.75，因为标题可能很长）
    const similarityMatch = calculateSimilarity(normalizedWebTitle, normalizedPdfTitle) > 0.75;
    
    // 关键词匹配：检查标题中的主要关键词是否都出现
    const webKeywords = normalizedWebTitle.split(/\s+/).filter(w => w.length > 3); // 只考虑长度>3的词
    const pdfKeywords = normalizedPdfTitle.split(/\s+/).filter(w => w.length > 3);
    const keywordMatch = webKeywords.length > 0 && pdfKeywords.length > 0 &&
                        webKeywords.every(kw => pdfKeywords.some(pkw => pkw.includes(kw) || kw.includes(pkw))) &&
                        pdfKeywords.every(pkw => webKeywords.some(kw => kw.includes(pkw) || pkw.includes(kw)));
    
    result.titleMatch = exactMatch || containsMatch || similarityMatch || keywordMatch;
    
    console.log('[验证] 标题匹配:', {
      web: webTitle,
      pdf: pdfTitle,
      normalizedWeb: normalizedWebTitle,
      normalizedPdf: normalizedPdfTitle,
      exactMatch: exactMatch,
      containsMatch: containsMatch,
      similarityMatch: similarityMatch,
      keywordMatch: keywordMatch,
      finalMatch: result.titleMatch
    });
  }
  
  // 作者匹配（支持中文转拼音）
  if (webMetadata.firstAuthor && pdfData.firstAuthor) {
    let webAuthor = webMetadata.firstAuthor.trim();
    const pdfAuthor = pdfData.firstAuthor.trim();
    
    // 如果网页作者是中文，转换为拼音
    if (/[\u4e00-\u9fa5]/.test(webAuthor)) {
      // 使用pinyin-pro库转换（异步）
      try {
        const pinyin = await convertChineseToPinyinWithLibrary(webAuthor);
        if (pinyin && pinyin !== webAuthor) {
          webAuthor = pinyin;
          console.log('[验证] 中文作者转拼音（pinyin-pro）:', webMetadata.firstAuthor, '->', webAuthor);
        } else {
          // 如果转换失败，使用fallback
          webAuthor = convertChineseToPinyinFallback(webAuthor);
          console.log('[验证] 中文作者转拼音（fallback）:', webMetadata.firstAuthor, '->', webAuthor);
        }
      } catch (error) {
        console.warn('[验证] 拼音转换失败，使用fallback:', error);
        webAuthor = convertChineseToPinyinFallback(webAuthor);
      }
    }
    
    // 转换为小写进行匹配（忽略大小写）
    const webAuthorLower = webAuthor.toLowerCase().trim();
    const pdfAuthorLower = pdfAuthor.toLowerCase().trim();
    
    console.log('[验证] 作者匹配准备:', {
      originalWeb: webMetadata.firstAuthor,
      convertedWeb: webAuthor,
      webAuthorLower: webAuthorLower,
      pdfAuthor: pdfAuthor,
      pdfAuthorLower: pdfAuthorLower
    });
    
    // 支持多种匹配方式：完全匹配、包含匹配、顺序无关匹配
    const webWords = webAuthorLower.split(/\s+/).filter(w => w.length > 0);
    const pdfWords = pdfAuthorLower.split(/\s+/).filter(w => w.length > 0);
    
    console.log('[验证] 作者分词:', {
      webWords: webWords,
      pdfWords: pdfWords
    });
    
    // 基本匹配：完全匹配、包含匹配
    let basicMatch = 
      webAuthorLower === pdfAuthorLower ||
      pdfAuthorLower.includes(webAuthorLower) ||
      webAuthorLower.includes(pdfAuthorLower);
    
    // 顺序无关匹配：所有词都匹配，但顺序可以不同
    // 例如："xu fei" 与 "fei xu" 应该匹配
    let wordMatch = false;
    if (webWords.length > 0 && pdfWords.length > 0) {
      // 如果词数相同，检查是否所有词都匹配（顺序无关）
      if (webWords.length === pdfWords.length) {
        // 检查所有词是否都在对方中（完全匹配，顺序无关）
        // 对于"xu fei"和"fei xu"，应该返回true
        wordMatch = webWords.every(w => pdfWords.includes(w)) && 
                   pdfWords.every(w => webWords.includes(w));
        
        console.log('[验证] 顺序无关匹配（完全）:', {
          webWords: webWords,
          pdfWords: pdfWords,
          match: wordMatch
        });
        
        // 如果完全匹配失败，尝试部分匹配（支持包含关系）
        if (!wordMatch) {
          const allWebWordsInPdf = webWords.every(w => 
            pdfWords.some(pw => pw === w || pw.includes(w) || w.includes(pw))
          );
          const allPdfWordsInWeb = pdfWords.every(pw => 
            webWords.some(w => w === pw || w.includes(pw) || pw.includes(w))
          );
          wordMatch = allWebWordsInPdf && allPdfWordsInWeb;
          console.log('[验证] 顺序无关匹配（部分）:', {
            allWebWordsInPdf: allWebWordsInPdf,
            allPdfWordsInWeb: allPdfWordsInWeb,
            match: wordMatch
          });
        }
      } else {
        // 如果词数不同，检查是否所有词都在对方中（部分匹配）
        // 例如："Wei Jiajun" 与 "Jiajun Wei" 应该匹配
        const allWebWordsInPdf = webWords.every(w => 
          pdfWords.some(pw => pw === w || pw.includes(w) || w.includes(pw))
        );
        const allPdfWordsInWeb = pdfWords.every(pw => 
          webWords.some(w => w === pw || w.includes(pw) || pw.includes(w))
        );
        wordMatch = allWebWordsInPdf && allPdfWordsInWeb;
        console.log('[验证] 顺序无关匹配（词数不同）:', {
          webWords: webWords,
          pdfWords: pdfWords,
          allWebWordsInPdf: allWebWordsInPdf,
          allPdfWordsInWeb: allPdfWordsInWeb,
          match: wordMatch
        });
      }
    }
    
    // 相似度匹配
    const similarityMatch = calculateSimilarity(webAuthorLower, pdfAuthorLower) > 0.7;
    
    // 组合匹配：姓和名分开匹配（支持顺序互换）
    let namePartsMatch = false;
    if (webWords.length >= 2 && pdfWords.length >= 2) {
      // 尝试匹配：姓+名 或 名+姓
      const webFirst = webWords[0];
      const webLast = webWords[webWords.length - 1];
      const pdfFirst = pdfWords[0];
      const pdfLast = pdfWords[pdfWords.length - 1];
      
      // 检查：web的姓匹配pdf的姓，web的名匹配pdf的名（相同顺序）
      const sameOrder = (
        (webFirst === pdfFirst || webFirst.includes(pdfFirst) || pdfFirst.includes(webFirst)) &&
        (webLast === pdfLast || webLast.includes(pdfLast) || pdfLast.includes(webLast))
      );
      
      // 检查：web的姓匹配pdf的名，web的名匹配pdf的姓（顺序互换）
      const reversedOrder = (
        (webFirst === pdfLast || webFirst.includes(pdfLast) || pdfLast.includes(webFirst)) &&
        (webLast === pdfFirst || webLast.includes(pdfFirst) || pdfFirst.includes(webLast))
      );
      
      namePartsMatch = sameOrder || reversedOrder;
      
      // 如果还是没匹配，尝试更宽松的匹配（支持部分包含）
      if (!namePartsMatch) {
        const looseSameOrder = (
          (webFirst.includes(pdfFirst) || pdfFirst.includes(webFirst)) &&
          (webLast.includes(pdfLast) || pdfLast.includes(webLast))
        );
        const looseReversedOrder = (
          (webFirst.includes(pdfLast) || pdfLast.includes(webFirst)) &&
          (webLast.includes(pdfFirst) || pdfFirst.includes(webLast))
        );
        namePartsMatch = looseSameOrder || looseReversedOrder;
      }
      
      // 如果还是没匹配，尝试逐个词匹配（支持顺序完全互换）
      if (!namePartsMatch) {
        // 检查所有词是否都能在对方中找到匹配
        const allWebWordsMatched = webWords.every(ww => 
          pdfWords.some(pw => pw === ww || pw.includes(ww) || ww.includes(pw))
        );
        const allPdfWordsMatched = pdfWords.every(pw => 
          webWords.some(ww => ww === pw || ww.includes(pw) || pw.includes(ww))
        );
        namePartsMatch = allWebWordsMatched && allPdfWordsMatched;
      }
      
      console.log('[验证] 姓/名匹配详情:', {
        webFirst: webFirst,
        webLast: webLast,
        pdfFirst: pdfFirst,
        pdfLast: pdfLast,
        sameOrder: sameOrder,
        reversedOrder: reversedOrder,
        namePartsMatch: namePartsMatch
      });
    }
    
    result.authorMatch = basicMatch || wordMatch || similarityMatch || namePartsMatch;
    
    console.log('[验证] 作者匹配:', {
      web: webAuthor,
      pdf: pdfAuthor,
      basicMatch: basicMatch,
      wordMatch: wordMatch,
      similarityMatch: similarityMatch,
      namePartsMatch: namePartsMatch,
      finalMatch: result.authorMatch
    });
  }
  
  // 日期匹配（尝试匹配所有提取的日期）
  if (webMetadata.date) {
    const webDate = normalizeDate(webMetadata.date);
    result.dateMatch = false;
    
    // 尝试匹配主要日期
    if (pdfData.date) {
      const pdfDate = normalizeDate(pdfData.date);
      if (webDate === pdfDate) {
        result.dateMatch = true;
        console.log('[验证] 日期匹配（主要日期）:', webDate, '===', pdfDate);
      }
    }
    
    // 如果主要日期不匹配，尝试匹配所有提取的日期
    if (!result.dateMatch && pdfData.extractedDates) {
      // 首先尝试匹配特定类型的日期
      const datesToCheck = [
        pdfData.extractedDates.availableOnline,
        pdfData.extractedDates.accepted,
        pdfData.extractedDates.received
      ].filter(d => d); // 过滤掉null值
      
      // 然后尝试匹配所有找到的日期
      if (pdfData.extractedDates.allDates && pdfData.extractedDates.allDates.length > 0) {
        datesToCheck.push(...pdfData.extractedDates.allDates);
      }
      
      // 去重
      const uniqueDates = [...new Set(datesToCheck)];
      
      for (const dateStr of uniqueDates) {
        const normalizedDate = normalizeDate(dateStr);
        if (webDate === normalizedDate) {
          result.dateMatch = true;
          console.log('[验证] 日期匹配（提取日期）:', webDate, '===', normalizedDate, '(', dateStr, ')');
          break;
        }
      }
      
      if (!result.dateMatch && uniqueDates.length > 0) {
        console.log('[验证] 日期不匹配，尝试的日期:', uniqueDates.map(d => normalizeDate(d)));
      }
    }
  }
  
  return result;
}

// 计算字符串相似度
function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;
  
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

// Levenshtein距离
function levenshteinDistance(str1, str2) {
  const matrix = [];
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[str2.length][str1.length];
}

// 标准化日期格式
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  
  // 尝试解析各种日期格式
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    // 如果不是标准格式，尝试提取YYYY-MM-DD
    const match = dateStr.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (match) {
      const year = match[1];
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return dateStr;
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 显示验证结果
function displayVerificationResult(result, fileName, resultDiv) {
  if (!result || !result.matchResult) {
    resultDiv.innerHTML = '<div style="color: #f00; padding: 20px;">验证结果无效</div>';
    return;
  }
  
  const match = result.matchResult;
  const allMatch = match.titleMatch && match.authorMatch && match.dateMatch;
  
  let resultHtml = '<div style="padding: 15px; background: #f5f5f5; border-radius: 5px; margin-top: 10px;">';
  resultHtml += `<strong>验证结果：${fileName}</strong><br><br>`;
  
  resultHtml += `<div style="margin-top: 10px;">`;
  resultHtml += `标题: <span style="color: ${match.titleMatch ? '#0a0' : '#f00'}; font-weight: bold;">${match.titleMatch ? '✓ 匹配' : '✗ 不匹配'}</span><br>`;
  resultHtml += `作者: <span style="color: ${match.authorMatch ? '#0a0' : '#f00'}; font-weight: bold;">${match.authorMatch ? '✓ 匹配' : '✗ 不匹配'}</span><br>`;
  resultHtml += `日期: <span style="color: ${match.dateMatch ? '#0a0' : '#f00'}; font-weight: bold;">${match.dateMatch ? '✓ 匹配' : '✗ 不匹配'}</span>`;
  resultHtml += `</div>`;
  
  if (allMatch) {
    resultHtml += '<div style="margin-top: 15px; padding: 10px; background: #d4edda; border-radius: 5px; color: #155724; font-weight: bold;">✓ 验证通过</div>';
  } else {
    resultHtml += '<div style="margin-top: 15px; padding: 10px; background: #f8d7da; border-radius: 5px; color: #721c24; font-weight: bold;">✗ 验证未通过</div>';
  }
  
  // 显示提取的信息（如果有）
  if (result.pdfTextData || result.ocrData) {
    const extractedData = result.pdfTextData || result.ocrData;
    resultHtml += '<div style="margin-top: 15px; padding: 10px; background: #fff; border-radius: 5px; border: 1px solid #ddd;">';
    resultHtml += '<strong>提取的信息：</strong><br>';
    if (extractedData.title) {
      resultHtml += `标题: ${escapeHtml(extractedData.title)}<br>`;
    }
    if (extractedData.firstAuthor || (extractedData.authors && extractedData.authors.length > 0)) {
      resultHtml += `作者: ${escapeHtml(extractedData.firstAuthor || extractedData.authors.join(', '))}<br>`;
    }
    if (extractedData.date) {
      resultHtml += `日期: ${escapeHtml(extractedData.date)}`;
    }
    resultHtml += '</div>';
  }
  
  resultHtml += '</div>';
  resultDiv.innerHTML = resultHtml;
}

// 导出单个论文的JSON文件（用于Python验证）
function exportPaperJson(index) {
  const sortedPapers = [...papers].sort((a, b) => {
    const timeA = new Date(a.downloadTime || 0).getTime();
    const timeB = new Date(b.downloadTime || 0).getTime();
    return timeB - timeA;
  });
  
  const paper = sortedPapers[index];
  if (!paper) {
    alert('论文不存在');
    return;
  }
  
  // 生成论文唯一标识（与background.js中的getPaperKey逻辑一致）
  const getPaperKey = (paperData) => {
    const title = (paperData.title || '').trim();
    const author = (paperData.firstAuthor || paperData.author || '').trim();
    const date = (paperData.extractedDate || paperData.date || '').trim();
    return `${title}|${author}|${date}`;
  };
  
  const paperKey = getPaperKey(paper);
  
  // 从background获取该论文的所有待处理文件信息
  chrome.runtime.sendMessage({
    action: 'getPendingFilesForPaper',
    paperKey: paperKey
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[导出JSON] 获取待处理文件失败:', chrome.runtime.lastError);
      // 继续使用原有逻辑
      generateJsonWithExistingData(paper);
      return;
    }
    
    if (!response || !response.success) {
      console.warn('[导出JSON] 未找到待处理文件，使用已有数据');
      generateJsonWithExistingData(paper);
      return;
    }
    
    // 获取用户设置的下载目录
    chrome.storage.local.get(['downloadDirectory'], (result) => {
      const downloadDir = result.downloadDirectory;
      
      if (!downloadDir) {
        alert('请先在设置中填写下载目录的绝对路径');
        return;
      }
      
      try {
        // 构建完整的元数据对象（包含所有文件信息）
        const metadata = {
          title: paper.title || '未知标题',
          firstAuthor: paper.firstAuthor || paper.author || '未知作者',
          allAuthors: paper.allAuthors || [],
          date: paper.extractedDate || paper.date || '',
          dates: paper.dates || {
            received: null,
            accepted: null,
            published: null,
            revised: null,
            other: []
          },
          pageUrl: paper.pageUrl || '',
          pageTitle: paper.pageTitle || '',
          originalUrl: paper.originalUrl || '',
          downloadTime: paper.downloadTime || new Date().toISOString(),
          downloadTimeFormatted: paper.downloadTime ? formatDate(paper.downloadTime) : '',
          files: []
        };
        
        // 从待处理文件中添加文件信息
        if (response.files && response.files.length > 0) {
          const separator = downloadDir.includes('\\') ? '\\' : '/';
          for (const file of response.files) {
            // 构建完整路径：下载目录 + 文件名
            const fileName = file.fileName || '未知文件';
            const fullPath = downloadDir + separator + fileName;
            
            metadata.files.push({
              type: file.fileType || '未知类型',
              fileName: fileName,
              filePath: fullPath,
              downloadTime: file.downloadTime ? new Date(file.downloadTime).toISOString() : paper.downloadTime || new Date().toISOString()
            });
          }
        }
        
        // 如果待处理文件为空，尝试使用已有数据
        if (metadata.files.length === 0) {
          console.warn('[导出JSON] 待处理文件列表为空，尝试使用已有数据');
          if (paper.filePath) {
            metadata.files.push({
              type: '论文全文',
              fileName: paper.fileName || paper.filePath.split(/[/\\]/).pop() || '未知文件',
              filePath: paper.filePath,
              downloadTime: paper.downloadTime || new Date().toISOString()
            });
          }
        }
        
        // 生成并下载JSON文件
        downloadJsonFile(metadata);
      } catch (error) {
        console.error('[导出JSON] 处理失败:', error);
        alert('导出失败: ' + error.message);
      }
    });
  });
}

// 使用已有数据生成JSON（备用方案）
function generateJsonWithExistingData(paper) {
  try {
    const metadata = {
      title: paper.title || '未知标题',
      firstAuthor: paper.firstAuthor || paper.author || '未知作者',
      allAuthors: paper.allAuthors || [],
      date: paper.extractedDate || paper.date || '',
      dates: paper.dates || {
        received: null,
        accepted: null,
        published: null,
        revised: null,
        other: []
      },
      pageUrl: paper.pageUrl || '',
      pageTitle: paper.pageTitle || '',
      originalUrl: paper.originalUrl || '',
      downloadTime: paper.downloadTime || new Date().toISOString(),
      downloadTimeFormatted: paper.downloadTime ? formatDate(paper.downloadTime) : '',
      files: []
    };
    
    if (paper.filePath) {
      metadata.files.push({
        type: '论文全文',
        fileName: paper.fileName || paper.filePath.split(/[/\\]/).pop() || '未知文件',
        filePath: paper.filePath,
        downloadTime: paper.downloadTime || new Date().toISOString()
      });
    }
    
    downloadJsonFile(metadata);
  } catch (error) {
    console.error('[导出JSON] 处理失败:', error);
    alert('导出失败: ' + error.message);
  }
}

// 下载JSON文件
function downloadJsonFile(metadata) {
  const jsonContent = JSON.stringify(metadata, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  
  // 使用简单的文件名（标题前30字符 + 时间戳）
  const title = metadata.title || '未知标题';
  const sanitizedTitle = title
    .replace(/[<>:"/\\|?*()\x00-\x1F]/g, '_')
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 30);
  
  const timestamp = Date.now();
  const fileName = `${sanitizedTitle}_${timestamp}.json`;
  
  chrome.downloads.download({
    url: blobUrl,
    filename: fileName,
    saveAs: false,
    conflictAction: 'uniquify'
  }, (downloadId) => {
    URL.revokeObjectURL(blobUrl);
    
    if (chrome.runtime.lastError) {
      console.error('[导出JSON] 下载失败:', chrome.runtime.lastError);
      alert('导出失败: ' + chrome.runtime.lastError.message);
    } else {
      console.log('[导出JSON] 已导出:', fileName);
      console.log('[导出JSON] 包含文件数:', metadata.files.length);
      alert('JSON文件已导出: ' + fileName + '\n包含 ' + metadata.files.length + ' 个文件');
    }
  });
}

// 注意：去重检查已在下载时自动进行
// - 在 background.js 的 downloadAndRename() 中自动检查
// - 在 background.js 的 handleQuickProcess() 中自动检查
// - 如果检测到重复，会显示通知并阻止下载
