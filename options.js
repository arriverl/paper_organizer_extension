// 配置页面脚本
'use strict';

// 默认配置
const defaultConfig = {
  selectors: {
    title: 'h1.title.mathjax, h1.title, .title, [class*="title"]',
    author: '.authors a[href*="searchtype=author"], .authors a, a[href*="/search/?searchtype=author"]',
    date: '.submission-history, [class*="submission"]'
  },
  files: [
    {
      name: 'PDF',
      selector: 'a[href$=".pdf"], a[href*="/pdf/"], a[href*="download"]',
      type: 'pdf'
    }
  ]
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  
  document.getElementById('saveBtn').addEventListener('click', saveConfig);
  document.getElementById('resetBtn').addEventListener('click', resetConfig);
  document.getElementById('addFileBtn').addEventListener('click', addFileConfig);
  
  // 绑定示例HTML输入事件，自动识别选择器
  document.getElementById('titleExample').addEventListener('input', (e) => {
    const selector = extractSelectorFromExample(e.target.value);
    if (selector) {
      document.getElementById('titleSelector').value = selector;
      document.getElementById('titleSelectorText').textContent = selector;
      document.getElementById('titleSelectorDisplay').style.display = 'block';
    } else {
      document.getElementById('titleSelectorDisplay').style.display = 'none';
    }
  });
  
  document.getElementById('authorExample').addEventListener('input', (e) => {
    const selector = extractSelectorFromExample(e.target.value);
    if (selector) {
      document.getElementById('authorSelector').value = selector;
      document.getElementById('authorSelectorText').textContent = selector;
      document.getElementById('authorSelectorDisplay').style.display = 'block';
    } else {
      document.getElementById('authorSelectorDisplay').style.display = 'none';
    }
  });
  
  document.getElementById('dateExample').addEventListener('input', (e) => {
    const selector = extractSelectorFromExample(e.target.value);
    if (selector) {
      document.getElementById('dateSelector').value = selector;
      document.getElementById('dateSelectorText').textContent = selector;
      document.getElementById('dateSelectorDisplay').style.display = 'block';
    } else {
      document.getElementById('dateSelectorDisplay').style.display = 'none';
    }
  });
  
  // 初始化文件配置列表
  renderFileConfigs();
});

// 从示例HTML中提取CSS选择器
function extractSelectorFromExample(htmlExample) {
  if (!htmlExample || !htmlExample.trim()) {
    return null;
  }
  
  try {
    // 创建临时DOM元素来解析HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlExample.trim();
    const element = tempDiv.firstElementChild;
    
    if (!element) {
      return null;
    }
    
    // 构建选择器
    let selector = element.tagName.toLowerCase();
    
    // 添加ID选择器
    if (element.id) {
      selector = `#${element.id}`;
      return selector;
    }
    
    // 添加class选择器
    if (element.className && typeof element.className === 'string' && element.className.trim()) {
      const classes = element.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        selector = classes.map(c => `.${c}`).join('');
        return selector;
      }
    }
    
    // 添加属性选择器（如果有href属性，可能是链接）
    if (element.hasAttribute('href')) {
      const href = element.getAttribute('href');
      if (href.includes('searchtype=author') || href.includes('author')) {
        selector = `${selector}[href*="author"]`;
      } else {
        selector = `${selector}[href]`;
      }
      return selector;
    }
    
    // 如果有父元素，尝试构建更具体的选择器
    if (element.parentElement && element.parentElement !== tempDiv) {
      const parent = element.parentElement;
      if (parent.className && typeof parent.className === 'string') {
        const parentClasses = parent.className.trim().split(/\s+/).filter(c => c);
        if (parentClasses.length > 0) {
          selector = `.${parentClasses[0]} ${selector}`;
        }
      }
    }
    
    return selector;
  } catch (e) {
    console.error('提取选择器失败:', e);
    return null;
  }
}

// 加载配置
function loadConfig() {
  chrome.storage.sync.get(['paperConfig'], (result) => {
    const config = result.paperConfig || defaultConfig;
    
    // 填充选择器（隐藏字段）
    document.getElementById('titleSelector').value = config.selectors?.title || defaultConfig.selectors.title;
    document.getElementById('authorSelector').value = config.selectors?.author || defaultConfig.selectors.author;
    document.getElementById('dateSelector').value = config.selectors?.date || defaultConfig.selectors.date;
    
    // 显示识别到的选择器
    const titleSelector = config.selectors?.title || defaultConfig.selectors.title;
    const authorSelector = config.selectors?.author || defaultConfig.selectors.author;
    const dateSelector = config.selectors?.date || defaultConfig.selectors.date;
    
    if (titleSelector) {
      document.getElementById('titleSelectorText').textContent = titleSelector;
      document.getElementById('titleSelectorDisplay').style.display = 'block';
    }
    if (authorSelector) {
      document.getElementById('authorSelectorText').textContent = authorSelector;
      document.getElementById('authorSelectorDisplay').style.display = 'block';
    }
    if (dateSelector) {
      document.getElementById('dateSelectorText').textContent = dateSelector;
      document.getElementById('dateSelectorDisplay').style.display = 'block';
    }
    
    // 保存配置到全局变量以便渲染文件配置
    window.currentConfig = config;
    renderFileConfigs();
  });
  
  // 加载OCR配置
  chrome.storage.local.get(['ocrConfig'], (result) => {
    const ocrConfig = result.ocrConfig || {};
    if (ocrConfig.apiKey) {
      document.getElementById('ocrApiKey').value = ocrConfig.apiKey;
    }
    if (ocrConfig.baseUrl) {
      document.getElementById('ocrBaseUrl').value = ocrConfig.baseUrl;
    }
    if (ocrConfig.model) {
      document.getElementById('ocrModel').value = ocrConfig.model;
    }
  });

  // 加载LLM配置（用于OCR后结构化整理）
  chrome.storage.local.get(['llmConfig'], (result) => {
    const llmConfig = result.llmConfig || {};
    if (llmConfig.apiKey) {
      document.getElementById('llmApiKey').value = llmConfig.apiKey;
    }
    if (llmConfig.baseUrl) {
      document.getElementById('llmBaseUrl').value = llmConfig.baseUrl;
    }
    if (llmConfig.model) {
      document.getElementById('llmModel').value = llmConfig.model;
    }
  });
}

// 渲染文件配置列表
function renderFileConfigs() {
  const container = document.getElementById('fileConfigs');
  container.innerHTML = '';
  
  const files = window.currentConfig?.files || defaultConfig.files;
  
  files.forEach((file, index) => {
    const fileGroup = document.createElement('div');
    fileGroup.className = 'file-group';
    fileGroup.innerHTML = `
      <div class="file-group-title">
        文件 ${index + 1}
        <button type="button" class="remove-file-btn" data-index="${index}">删除</button>
      </div>
      <div class="form-group">
        <label>文件名称</label>
        <input type="text" class="file-name" data-index="${index}" value="${escapeHtml(file.name || '')}" placeholder="例如: PDF, 补充材料, 代码">
      </div>
      <div class="form-group">
        <label>文件链接示例HTML</label>
        <textarea class="file-example" data-index="${index}" rows="2" placeholder="粘贴一个文件下载链接的HTML标签，例如: &lt;a href=&quot;/pdf/2512.21338&quot;&gt;View PDF&lt;/a&gt;"></textarea>
        <div class="help-text">粘贴一个包含文件下载链接的HTML标签，插件会自动识别并提取所有匹配的链接</div>
        <div class="file-selector-display" data-index="${index}" style="display: none; margin-top: 8px; padding: 8px; background: #e8f4f8; border-radius: 4px; font-size: 12px;">
          <strong>识别到的选择器:</strong> <span class="file-selector-text"></span>
        </div>
        <input type="hidden" class="file-selector" data-index="${index}" value="${escapeHtml(file.selector || '')}">
      </div>
      <div class="form-group">
        <label>文件类型</label>
        <input type="text" class="file-type" data-index="${index}" value="${escapeHtml(file.type || 'pdf')}" placeholder="例如: pdf, zip, tar.gz">
        <div class="help-text">文件扩展名，用于验证文件类型</div>
      </div>
    `;
    container.appendChild(fileGroup);
  });
  
  // 绑定删除按钮事件
  container.querySelectorAll('.remove-file-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      removeFileConfig(index);
    });
  });
  
  // 绑定示例HTML输入事件，自动识别选择器
  container.querySelectorAll('.file-example').forEach(textarea => {
    textarea.addEventListener('input', (e) => {
      const index = parseInt(e.target.dataset.index);
      const selector = extractSelectorFromExample(e.target.value);
      const selectorInput = document.querySelector(`.file-selector[data-index="${index}"]`);
      const displayDiv = document.querySelector(`.file-selector-display[data-index="${index}"]`);
      const selectorText = displayDiv?.querySelector('.file-selector-text');
      
      if (selector && selectorInput) {
        selectorInput.value = selector;
        if (displayDiv && selectorText) {
          selectorText.textContent = selector;
          displayDiv.style.display = 'block';
        }
      } else {
        if (displayDiv) {
          displayDiv.style.display = 'none';
        }
      }
    });
  });
  
  // 如果有已保存的选择器，显示它们
  files.forEach((file, index) => {
    if (file.selector) {
      const displayDiv = document.querySelector(`.file-selector-display[data-index="${index}"]`);
      const selectorText = displayDiv?.querySelector('.file-selector-text');
      if (displayDiv && selectorText) {
        selectorText.textContent = file.selector;
        displayDiv.style.display = 'block';
      }
    }
  });
}

// 添加文件配置
function addFileConfig() {
  const config = window.currentConfig || defaultConfig;
  const files = config.files || [];
  
  files.push({
    name: '',
    selector: '',
    type: 'pdf'
  });
  
  window.currentConfig = config;
  renderFileConfigs();
}

// 删除文件配置
function removeFileConfig(index) {
  const config = window.currentConfig || defaultConfig;
  const files = config.files || [];
  
  if (files.length <= 1) {
    alert('至少需要保留一个文件配置');
    return;
  }
  
  files.splice(index, 1);
  window.currentConfig = config;
  renderFileConfigs();
}

// 保存配置
function saveConfig() {
  const config = {
    selectors: {
      title: document.getElementById('titleSelector').value.trim() || defaultConfig.selectors.title,
      author: document.getElementById('authorSelector').value.trim() || defaultConfig.selectors.author,
      date: document.getElementById('dateSelector').value.trim() || defaultConfig.selectors.date
    },
    files: []
  };
  
  // 收集文件配置
  document.querySelectorAll('.file-group').forEach((group, index) => {
    const name = group.querySelector('.file-name').value.trim();
    const selector = group.querySelector('.file-selector').value.trim();
    const type = group.querySelector('.file-type').value.trim();
    
    if (name && selector) {
      config.files.push({
        name: name,
        selector: selector,
        type: type || 'pdf'
      });
    }
  });
  
  // 确保至少有一个文件配置
  if (config.files.length === 0) {
    config.files = defaultConfig.files;
  }
  
  // 保存到chrome.storage
  chrome.storage.sync.set({ paperConfig: config }, () => {
    showSuccessMessage();
    console.log('配置已保存:', config);
  });
  
  // 保存OCR配置
  const ocrConfig = {
    apiKey: document.getElementById('ocrApiKey').value.trim(),
    baseUrl: document.getElementById('ocrBaseUrl').value.trim() || 'https://api.tokenpony.cn/v1',
    model: document.getElementById('ocrModel').value.trim() || 'deepseek-ocr'
  };
  
  chrome.storage.local.set({ ocrConfig: ocrConfig }, () => {
    console.log('OCR配置已保存:', { baseUrl: ocrConfig.baseUrl, model: ocrConfig.model, hasApiKey: !!ocrConfig.apiKey });
  });

  // 保存LLM配置
  const llmConfig = {
    apiKey: document.getElementById('llmApiKey').value.trim(),
    baseUrl: document.getElementById('llmBaseUrl').value.trim(),
    model: document.getElementById('llmModel').value.trim() || 'deepseek-v3.2'
  };
  
  chrome.storage.local.set({ llmConfig: llmConfig }, () => {
    console.log('LLM配置已保存:', { baseUrl: llmConfig.baseUrl || '(reuse ocrBaseUrl)', model: llmConfig.model, hasApiKey: !!llmConfig.apiKey });
  });
}

// 重置配置
function resetConfig() {
  if (confirm('确定要重置为默认配置吗？')) {
    window.currentConfig = defaultConfig;
    renderFileConfigs();
    
    document.getElementById('titleSelector').value = defaultConfig.selectors.title;
    document.getElementById('authorSelector').value = defaultConfig.selectors.author;
    document.getElementById('dateSelector').value = defaultConfig.selectors.date;
    
    chrome.storage.sync.set({ paperConfig: defaultConfig }, () => {
      showSuccessMessage();
    });
  }
}

// 显示成功消息
function showSuccessMessage() {
  const message = document.getElementById('successMessage');
  message.classList.add('show');
  setTimeout(() => {
    message.classList.remove('show');
  }, 3000);
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

