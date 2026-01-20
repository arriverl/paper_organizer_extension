// 内容脚本：监听页面上的PDF下载链接点击
(function() {
  'use strict';
  
  // 配置缓存
  let cachedConfig = null;
  
  // 获取配置（带缓存）
  async function getConfig() {
    if (cachedConfig) {
      return cachedConfig;
    }
    
    return new Promise((resolve) => {
      chrome.storage.sync.get(['paperConfig'], (result) => {
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
        
        cachedConfig = result.paperConfig || defaultConfig;
        resolve(cachedConfig);
      });
    });
  }
  
  // 使用配置的选择器查询元素
  function queryWithConfig(selectors) {
    if (!selectors) return null;
    
    const selectorList = selectors.split(',').map(s => s.trim());
    for (const selector of selectorList) {
      try {
        const element = document.querySelector(selector);
        if (element) return element;
      } catch (e) {
        console.warn('[配置选择器] 无效的选择器:', selector, e);
      }
    }
    return null;
  }
  
  // 使用配置的选择器查询所有元素
  function queryAllWithConfig(selectors) {
    if (!selectors) return [];
    
    const selectorList = selectors.split(',').map(s => s.trim());
    const results = [];
    for (const selector of selectorList) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          results.push(...Array.from(elements));
        }
      } catch (e) {
        console.warn('[配置选择器] 无效的选择器:', selector, e);
      }
    }
    return results;
  }
  
  // 检测并标记PDF和图像链接
  function markPdfLinks() {
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
      const href = link.href.toLowerCase();
      const linkText = link.textContent.toLowerCase().trim();
      const linkClass = link.className.toLowerCase();
      
      // 检测PDF链接的多种方式
      const isPdfLink = 
        href.endsWith('.pdf') || 
        href.includes('.pdf?') || 
        href.includes('.pdf#') ||
        href.includes('/pdf/') ||  // arXiv格式: /pdf/2512.21110.pdf
        href.includes('stamp/stamp.jsp') ||  // IEEE Xplore stamp页面
        (linkText.includes('pdf') && (linkText.includes('view') || linkText.includes('download') || linkText.includes('查看'))) ||
        (linkClass.includes('pdf') && linkText !== '');  // IEEE Xplore PDF按钮
      
      // 检测图像链接
      const isImageLink = 
        href.match(/\.(jpg|jpeg|png|gif|bmp|webp)(\?|#|$)/i) ||
        (linkText.includes('image') || linkText.includes('图片') || linkText.includes('截图'));
      
      if (isPdfLink) {
        // 避免重复添加事件监听器
        if (!link.hasAttribute('data-paper-download')) {
          link.setAttribute('data-paper-download', 'true');
          link.addEventListener('click', handlePdfClick, true);
          console.log('[论文助手] 标记PDF链接:', href);
        }
      } else if (isImageLink) {
        // 标记图像链接，支持OCR识别
        if (!link.hasAttribute('data-image-ocr')) {
          link.setAttribute('data-image-ocr', 'true');
          link.addEventListener('click', handleImageClick, true);
          console.log('[论文助手] 标记图像链接:', href);
        }
      }
    });
    
    // 检测页面中的图像元素（用于右键菜单或直接识别）
    markImageElements();
    
    // 特别处理IEEE Xplore的PDF按钮
    markIeeePdfButtons();
  }
  
  // 标记页面中的图像元素
  function markImageElements() {
    const images = document.querySelectorAll('img[src]');
    images.forEach(img => {
      const src = img.src.toLowerCase();
      // 检测是否是论文相关的图像
      if (src.match(/\.(jpg|jpeg|png|gif|bmp|webp)(\?|#|$)/i)) {
        if (!img.hasAttribute('data-ocr-enabled')) {
          img.setAttribute('data-ocr-enabled', 'true');
          img.style.cursor = 'pointer';
          img.title = '点击进行OCR识别';
          img.addEventListener('click', handleImageElementClick, true);
        }
      }
    });
  }
  
  // 处理图像链接点击
  function handleImageClick(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const link = event.currentTarget;
    const imageUrl = link.href;
    
    console.log('[论文助手] 检测到图像链接:', imageUrl);
    
    // 发送消息到background script进行OCR识别
    chrome.runtime.sendMessage({
      action: 'ocrImage',
      imageUrl: imageUrl,
      pageUrl: window.location.href,
      pageTitle: document.title
    });
  }
  
  // 处理图像元素点击
  function handleImageElementClick(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const img = event.currentTarget;
    const imageUrl = img.src;
    
    console.log('[论文助手] 检测到图像元素:', imageUrl);
    
    // 发送消息进行OCR识别
    chrome.runtime.sendMessage({
      action: 'ocrImage',
      imageUrl: imageUrl,
      pageUrl: window.location.href,
      pageTitle: document.title
    });
  }
  
  // 特别处理IEEE Xplore的PDF按钮
  function markIeeePdfButtons() {
    if (!window.location.hostname.includes('ieeexplore.ieee.org')) {
      return;
    }
    
    // 查找IEEE Xplore的PDF按钮（可能是按钮或链接）
    const pdfButtons = document.querySelectorAll(
      'a[href*="stamp"], button[onclick*="stamp"], .pdf-button, [class*="pdf"]'
    );
    
    pdfButtons.forEach(button => {
      if (!button.hasAttribute('data-paper-download')) {
        button.setAttribute('data-paper-download', 'true');
        button.addEventListener('click', handleIeeePdfClick, true);
        console.log('[论文助手] 标记IEEE PDF按钮');
      }
    });
  }
  
  // 从arXiv页面提取元数据（备用方案）
  // 提取表格格式的元数据（默认规则）
  function extractTableFormatMetadata() {
    try {
      const metadata = {
        title: '',
        authors: [],
        date: '',
        firstAuthor: '',
        authorRole: '', // 'first' 或 'equal'
        allAuthors: []
      };
      
      // 查找所有包含 data-v-b91c72f2 属性的 tr 元素
      // 也支持其他可能的表格格式（弹出页面可能使用不同的属性）
      let rows = document.querySelectorAll('tr[data-v-b91c72f2]');
      
      // 如果没找到，尝试查找其他可能的表格行（支持弹出页面）
      if (rows.length === 0) {
        // 尝试查找包含 class="title" 的 td 的 tr 元素
        const titleCells = document.querySelectorAll('td.title, td[class*="title"]');
        if (titleCells.length > 0) {
          rows = Array.from(new Set(Array.from(titleCells).map(cell => cell.closest('tr')))).filter(tr => tr !== null);
        }
      }
      
      for (const row of rows) {
        // 支持两种选择器：有data-v-b91c72f2属性的，或所有td
        let cells = row.querySelectorAll('td[data-v-b91c72f2]');
        if (cells.length === 0) {
          cells = row.querySelectorAll('td');
        }
        if (cells.length < 2) continue;
        
        // 检查是否是"托举对象"行（提取人名）
        const firstCell = cells[0];
        const firstCellText = firstCell ? firstCell.textContent.trim() : '';
        
        if (firstCell && firstCell.classList.contains('title') && firstCellText === '托举对象') {
          // 查找第二个单元格（托举对象的值）
          const authorCell = cells[1];
          if (authorCell) {
            const authorName = authorCell.textContent.trim();
            if (authorName && authorName !== '托举对象') {
              metadata.firstAuthor = authorName;
              metadata.authors.push(authorName);
              metadata.allAuthors.push(authorName);
              
              // 转换中文名为拼音（用于匹配）
              // 优先使用后备方案（同步），如果 pinyin-pro 已加载则后续更新
              const fallbackPinyin = convertChineseToPinyinFallback(authorName);
              if (fallbackPinyin && fallbackPinyin !== authorName) {
                metadata.firstAuthorPinyin = fallbackPinyin;
              }
              
              // 如果 pinyin-pro 已加载，尝试使用它（异步更新）
              if (window.pinyinPro && typeof window.pinyinPro.pinyin === 'function') {
                convertChineseToPinyin(authorName).then(pinyinName => {
                  if (pinyinName && pinyinName !== authorName) {
                    metadata.firstAuthorPinyin = pinyinName;
                  }
                }).catch(() => {
                  // 如果转换失败，保持后备方案的结果
                });
              }
            }
          }
        }
        
        // 检查是否是"论文名称"行（提取标题）
        if (firstCell && firstCell.classList.contains('title') && 
            (firstCellText === '论文名称' || firstCellText === '论文标题')) {
          // 标题可能在第二个单元格，也可能跨多个单元格（colspan）
          for (let i = 1; i < cells.length; i++) {
            const titleCell = cells[i];
            if (titleCell) {
              const titleText = titleCell.textContent.trim();
              // 跳过空单元格和"论文名称"标签本身
              if (titleText && titleText !== '论文名称' && titleText !== '论文标题' && titleText.length > 10) {
                metadata.title = titleText;
                break;
              }
            }
          }
        }
        
        // 也支持直接查找包含标题文本的单元格（弹出页面可能格式不同）
        if (!metadata.title && firstCellText && 
            (firstCellText.includes('论文') || firstCellText.includes('标题') || firstCellText.includes('Title'))) {
          for (let i = 1; i < cells.length; i++) {
            const titleCell = cells[i];
            if (titleCell) {
              const titleText = titleCell.textContent.trim();
              if (titleText && titleText.length > 10) { // 标题通常比较长
                metadata.title = titleText;
                break;
              }
            }
          }
        }
        
        // 检查是否是"本人作者属性"行（提取作者角色）
        // 注意：本人作者属性可能在行的任意位置（如第3、4列）
        for (let i = 0; i < cells.length - 1; i++) {
          const cell = cells[i];
          if (cell && cell.classList.contains('title')) {
            const cellText = cell.textContent.trim();
            if (cellText === '本人作者属性') {
              const roleCell = cells[i + 1];
              if (roleCell) {
                const role = roleCell.textContent.trim();
                if (role.includes('第一作者') || role === '第一作者') {
                  metadata.authorRole = 'first';
                  metadata.hasEqualContribution = false;
                } else if (role.includes('共一') || role.includes('共同第一') || role.includes('共同一作')) {
                  metadata.authorRole = 'equal';
                  metadata.hasEqualContribution = true;
                }
              }
            }
          }
        }
      }
      
      // 查找日期（格式：2025-09-29）
      // 首先查找包含"日期"或"Date"标签的行
      let dateFound = false;
      for (const row of rows) {
        let cells = row.querySelectorAll('td[data-v-b91c72f2]');
        if (cells.length === 0) {
          cells = row.querySelectorAll('td');
        }
        if (cells.length < 2) continue;
        
        // 检查所有单元格，查找包含"日期"、"发表"、"录用"等关键词的标签
        for (let i = 0; i < cells.length - 1; i++) {
          const cell = cells[i];
          if (cell && cell.classList.contains('title')) {
            const labelText = cell.textContent.trim();
            // 检查是否是日期相关的标签
            if (labelText.includes('日期') || labelText.includes('Date') || 
                labelText.includes('发表') || labelText.includes('录用') ||
                labelText.includes('Publication') || labelText.includes('Acceptance') ||
                labelText.includes('发表/录用日期')) {
              // 查找日期格式的单元格（在当前单元格后面）
              for (let j = i + 1; j < cells.length; j++) {
                const dateCell = cells[j];
                if (dateCell) {
                  const text = dateCell.textContent.trim();
                  // 匹配 YYYY-MM-DD 格式
                  const dateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
                  if (dateMatch) {
                    metadata.date = dateMatch[1];
                    dateFound = true;
                    break;
                  }
                }
              }
              if (dateFound) break;
            }
          }
        }
        if (dateFound) break;
      }
      
      // 如果还没找到，在所有单元格中查找日期格式
      if (!dateFound) {
        const allCells = document.querySelectorAll('td[data-v-b91c72f2], td');
        for (const cell of allCells) {
          const text = cell.textContent.trim();
          // 匹配 YYYY-MM-DD 格式
          const dateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            metadata.date = dateMatch[1];
            break;
          }
        }
      }
      
      // 提取文件链接（正式录用通知、证明材料、论文全文、其他证明材料）
      const fileLinks = [];
      const fileTypes = ['正式录用通知', '证明材料', '论文全文', '其他证明材料'];
      
      for (const row of rows) {
        let cells = row.querySelectorAll('td[data-v-b91c72f2]');
        if (cells.length === 0) {
          cells = row.querySelectorAll('td');
        }
        if (cells.length < 2) continue;
        
        const firstCell = cells[0];
        if (firstCell && firstCell.classList.contains('title')) {
          const title = firstCell.textContent.trim();
          if (fileTypes.includes(title)) {
            // 查找该行中的所有文件（每个 <p> 标签可能包含一个文件）
            // 先尝试查找所有包含文件的 <p> 标签
            let fileParagraphs = row.querySelectorAll('p[data-v-b91c72f2]');
            if (fileParagraphs.length === 0) {
              fileParagraphs = row.querySelectorAll('p');
            }
            
            // 如果找到了多个文件段落，逐个处理
            if (fileParagraphs.length > 0) {
              for (const paragraph of fileParagraphs) {
                // 在每个段落中查找文件名和下载链接
                let fileNameSpan = paragraph.querySelector('span[data-v-b91c72f2]');
                if (!fileNameSpan) {
                  const allSpans = paragraph.querySelectorAll('span');
                  for (const span of allSpans) {
                    const spanText = span.textContent.trim();
                    if (spanText && (spanText.includes('.pdf') || spanText.includes('.PDF'))) {
                      fileNameSpan = span;
                      break;
                    }
                  }
                }
                const fileName = fileNameSpan ? fileNameSpan.textContent.trim() : '';
                
                // 在该段落中查找下载链接
                let allLinks = paragraph.querySelectorAll('a[data-v-b91c72f2]');
                if (allLinks.length === 0) {
                  allLinks = paragraph.querySelectorAll('a');
                }
                let downloadLink = null;
                
                for (const link of allLinks) {
                  const linkInner = link.querySelector('.el-link--inner, span');
                  const linkText = linkInner ? linkInner.textContent.trim() : link.textContent.trim();
                  if (linkText.includes('下载') || linkText.toLowerCase().includes('download')) {
                    downloadLink = link;
                    break;
                  }
                }
                
                if (downloadLink) {
                  let fileUrl = downloadLink.href;
                  if (!fileUrl || fileUrl === '#' || fileUrl.startsWith('javascript:')) {
                    const dataUrl = downloadLink.getAttribute('data-url') || 
                                   downloadLink.getAttribute('data-href') ||
                                   downloadLink.getAttribute('data-file-url') ||
                                   downloadLink.getAttribute('href');
                    if (dataUrl && !dataUrl.startsWith('javascript:')) {
                      fileUrl = dataUrl;
                    } else {
                      fileUrl = null;
                    }
                  }
                  
                  fileLinks.push({
                    type: title,
                    name: fileName,
                    url: fileUrl,
                    element: downloadLink
                  });
                }
              }
            } else {
              // 如果没有找到文件段落，使用原来的逻辑（向后兼容）
              // 查找文件名（在span中，支持有或没有data-v-b91c72f2属性）
              let fileNameSpan = row.querySelector('span[data-v-b91c72f2]');
              if (!fileNameSpan) {
                // 如果没有data-v-b91c72f2属性，查找所有span
                const allSpans = row.querySelectorAll('span');
                for (const span of allSpans) {
                  const spanText = span.textContent.trim();
                  // 如果span包含.pdf文件名
                  if (spanText && (spanText.includes('.pdf') || spanText.includes('.PDF'))) {
                    fileNameSpan = span;
                    break;
                  }
                }
              }
              const fileName = fileNameSpan ? fileNameSpan.textContent.trim() : '';
              
              // 查找所有链接，找到包含"下载"文本的链接
              // 优先查找有data-v-b91c72f2属性的，如果没有则查找所有a标签
              let allLinks = row.querySelectorAll('a[data-v-b91c72f2]');
              if (allLinks.length === 0) {
                allLinks = row.querySelectorAll('a');
              }
              let downloadLink = null;
              
              for (const link of allLinks) {
                // 查找链接内的文本（可能在span.el-link--inner中）
                const linkInner = link.querySelector('.el-link--inner, span');
                const linkText = linkInner ? linkInner.textContent.trim() : link.textContent.trim();
                if (linkText.includes('下载') || linkText.toLowerCase().includes('download')) {
                  downloadLink = link;
                  break;
                }
              }
              
              if (downloadLink) {
                // 尝试获取下载URL
                let fileUrl = downloadLink.href;
                
                // 如果href是空的或javascript:，尝试从其他属性获取
                if (!fileUrl || fileUrl === '#' || fileUrl.startsWith('javascript:')) {
                  // 检查是否有data属性存储URL
                  const dataUrl = downloadLink.getAttribute('data-url') || 
                                 downloadLink.getAttribute('data-href') ||
                                 downloadLink.getAttribute('data-file-url') ||
                                 downloadLink.getAttribute('href');
                  if (dataUrl && !dataUrl.startsWith('javascript:')) {
                    fileUrl = dataUrl;
                  } else {
                    // 如果无法获取URL，设置为null，后续通过点击按钮下载
                    console.warn(`[表格提取] 无法从链接获取 ${title} 的URL，将尝试点击下载按钮`);
                    fileUrl = null;
                  }
                }
                
                fileLinks.push({
                  type: title,
                  name: fileName,
                  url: fileUrl,
                  element: downloadLink
                });
              } else {
                console.warn(`[表格提取] 未找到 ${title} 的下载链接`);
              }
            }
          }
        }
      }
      
      if (fileLinks.length > 0) {
        metadata.fileLinks = fileLinks;
        console.log('[表格提取] 找到文件链接:', fileLinks);
      }
      
      // 如果提取到了任何信息，返回metadata
      if (metadata.title || metadata.firstAuthor || metadata.date || metadata.fileLinks) {
        console.log('[表格提取] 提取到的元数据:', metadata);
        return metadata;
      }
      
      return null;
    } catch (error) {
      console.error('[表格提取] 提取失败:', error);
      return null;
    }
  }
  
  // 中文转拼音（同步后备方案，用于匹配）
  // 注意：这是一个简化版本，对于复杂的中文名可能需要使用专业的拼音库
  function convertChineseToPinyinFallback(chinese) {
    if (!chinese || typeof chinese !== 'string') {
      return '';
    }
    
    // 如果已经是英文或包含非中文字符，直接返回
    if (!/[\u4e00-\u9fa5]/.test(chinese)) {
      return chinese.trim();
    }
    
    // 这是一个简化的拼音转换表（常用姓氏和名字）
    // 实际应用中可以使用更完整的拼音库，如 pinyin-pro 或 pinyinjs
    const pinyinMap = {
      // 常用姓氏
      '何': 'He', '李': 'Li', '王': 'Wang', '张': 'Zhang', '刘': 'Liu', '陈': 'Chen',
      '杨': 'Yang', '赵': 'Zhao', '黄': 'Huang', '周': 'Zhou', '吴': 'Wu',
      '徐': 'Xu', '孙': 'Sun', '胡': 'Hu', '朱': 'Zhu', '高': 'Gao',
      '林': 'Lin', '郭': 'Guo', '马': 'Ma', '罗': 'Luo', '梁': 'Liang',
      '宋': 'Song', '郑': 'Zheng', '谢': 'Xie', '韩': 'Han', '唐': 'Tang',
      '冯': 'Feng', '于': 'Yu', '董': 'Dong', '萧': 'Xiao', '程': 'Cheng',
      '曹': 'Cao', '袁': 'Yuan', '邓': 'Deng', '许': 'Xu', '傅': 'Fu',
      '沈': 'Shen', '曾': 'Zeng', '彭': 'Peng', '吕': 'Lv', '苏': 'Su',
      '卢': 'Lu', '蒋': 'Jiang', '蔡': 'Cai', '贾': 'Jia', '丁': 'Ding',
      '魏': 'Wei', '薛': 'Xue', '叶': 'Ye', '阎': 'Yan', '余': 'Yu',
      '潘': 'Pan', '杜': 'Du', '戴': 'Dai', '夏': 'Xia', '钟': 'Zhong',
      '汪': 'Wang', '田': 'Tian', '任': 'Ren', '姜': 'Jiang', '范': 'Fan',
      '方': 'Fang', '石': 'Shi', '姚': 'Yao', '谭': 'Tan', '廖': 'Liao',
      '邹': 'Zou', '熊': 'Xiong', '金': 'Jin', '陆': 'Lu', '郝': 'Hao',
      '孔': 'Kong', '白': 'Bai', '崔': 'Cui', '康': 'Kang', '毛': 'Mao',
      '邱': 'Qiu', '秦': 'Qin', '江': 'Jiang', '史': 'Shi', '顾': 'Gu',
      '侯': 'Hou', '邵': 'Shao', '孟': 'Meng', '龙': 'Long', '万': 'Wan',
      '段': 'Duan', '雷': 'Lei', '钱': 'Qian', '汤': 'Tang', '尹': 'Yin',
      '黎': 'Li', '易': 'Yi', '常': 'Chang', '武': 'Wu', '乔': 'Qiao',
      '贺': 'He', '赖': 'Lai', '龚': 'Gong', '文': 'Wen',
      // 常用名字字符
      '辰': 'Chen', '轩': 'Xuan', '浩': 'Hao', '宇': 'Yu', '杰': 'Jie',
      '明': 'Ming', '伟': 'Wei', '强': 'Qiang', '磊': 'Lei', '军': 'Jun',
      '洋': 'Yang', '勇': 'Yong', '艳': 'Yan', '娜': 'Na', '敏': 'Min',
      '静': 'Jing', '丽': 'Li', '芳': 'Fang', '华': 'Hua', '秀': 'Xiu',
      '英': 'Ying', '兰': 'Lan', '红': 'Hong', '霞': 'Xia', '雪': 'Xue',
      '梅': 'Mei', '莉': 'Li', '萍': 'Ping', '颖': 'Ying', '欣': 'Xin',
      '文': 'Wen', '婷': 'Ting', '丹': 'Dan', '玲': 'Ling', '慧': 'Hui',
      '云': 'Yun', '飞': 'Fei', '鹏': 'Peng', '超': 'Chao', '波': 'Bo',
      '涛': 'Tao', '辉': 'Hui', '刚': 'Gang', '峰': 'Feng', '建': 'Jian',
      '东': 'Dong', '南': 'Nan', '西': 'Xi', '北': 'Bei', '中': 'Zhong',
      '国': 'Guo', '家': 'Jia', '人': 'Ren', '民': 'Min', '大': 'Da',
      '小': 'Xiao', '新': 'Xin', '老': 'Lao', '好': 'Hao', '美': 'Mei',
      '学': 'Xue', '生': 'Sheng', '师': 'Shi', '长': 'Chang', '校': 'Xiao',
      // 添加更多常见字符
      '琮': 'Cong', '瑜': 'Yu'
    };
    
    let pinyin = '';
    for (const char of chinese) {
      if (pinyinMap[char]) {
        if (pinyin.length === 0) {
          pinyin += pinyinMap[char].charAt(0).toUpperCase() + pinyinMap[char].slice(1);
        } else {
          pinyin += ' ' + (pinyinMap[char].charAt(0).toUpperCase() + pinyinMap[char].slice(1));
        }
      } else if (/[\u4e00-\u9fa5]/.test(char)) {
        // 如果是中文但不在映射表中，保留原字符
        pinyin += char;
      } else {
        pinyin += char;
      }
    }
    
    // 清理多余空格，并格式化（姓氏和名字之间用空格分隔）
    pinyin = pinyin.replace(/\s+/g, ' ').trim();
    
    return pinyin;
  }

  // 中文转拼音（简化版，用于匹配）
  // 注意：这是一个简化版本，对于复杂的中文名可能需要使用专业的拼音库
  function convertChineseToPinyin(chinese) {
    if (!chinese || typeof chinese !== 'string') {
      return '';
    }
    
    // 如果已经是英文或包含非中文字符，直接返回
    if (!/[\u4e00-\u9fa5]/.test(chinese)) {
      return chinese.trim();
    }
    
    // 这是一个简化的拼音转换表（常用姓氏和名字）
    // 实际应用中可以使用更完整的拼音库，如 pinyin-pro 或 pinyinjs
    const pinyinMap = {
      // 常用姓氏
      '何': 'He', '李': 'Li', '王': 'Wang', '张': 'Zhang', '刘': 'Liu', '陈': 'Chen',
      '杨': 'Yang', '赵': 'Zhao', '黄': 'Huang', '周': 'Zhou', '吴': 'Wu',
      '徐': 'Xu', '孙': 'Sun', '胡': 'Hu', '朱': 'Zhu', '高': 'Gao',
      '林': 'Lin', '郭': 'Guo', '马': 'Ma', '罗': 'Luo', '梁': 'Liang',
      '宋': 'Song', '郑': 'Zheng', '谢': 'Xie', '韩': 'Han', '唐': 'Tang',
      '冯': 'Feng', '于': 'Yu', '董': 'Dong', '萧': 'Xiao', '程': 'Cheng',
      '曹': 'Cao', '袁': 'Yuan', '邓': 'Deng', '许': 'Xu', '傅': 'Fu',
      '沈': 'Shen', '曾': 'Zeng', '彭': 'Peng', '吕': 'Lv', '苏': 'Su',
      '卢': 'Lu', '蒋': 'Jiang', '蔡': 'Cai', '贾': 'Jia', '丁': 'Ding',
      '魏': 'Wei', '薛': 'Xue', '叶': 'Ye', '阎': 'Yan', '余': 'Yu',
      '潘': 'Pan', '杜': 'Du', '戴': 'Dai', '夏': 'Xia', '钟': 'Zhong',
      '汪': 'Wang', '田': 'Tian', '任': 'Ren', '姜': 'Jiang', '范': 'Fan',
      '方': 'Fang', '石': 'Shi', '姚': 'Yao', '谭': 'Tan', '廖': 'Liao',
      '邹': 'Zou', '熊': 'Xiong', '金': 'Jin', '陆': 'Lu', '郝': 'Hao',
      '孔': 'Kong', '白': 'Bai', '崔': 'Cui', '康': 'Kang', '毛': 'Mao',
      '邱': 'Qiu', '秦': 'Qin', '江': 'Jiang', '史': 'Shi', '顾': 'Gu',
      '侯': 'Hou', '邵': 'Shao', '孟': 'Meng', '龙': 'Long', '万': 'Wan',
      '段': 'Duan', '雷': 'Lei', '钱': 'Qian', '汤': 'Tang', '尹': 'Yin',
      '黎': 'Li', '易': 'Yi', '常': 'Chang', '武': 'Wu', '乔': 'Qiao',
      '贺': 'He', '赖': 'Lai', '龚': 'Gong', '文': 'Wen',
      // 常用名字字符
      '辰': 'Chen', '轩': 'Xuan', '浩': 'Hao', '宇': 'Yu', '杰': 'Jie',
      '明': 'Ming', '伟': 'Wei', '强': 'Qiang', '磊': 'Lei', '军': 'Jun',
      '洋': 'Yang', '勇': 'Yong', '艳': 'Yan', '娜': 'Na', '敏': 'Min',
      '静': 'Jing', '丽': 'Li', '芳': 'Fang', '华': 'Hua', '秀': 'Xiu',
      '英': 'Ying', '兰': 'Lan', '红': 'Hong', '霞': 'Xia', '雪': 'Xue',
      '梅': 'Mei', '莉': 'Li', '萍': 'Ping', '颖': 'Ying', '欣': 'Xin',
      '文': 'Wen', '婷': 'Ting', '丹': 'Dan', '玲': 'Ling', '慧': 'Hui',
      '云': 'Yun', '飞': 'Fei', '鹏': 'Peng', '超': 'Chao', '波': 'Bo',
      '涛': 'Tao', '辉': 'Hui', '刚': 'Gang', '峰': 'Feng', '建': 'Jian',
      '东': 'Dong', '南': 'Nan', '西': 'Xi', '北': 'Bei', '中': 'Zhong',
      '国': 'Guo', '家': 'Jia', '人': 'Ren', '民': 'Min', '大': 'Da',
      '小': 'Xiao', '新': 'Xin', '老': 'Lao', '好': 'Hao', '美': 'Mei',
      '学': 'Xue', '生': 'Sheng', '师': 'Shi', '长': 'Chang', '校': 'Xiao'
    };
    
    let pinyin = '';
    for (const char of chinese) {
      if (pinyinMap[char]) {
        if (pinyin.length === 0 || (pinyin.length > 0 && pinyin[pinyin.length - 1] === ' ')) {
          pinyin += pinyinMap[char].charAt(0).toUpperCase() + pinyinMap[char].slice(1);
        } else {
          pinyin += pinyinMap[char].charAt(0).toUpperCase() + pinyinMap[char].slice(1);
        }
      } else if (/[\u4e00-\u9fa5]/.test(char)) {
        pinyin += char;
      } else {
        pinyin += char;
      }
    }
    
    // 清理多余空格，并格式化（姓氏和名字之间用空格分隔）
    pinyin = pinyin.replace(/\s+/g, ' ').trim();
    
    return pinyin;
  }

  // 保存提取的元数据到论文列表
  function saveExtractedMetadataToPaperList(metadata) {
    try {
    if (!metadata || (!metadata.title && !metadata.firstAuthor)) {
      console.warn('[弹窗提取] 元数据无效，跳过保存:', metadata);
      return;
    }
    
    // 构建论文信息对象
    const paperInfo = {
      title: metadata.title || '未知标题',
      firstAuthor: metadata.firstAuthor || '未知作者',
      authors: metadata.authors || [],
      allAuthors: metadata.allAuthors || metadata.authors || [],
      date: metadata.date || '',
      extractedDate: metadata.date || '',
      dates: metadata.dates || {
        received: null,
        accepted: null,
        published: null,
        revised: null,
        other: []
      },
      hasEqualContribution: metadata.hasEqualContribution || false,
      authorRole: metadata.authorRole || '',
      firstAuthorPinyin: metadata.firstAuthorPinyin || '',
      pageUrl: window.location.href,
      pageTitle: document.title,
      downloadTime: new Date().toISOString(),
      source: '弹窗提取',
      webMetadata: metadata
    };
    
    console.log('[弹窗提取] 准备保存论文信息:', {
      title: paperInfo.title,
      firstAuthor: paperInfo.firstAuthor,
      date: paperInfo.date
    });
      
      // 检查chrome.runtime是否可用
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        console.error('[弹窗提取] Chrome runtime不可用，可能扩展已重新加载');
        return;
      }
    
    // 先检查是否重复
      try {
    chrome.runtime.sendMessage({
      action: 'checkPaperDuplicate',
      paperInfo: paperInfo
    }, (response) => {
      if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            console.error('[弹窗提取] 检查重复失败 - 连接错误:', errorMsg);
            // 如果是扩展上下文失效，不继续处理
            if (errorMsg && errorMsg.includes('Extension context invalidated')) {
              console.error('[弹窗提取] 扩展上下文已失效，请刷新页面后重试');
              return;
            }
        // 如果检查失败，仍然尝试保存（可能是background script未加载）
        console.log('[弹窗提取] 跳过重复检查，直接保存论文信息');
        savePaperInfoToBackground(paperInfo);
        return;
      }
      
      if (!response) {
        console.warn('[弹窗提取] 检查重复返回空响应，跳过重复检查，直接保存');
        savePaperInfoToBackground(paperInfo);
        return;
      }
      
      if (response.duplicate) {
        console.log('[弹窗提取] 检测到重复论文:', response.reason);
        console.log('[弹窗提取] 已存在的论文:', response.existingPaper);
        // 不保存，也不触发下载
        return;
      }
      
      // 没有重复，保存论文信息
      console.log('[弹窗提取] 未检测到重复，开始保存论文信息');
      savePaperInfoToBackground(paperInfo);
    });
      } catch (error) {
        console.error('[弹窗提取] 发送消息时出错:', error);
        if (error.message && error.message.includes('Extension context invalidated')) {
          console.error('[弹窗提取] 扩展上下文已失效，请刷新页面后重试');
          return;
        }
        // 其他错误，尝试直接保存
        savePaperInfoToBackground(paperInfo);
      }
    } catch (error) {
      console.error('[弹窗提取] 提取弹窗信息失败:', error);
    }
  }
  
  // 保存论文信息到background（如果失败，尝试直接保存到storage）
  function savePaperInfoToBackground(paperInfo) {
    try {
    console.log('[弹窗提取] 发送保存请求到background:', {
      title: paperInfo.title,
      firstAuthor: paperInfo.firstAuthor,
      date: paperInfo.date
    });
      
      // 检查chrome.runtime是否可用
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        console.error('[弹窗提取] Chrome runtime不可用，可能扩展已重新加载');
        return;
      }
    
    chrome.runtime.sendMessage({
      action: 'savePaperInfo',
      paperInfo: paperInfo
    }, (response) => {
      if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message;
          console.error('[弹窗提取] 保存论文信息失败 - 连接错误:', errorMsg);
          // 如果是扩展上下文失效，不继续处理
          if (errorMsg && errorMsg.includes('Extension context invalidated')) {
            console.error('[弹窗提取] 扩展上下文已失效，请刷新页面后重试');
            return;
          }
        // 如果background script没有响应，尝试直接保存到storage
        console.log('[弹窗提取] 尝试直接保存到storage');
          try {
        chrome.storage.local.get(['papers'], (result) => {
          const papers = result.papers || [];
          papers.push(paperInfo);
          chrome.storage.local.set({ papers: papers }, () => {
            if (chrome.runtime.lastError) {
              console.error('[弹窗提取] 直接保存到storage也失败:', chrome.runtime.lastError);
            } else {
              console.log('[弹窗提取] ✓ 已直接保存到storage，共', papers.length, '条记录');
            }
          });
        });
          } catch (storageError) {
            console.error('[弹窗提取] 保存到storage时出错:', storageError);
          }
        return;
      }
      
      if (response && response.success) {
        console.log('[弹窗提取] ✓ 论文信息已保存到列表');
      } else {
        const errorMsg = response?.error || '未知错误';
        console.warn('[弹窗提取] ✗ 保存论文信息失败:', errorMsg);
        // 如果是重复错误，不显示警告（这是正常的）
        if (errorMsg.includes('已存在') || errorMsg.includes('重复')) {
          console.log('[弹窗提取] 论文已存在，跳过保存（正常情况）');
        } else {
          // 其他错误，尝试直接保存到storage作为备用方案
          console.log('[弹窗提取] 尝试直接保存到storage作为备用方案');
          chrome.storage.local.get(['papers'], (result) => {
            const papers = result.papers || [];
            papers.push(paperInfo);
            chrome.storage.local.set({ papers: papers }, () => {
              if (chrome.runtime.lastError) {
                console.error('[弹窗提取] 备用保存也失败:', chrome.runtime.lastError);
              } else {
                console.log('[弹窗提取] ✓ 已通过备用方案保存到storage，共', papers.length, '条记录');
              }
            });
          });
        }
      }
    });
    } catch (error) {
      console.error('[弹窗提取] 保存论文信息时出错:', error);
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.error('[弹窗提取] 扩展上下文已失效，请刷新页面后重试');
      }
    }
  }

  // 记录已处理的文件，防止重复下载
  const processedFiles = new Set();
  
  // 自动下载并验证表格中的文件
  async function autoDownloadAndVerifyFiles(metadata, modalKey = null) {
    if (!metadata || !metadata.fileLinks || metadata.fileLinks.length === 0) {
      return;
    }
    
    // 如果提供了modalKey，检查该弹窗是否已处理过（防止并发调用）
    if (modalKey && processedModals.has(modalKey)) {
      // 再次检查是否真的已处理过（可能是在检查和处理之间被标记的）
      // 这里我们使用一个更细粒度的检查：检查文件是否已处理
      const allFilesProcessed = metadata.fileLinks.every(fileLink => {
        const fileKey = `${fileLink.type}:${fileLink.name}`;
        return processedFiles.has(fileKey);
      });
      
      if (allFilesProcessed) {
        console.log('[自动下载] 该弹窗的所有文件已处理过，跳过:', modalKey);
        return;
      }
    }
    
    // 先检查是否重复
    const paperInfo = {
      title: metadata.title || '未知标题',
      firstAuthor: metadata.firstAuthor || '未知作者',
      authors: metadata.authors || [],
      allAuthors: metadata.allAuthors || metadata.authors || []
    };
    
    const duplicateCheck = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'checkPaperDuplicate',
        paperInfo: paperInfo
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ duplicate: false });
        } else {
          resolve(response || { duplicate: false });
        }
      });
    });
    
    if (duplicateCheck.duplicate) {
      console.log('[自动下载] 检测到重复论文，跳过下载和验证:', duplicateCheck.reason);
      return;
    }
    
    console.log('[自动下载] 开始自动下载文件，共', metadata.fileLinks.length, '个');
    
    // 记录要验证的文件信息
    const filesToVerify = [];
    
    for (const fileLink of metadata.fileLinks) {
      // 生成文件唯一标识（类型+文件名+弹窗key，确保同一文件在不同弹窗中不会冲突）
      const fileKey = modalKey ? `${modalKey}:${fileLink.type}:${fileLink.name}` : `${fileLink.type}:${fileLink.name}`;
      
      // 检查是否已经处理过
      if (processedFiles.has(fileKey)) {
        console.log(`[自动下载] 文件 ${fileLink.name} 已处理过，跳过`);
        continue;
      }
      
      // 标记为已处理（在开始处理之前就标记，防止并发处理）
      processedFiles.add(fileKey);
      try {
        console.log(`[自动下载] 处理文件: ${fileLink.type} - ${fileLink.name}`);
        
        // 获取完整的下载URL
        let downloadUrl = fileLink.url;
        
        // 判断文件类型（PDF或图片）
        const isPdf = fileLink.name && fileLink.name.toLowerCase().endsWith('.pdf');
        const isImage = fileLink.name && /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(fileLink.name);
        
        // 如果URL为空，尝试通过点击按钮触发下载
        if (!downloadUrl || downloadUrl === '#' || downloadUrl.startsWith('javascript:')) {
          console.log(`[自动下载] ${fileLink.type} 无法获取URL，尝试点击下载按钮`);
          
          // 如果无法获取URL，尝试触发点击事件
          if (fileLink.element) {
            // 记录文件信息，用于后续验证
            filesToVerify.push({
              type: fileLink.type,
              name: fileLink.name,
              isPdf: isPdf,
              isImage: isImage,
              metadata: metadata,
              downloadTime: Date.now()
            });
            
            // 创建一个自定义事件来触发下载
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            fileLink.element.dispatchEvent(clickEvent);
            
            // 记录文件信息，等待下载完成后验证
            // 注意：blob URL在下载后会失效，所以我们需要监听下载完成，然后使用下载的文件进行验证
            // 使用与registerAllFilesForPaper相同的fileKey格式
            const fileKey = modalKey ? `${modalKey}:${fileLink.type}:${fileLink.name}` : `${fileLink.type}:${fileLink.name}`;
            
            // 确保metadata包含pageUrl和pageTitle
            const metadataWithPageInfo = {
              ...metadata,
              pageUrl: metadata.pageUrl || window.location.href,
              pageTitle: metadata.pageTitle || document.title
            };
            
            console.log('[自动下载] 发送监听请求:', {
              fileType: fileLink.type,
              fileName: fileLink.name,
              fileKey: fileKey,
              title: metadataWithPageInfo.title,
              firstAuthor: metadataWithPageInfo.firstAuthor,
              date: metadataWithPageInfo.date
            });
            
            // 通知background监听下载并验证
            chrome.runtime.sendMessage({
              action: 'monitorDownloadAndVerify',
              fileInfo: {
                type: fileLink.type,
                name: fileLink.name,
                isPdf: isPdf,
                isImage: isImage
              },
              webMetadata: metadataWithPageInfo,
              fileKey: fileKey
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.error('[自动下载] 发送监听请求失败:', chrome.runtime.lastError);
              } else if (response && response.success) {
                console.log(`[自动下载] ${fileLink.type} 已触发下载，后台将监听并验证`);
              } else {
                console.warn('[自动下载] 监听请求响应异常:', response);
              }
            });
            
            // 等待一下，避免点击过快
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          } else {
            console.warn(`[自动下载] ${fileLink.type} 没有可用的下载元素`);
            continue;
          }
        }
        
        // 如果是相对路径，转换为绝对路径
        if (downloadUrl && !downloadUrl.startsWith('http')) {
          if (downloadUrl.startsWith('/')) {
            downloadUrl = window.location.origin + downloadUrl;
          } else {
            downloadUrl = new URL(downloadUrl, window.location.href).href;
          }
        }
        
        // 再次检查是否重复（在下载前）
        const duplicateCheckBeforeDownload = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'checkPaperDuplicate',
            paperInfo: paperInfo
          }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ duplicate: false });
            } else {
              resolve(response || { duplicate: false });
            }
          });
        });
        
        if (duplicateCheckBeforeDownload.duplicate) {
          console.log(`[自动下载] ${fileLink.type} 检测到重复论文，跳过下载:`, duplicateCheckBeforeDownload.reason);
          continue;
        }
        
        // 发送下载请求到background，并附带验证信息
        chrome.runtime.sendMessage({
          action: 'downloadAndVerify',
          url: downloadUrl,
          pageUrl: window.location.href,
          pageTitle: document.title,
          pageMetadata: metadata,
          fileInfo: {
            type: fileLink.type,
            name: fileLink.name,
            isPdf: isPdf,
            isImage: isImage
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(`[自动下载] 下载 ${fileLink.type} 失败:`, chrome.runtime.lastError);
          } else if (response && response.success) {
            console.log(`[自动下载] ${fileLink.type} 下载成功，验证中...`);
          } else {
            console.error(`[自动下载] ${fileLink.type} 下载失败:`, response?.error);
          }
        });
        
        // 延迟一下，避免同时下载太多文件
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`[自动下载] 处理 ${fileLink.type} 时出错:`, error);
      }
    }
  }

  async function extractArxivMetadata() {
    // 首先尝试提取表格格式的元数据（默认规则）
    const tableMetadata = extractTableFormatMetadata();
    if (tableMetadata && (tableMetadata.title || tableMetadata.firstAuthor || tableMetadata.fileLinks)) {
      console.log('[元数据提取] 使用表格格式提取的元数据');
      
      // 如果检测到文件链接，自动触发下载和验证
      if (tableMetadata.fileLinks && tableMetadata.fileLinks.length > 0) {
        console.log('[自动下载] 检测到文件链接，开始自动下载和验证');
        // 异步执行，不阻塞元数据返回
        autoDownloadAndVerifyFiles(tableMetadata).catch(error => {
          console.error('[自动下载] 自动下载过程出错:', error);
        });
      }
      
      return tableMetadata;
    }
    
    // 检查是否是arXiv页面
    if (!window.location.hostname.includes('arxiv.org')) {
      return null;
    }
    
    try {
      const metadata = {
        title: '',
        authors: [],
        date: '',
        arxivId: ''
      };
      
      // 检查是否是列表页面
      if (window.location.pathname.includes('/list/')) {
        // 列表页面：提取当前页面的所有论文信息
        return extractArxivListMetadata();
      }
      
      // 获取配置
      const config = await getConfig();
      const selectors = config.selectors || {};
      
      // 单个论文页面 - 使用配置的选择器
      // 提取标题 - 优先使用配置的选择器
      let titleElement = null;
      if (selectors.title) {
        titleElement = queryWithConfig(selectors.title);
      }
      
      // 如果配置的选择器没找到，使用默认选择器
      if (!titleElement) {
        titleElement = document.querySelector('h1.title.mathjax');
        if (!titleElement) {
          titleElement = document.querySelector('h1.title');
        }
        if (!titleElement) {
          titleElement = document.querySelector('.title');
        }
        if (!titleElement) {
          titleElement = document.querySelector('[class*="title"]');
        }
      }
      
      if (!titleElement) {
        // 尝试从页面文本中提取
        const titleMatch = document.body.textContent.match(/Title:\s*(.+?)(?:\n|Authors:|$)/i);
        if (titleMatch) {
          metadata.title = titleMatch[1].trim();
        }
      } else {
        metadata.title = titleElement.textContent.trim();
        // 清理标题（移除可能的数学公式标记）
        metadata.title = metadata.title.replace(/\$.*?\$/g, '').trim();
      }
      
      // 提取作者 - 优先使用配置的选择器
      let authorElements = [];
      if (selectors.author) {
        authorElements = queryAllWithConfig(selectors.author);
      }
      
      // 如果配置的选择器没找到，使用默认选择器
      if (authorElements.length === 0) {
        authorElements = document.querySelectorAll('.authors a[href*="searchtype=author"]');
        if (authorElements.length === 0) {
          authorElements = document.querySelectorAll('.authors a');
        }
        if (authorElements.length === 0) {
          authorElements = document.querySelectorAll('a[href*="/search/?searchtype=author"]');
        }
        if (authorElements.length === 0) {
          authorElements = document.querySelectorAll('a[href*="searchtype=author"]');
        }
        if (authorElements.length === 0) {
          authorElements = document.querySelectorAll('[class*="author"] a');
        }
      }
      
      if (authorElements.length > 0) {
        // 从链接中提取作者名
        metadata.authors = Array.from(authorElements).map(el => {
          let text = el.textContent.trim();
          // 清理作者名（移除可能的链接文本、翻译标记等）
          text = text.replace(/\s*\(view email\)/i, '').trim();
          text = text.replace(/^\s*、\s*/, '').trim(); // 移除中文分隔符
          text = text.replace(/\s*、\s*$/, '').trim();
          return text;
        }).filter(a => a && a.length > 0);
        
        // 去重（避免翻译导致的重复）
        const uniqueAuthors = [];
        const seen = new Set();
        for (const author of metadata.authors) {
          const normalized = author.toLowerCase().trim();
          if (!seen.has(normalized)) {
            seen.add(normalized);
            uniqueAuthors.push(author);
          }
        }
        metadata.authors = uniqueAuthors;
        metadata.firstAuthor = metadata.authors[0] || '';
      } else {
        // 尝试从页面文本中提取作者
        const authorsSection = document.body.textContent.match(/Authors?:\s*(.+?)(?:\n|Abstract:|$)/i);
        if (authorsSection) {
          const authorsText = authorsSection[1];
          // 尝试分割作者（通常用逗号分隔）
          metadata.authors = authorsText.split(',').map(a => a.trim()).filter(a => a);
          metadata.firstAuthor = metadata.authors[0] || '';
        }
      }
      
      // 提取提交日期 - 优先使用配置的选择器
      let submissionDate = null;
      
      // 方法1：使用配置的选择器
      let dateElement = null;
      if (selectors.date) {
        dateElement = queryWithConfig(selectors.date);
      }
      
      // 如果配置的选择器没找到，使用默认选择器
      if (!dateElement) {
        dateElement = document.querySelector('.submission-history');
        if (!dateElement) {
          dateElement = document.querySelector('.dateline');
        }
        if (!dateElement) {
          dateElement = document.querySelector('[class*="submission"]');
        }
        if (!dateElement) {
          dateElement = document.querySelector('[class*="date"]');
        }
      }
      
      if (dateElement) {
        const historyText = dateElement.textContent;
        // 匹配 "[v1] Wed, 24 Dec 2025 15:15:18 UTC" 格式（英文）
        let dateMatch = historyText.match(/\[v\d+\]\s*(\w+,\s*\d{1,2}\s+\w+\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+UTC)/i);
        if (!dateMatch) {
          // 匹配 "Wed, 24 Dec 2025 15:15:18 UTC" 格式（无版本号，英文）
          dateMatch = historyText.match(/(\w+,\s*\d{1,2}\s+\w+\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+UTC)/i);
        }
        if (!dateMatch) {
          // 匹配中文格式 "2025 年 12 月 24 日星期三 15:15:18 UTC"
          dateMatch = historyText.match(/(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[^\d]*\d{2}:\d{2}:\d{2}\s*UTC)/i);
        }
        if (!dateMatch) {
          // 匹配 "24 Dec 2025" 格式
          dateMatch = historyText.match(/(\d{1,2}\s+\w+\s+\d{4})/i);
        }
        if (!dateMatch) {
          // 匹配中文格式 "2025年12月24日"
          dateMatch = historyText.match(/(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/i);
        }
        if (dateMatch) {
          submissionDate = dateMatch[1].trim();
        }
      }
      
      // 方法2：如果没找到，从整个页面文本中提取
      if (!submissionDate) {
        const dateText = document.body.textContent;
        // 匹配 "Submitted on 24 Dec 2025" 格式
        let dateMatch = dateText.match(/Submitted on (\d{1,2} \w+ \d{4})/i);
        if (!dateMatch) {
          // 匹配 "[Submitted on 24 Dec 2025]" 格式
          dateMatch = dateText.match(/\[Submitted on (\d{1,2} \w+ \d{4})\]/i);
        }
        if (!dateMatch) {
          // 匹配日期格式 YYYY-MM-DD
          dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/);
        }
        if (!dateMatch) {
          // 匹配年份
          dateMatch = dateText.match(/(\d{4})/);
        }
        if (dateMatch) {
          submissionDate = dateMatch[1];
        }
      }
      
      if (submissionDate) {
        metadata.date = submissionDate;
        // 解析日期并提取所有日期信息
        try {
          // 尝试解析 "Wed, 24 Dec 2025 15:15:18 UTC" 格式
          const parsedDate = new Date(submissionDate);
          if (!isNaN(parsedDate.getTime())) {
            // 格式化日期
            const year = parsedDate.getFullYear();
            const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const day = String(parsedDate.getDate()).padStart(2, '0');
            metadata.date = `${year}-${month}-${day}`;
            // 保存原始日期字符串
            metadata.submissionDate = submissionDate;
          }
        } catch (e) {
          // 如果解析失败，使用原始字符串
          console.log('[论文助手] 日期解析失败，使用原始字符串:', submissionDate);
        }
      }
      
      // 提取arXiv ID - 从URL或页面文本
      let arxivMatch = window.location.pathname.match(/\/abs\/(\d{4}\.\d{4,5})/);
      if (!arxivMatch) {
        arxivMatch = window.location.pathname.match(/\/(\d{4}\.\d{4,5})/);
      }
      if (!arxivMatch) {
        // 从页面文本中提取
        arxivMatch = document.body.textContent.match(/arXiv:(\d{4}\.\d{4,5})/);
      }
      if (arxivMatch) {
        metadata.arxivId = arxivMatch[1];
      }
      
      // 验证是否提取到必要信息
      if (!metadata.arxivId && !metadata.title) {
        console.warn('[论文助手] 无法提取arXiv ID和标题，可能不是有效的论文页面');
        return null;
      }
      
      console.log('[论文助手] 提取的元数据:', metadata);
      return metadata;
    } catch (error) {
      console.error('[论文助手] 提取arXiv元数据失败:', error);
      return null;
    }
  }
  
  // 从arXiv列表页面提取论文信息
  function extractArxivListMetadata() {
    const papers = [];
    
    try {
      // arXiv列表页面的结构
      const listItems = document.querySelectorAll('dl, .arxiv-result, [class*="arxiv"]');
      
      listItems.forEach((item, index) => {
        try {
          const paper = {
            title: '',
            authors: [],
            date: '',
            arxivId: '',
            pdfUrl: ''
          };
          
          // 提取标题和链接
          const titleLink = item.querySelector('a[href*="/abs/"]');
          if (titleLink) {
            paper.title = titleLink.textContent.trim();
            const absUrl = titleLink.href;
            const arxivMatch = absUrl.match(/abs\/(\d{4}\.\d{4,5})/);
            if (arxivMatch) {
              paper.arxivId = arxivMatch[1];
              paper.pdfUrl = absUrl.replace('/abs/', '/pdf/') + '.pdf';
            }
          }
          
          // 提取作者
          const authorLinks = item.querySelectorAll('a[href*="/search/?searchtype=author"]');
          if (authorLinks.length > 0) {
            paper.authors = Array.from(authorLinks).map(el => el.textContent.trim());
            paper.firstAuthor = paper.authors[0] || '';
          }
          
          // 提取日期
          const dateText = item.textContent;
          const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/) ||
                           dateText.match(/Submitted on (\d{1,2} \w+ \d{4})/i);
          if (dateMatch) {
            paper.date = dateMatch[1];
          }
          
          if (paper.arxivId) {
            papers.push(paper);
          }
        } catch (e) {
          console.warn('[论文助手] 提取列表项失败:', e);
        }
      });
      
      console.log('[论文助手] 从列表页面提取到', papers.length, '篇论文');
      return papers;
    } catch (error) {
      console.error('[论文助手] 提取列表元数据失败:', error);
      return [];
    }
  }
  
  // 从IEEE Xplore页面提取元数据
  function extractIeeeMetadata() {
    if (!window.location.hostname.includes('ieeexplore.ieee.org')) {
      return null;
    }
    
    try {
      const metadata = {
        title: '',
        authors: [],
        date: '',
        arnumber: ''
      };
      
      // 提取标题
      const titleElement = document.querySelector('h1, .document-title, [class*="title"]');
      if (titleElement) {
        metadata.title = titleElement.textContent.trim();
      }
      
      // 提取作者
      const authorElements = document.querySelectorAll('.authors a, [class*="author"] a, .author-name');
      if (authorElements.length > 0) {
        metadata.authors = Array.from(authorElements)
          .map(el => el.textContent.trim())
          .filter(name => name && name.length > 0);
        metadata.firstAuthor = metadata.authors[0] || '';
      }
      
      // 提取发表日期
      const dateText = document.body.textContent;
      const dateMatch = dateText.match(/(\d{4})\s*(?:年|Year)/) || 
                       dateText.match(/Published[:\s]+(\d{4})/i) ||
                       dateText.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        metadata.date = dateMatch[1];
      }
      
      // 提取文档编号（arnumber）
      const arnumberMatch = window.location.href.match(/arnumber=(\d+)/) ||
                           window.location.pathname.match(/document\/(\d+)/);
      if (arnumberMatch) {
        metadata.arnumber = arnumberMatch[1];
      }
      
      return metadata;
    } catch (error) {
      console.error('[论文助手] 提取IEEE元数据失败:', error);
      return null;
    }
  }
  
  // 处理IEEE Xplore的PDF按钮点击
  function handleIeeePdfClick(event) {
    event.preventDefault();
    event.stopPropagation();
    
    // 从当前页面URL提取arnumber
    const arnumberMatch = window.location.href.match(/arnumber=(\d+)/) ||
                          window.location.pathname.match(/document\/(\d+)/);
    
    if (arnumberMatch) {
      const arnumber = arnumberMatch[1];
      // 构造stamp.jsp URL
      const stampUrl = `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${arnumber}`;
      
      console.log('[论文助手] 检测到IEEE PDF按钮，构造URL:', stampUrl);
      
      // 提取页面元数据
      const pageMetadata = extractIeeeMetadata();
      
      // 发送消息到background script
      chrome.runtime.sendMessage({
        action: 'downloadPdf',
        url: stampUrl,
        pageUrl: window.location.href,
        pageTitle: document.title,
        pageMetadata: pageMetadata
      });
    } else {
      console.warn('[论文助手] 无法从IEEE页面提取arnumber');
    }
  }
  
  // 处理PDF链接点击
  function handlePdfClick(event) {
    const link = event.currentTarget;
    let pdfUrl = link.href;
    
    // 处理arXiv的PDF链接（确保是完整的PDF URL）
    if (pdfUrl.includes('arxiv.org') && !pdfUrl.endsWith('.pdf')) {
      // 如果是相对路径或需要转换的链接
      if (pdfUrl.includes('/abs/')) {
        // 从 /abs/2512.21110 转换为 /pdf/2512.21110.pdf
        pdfUrl = pdfUrl.replace('/abs/', '/pdf/') + '.pdf';
      } else if (pdfUrl.includes('/pdf/') && !pdfUrl.endsWith('.pdf')) {
        pdfUrl = pdfUrl + '.pdf';
      }
    }
    
    // 处理IEEE Xplore的stamp.jsp链接
    if (pdfUrl.includes('ieeexplore.ieee.org') && pdfUrl.includes('stamp/stamp.jsp')) {
      // 确保URL包含arnumber参数
      if (!pdfUrl.includes('arnumber=')) {
        const arnumberMatch = window.location.href.match(/arnumber=(\d+)/) ||
                             window.location.pathname.match(/document\/(\d+)/);
        if (arnumberMatch) {
          pdfUrl = `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${arnumberMatch[1]}`;
        }
      }
    }
    
    // 阻止默认下载行为
    event.preventDefault();
    event.stopPropagation();
    
    // 尝试从页面提取元数据
    let pageMetadata = extractArxivMetadata();
    if (!pageMetadata) {
      pageMetadata = extractIeeeMetadata();
    }
    
    // 发送消息到background script
    chrome.runtime.sendMessage({
      action: 'downloadPdf',
      url: pdfUrl,
      pageUrl: window.location.href,
      pageTitle: document.title,
      pageMetadata: pageMetadata  // 传递页面元数据作为备用
    });
    
    console.log('[论文助手] 检测到PDF下载链接:', pdfUrl);
    if (pageMetadata) {
      console.log('[论文助手] 从页面提取的元数据:', pageMetadata);
    }
  }
  
  // 监听弹窗出现并自动提取信息
  function setupModalObserver() {
    // 创建一个MutationObserver来监听弹窗的出现
    const modalObserver = new MutationObserver((mutations) => {
      // 优先检查是否有 descriptions-table 表格出现（这是目标表格）
      const descriptionsTable = document.querySelector('table.descriptions-table[data-v-b91c72f2], table.descriptions-table');
      if (descriptionsTable) {
        const tableContainer = descriptionsTable.closest('.el-dialog, .el-drawer, [role="dialog"], .modal, .dialog, .el-overlay-dialog, div[data-v-b91c72f2]');
        if (tableContainer) {
          const style = window.getComputedStyle(tableContainer);
          const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
          
        if (isVisible && !tableContainer.hasAttribute('data-paper-extracted')) {
          console.log('[弹窗检测] 检测到包含 descriptions-table 的弹窗出现');
          tableContainer.setAttribute('data-paper-extracted', 'true');
          
          // 注意：不清空processedFiles，因为可能同一个弹窗被多次检测到
          // 使用processedModals来防止重复处理
          
          setTimeout(() => {
            extractFromModal(tableContainer);
          }, 500);
          return; // 如果找到了目标表格，就不需要检查其他弹窗了
        }
        }
      }
      
      // 检查是否有新的弹窗出现
      // 查找常见的弹窗元素：el-dialog, el-drawer, modal, dialog等
      const modals = document.querySelectorAll('.el-dialog, .el-drawer, [role="dialog"], .modal, .dialog, .el-overlay-dialog');
      
      for (const modal of modals) {
        // 检查弹窗是否可见（display不为none）
        const style = window.getComputedStyle(modal);
        const parentStyle = modal.parentElement ? window.getComputedStyle(modal.parentElement) : null;
        
        const isVisible = style.display !== 'none' && 
                        style.visibility !== 'hidden' &&
                        (!parentStyle || parentStyle.display !== 'none');
        
        if (isVisible && !modal.hasAttribute('data-paper-extracted')) {
          // 检查弹窗内是否有 descriptions-table
          const hasTable = modal.querySelector('table.descriptions-table, table[data-v-b91c72f2]');
          if (hasTable) {
            console.log('[弹窗检测] 检测到弹窗出现（包含目标表格），开始提取信息');
            modal.setAttribute('data-paper-extracted', 'true');
            
            // 注意：不清空processedFiles，因为可能同一个弹窗被多次检测到
            // 使用processedModals来防止重复处理
            
            // 延迟一下，确保弹窗内容已加载
            setTimeout(() => {
              extractFromModal(modal);
            }, 500);
          }
        }
      }
    });
    
    // 开始观察DOM变化
    modalObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
    
    // 也监听点击事件，当点击可能触发弹窗的元素时，等待弹窗出现
    document.addEventListener('click', (event) => {
      const target = event.target;
      // 检查是否点击了可能触发详情弹窗的元素（如"查看"、"详情"按钮）
      const clickText = target.textContent.trim().toLowerCase();
      if (clickText.includes('查看') || clickText.includes('详情') || 
          clickText.includes('view') || clickText.includes('detail')) {
        console.log('[弹窗检测] 检测到可能触发弹窗的点击事件');
        // 等待弹窗出现
        setTimeout(() => {
          const modals = document.querySelectorAll('.el-dialog, .el-drawer, [role="dialog"], .modal, .dialog, .el-overlay-dialog');
          for (const modal of modals) {
            const style = window.getComputedStyle(modal);
            if (style.display !== 'none' && !modal.hasAttribute('data-paper-extracted')) {
              modal.setAttribute('data-paper-extracted', 'true');
              
              // 注意：不清空processedFiles，因为可能同一个弹窗被多次检测到
              // 使用processedModals来防止重复处理
              
              setTimeout(() => {
                extractFromModal(modal);
              }, 500);
            }
          }
        }, 1000);
      }
    }, true);
  }
  
  // 记录已处理的弹窗（使用标题+作者作为唯一标识）
  const processedModals = new Set();
  
  // 从弹窗中提取信息
  function extractFromModal(modal) {
    try {
      console.log('[弹窗提取] 开始从弹窗提取信息');
      
      // 优先查找包含论文基本信息的 descriptions-table 表格
      let targetContainer = modal;
      const allTables = modal.querySelectorAll('table.descriptions-table, table[data-v-b91c72f2].descriptions-table');
      
      // 查找第一个包含论文基本信息的表格（不是审核表格）
      let paperInfoTable = null;
      console.log('[弹窗提取] 找到', allTables.length, '个表格，开始检查');
      for (let i = 0; i < allTables.length; i++) {
        const t = allTables[i];
        const tableText = t.textContent || '';
        console.log(`[弹窗提取] 检查第${i+1}个表格，文本长度:`, tableText.length, '包含"论文名称":', tableText.includes('论文名称'), '包含"托举对象":', tableText.includes('托举对象'));
        // 检查是否包含论文基本信息的关键字段
        if (tableText.includes('论文名称') || tableText.includes('托举对象') || 
            tableText.includes('发表期刊') || tableText.includes('学术论文链接')) {
          paperInfoTable = t;
          console.log('[弹窗提取] 找到论文基本信息表格（第', i+1, '个）');
          break;
        }
      }
      
      // 在弹窗内查找表格格式的元数据
      let modalMetadata = null;
      
      if (paperInfoTable) {
        // 直接使用论文基本信息表格进行提取
        console.log('[弹窗提取] 使用论文基本信息表格进行提取');
        modalMetadata = extractTableFormatMetadataFromElement(paperInfoTable);
      } else if (allTables.length > 0) {
        // 如果没找到论文基本信息表格，尝试在每个表格中查找
        console.log('[弹窗提取] 未找到论文基本信息表格，尝试查找所有表格');
        for (const t of allTables) {
          const tableText = t.textContent || '';
          // 检查是否包含论文基本信息的关键字段
          if (tableText.includes('论文名称') || tableText.includes('托举对象') || 
              tableText.includes('发表期刊') || tableText.includes('学术论文链接')) {
            console.log('[弹窗提取] 在表格中找到论文基本信息');
            modalMetadata = extractTableFormatMetadataFromElement(t);
            break;
          }
        }
        
        // 如果还是没找到，使用第一个表格（作为后备）
        if (!modalMetadata) {
          const firstTable = allTables[0];
          console.log('[弹窗提取] 找到 descriptions-table 表格（使用第一个）');
          modalMetadata = extractTableFormatMetadataFromElement(firstTable);
        }
      } else {
        // 也查找包含 data-v-b91c72f2 的表格容器
        const tableContainer = modal.querySelector('div[data-v-b91c72f2] table[data-v-b91c72f2], div[data-v-b91c72f2] .descriptions-table');
        if (tableContainer) {
          console.log('[弹窗提取] 找到包含 data-v-b91c72f2 的表格容器');
          const container = tableContainer.closest('div[data-v-b91c72f2]') || tableContainer.parentElement || modal;
          modalMetadata = extractTableFormatMetadataFromElement(container);
        } else {
          // 最后尝试在整个弹窗中查找
          modalMetadata = extractTableFormatMetadataFromElement(modal);
        }
      }
      
      if (modalMetadata && (modalMetadata.title || modalMetadata.firstAuthor || modalMetadata.date)) {
        // 生成唯一标识（标题+作者+日期）
        const modalKey = `${modalMetadata.title || ''}_${modalMetadata.firstAuthor || ''}_${modalMetadata.date || ''}`;
        
        // 检查是否已经处理过
        if (processedModals.has(modalKey)) {
          console.log('[弹窗提取] 该弹窗已处理过，跳过:', modalKey);
          console.log('[弹窗提取] 提示：如果论文未出现在列表中，请刷新popup页面或检查是否被去重逻辑阻止');
          return null; // 返回null表示已处理过，不执行后续操作
        }
        
        // 标记为已处理（在开始处理之前就标记，防止并发处理）
        processedModals.add(modalKey);
        console.log('[弹窗提取] 从弹窗提取到元数据:', modalMetadata);
        console.log('[弹窗提取] 弹窗唯一标识:', modalKey);
        
        // 首先保存提取的信息到论文列表
        saveExtractedMetadataToPaperList(modalMetadata);
        
        // 如果检测到文件链接，先一次性注册所有文件到JSON，然后触发下载
        if (modalMetadata.fileLinks && modalMetadata.fileLinks.length > 0) {
          console.log('[弹窗提取] 检测到文件链接，共', modalMetadata.fileLinks.length, '个文件');
          
          // 准备文件信息
          const allFileInfos = [];
          const fileKeys = [];
          
          for (const fileLink of modalMetadata.fileLinks) {
            const isPdf = fileLink.name && fileLink.name.toLowerCase().endsWith('.pdf');
            const isImage = fileLink.name && /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(fileLink.name);
            const fileKey = `${modalKey}:${fileLink.type}:${fileLink.name}`;
            
            allFileInfos.push({
              type: fileLink.type,
              name: fileLink.name,
              isPdf: isPdf,
              isImage: isImage
            });
            fileKeys.push(fileKey);
          }
          
          // 确保metadata包含pageUrl和pageTitle
          const metadataWithPageInfo = {
            ...modalMetadata,
            pageUrl: modalMetadata.pageUrl || window.location.href,
            pageTitle: modalMetadata.pageTitle || document.title
          };
          
          // 一次性注册所有文件到background，立即生成包含所有文件名的JSON
          chrome.runtime.sendMessage({
            action: 'registerAllFilesForPaper',
            allFileInfos: allFileInfos,
            fileKeys: fileKeys,
            webMetadata: metadataWithPageInfo
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('[弹窗提取] 注册文件失败:', chrome.runtime.lastError);
            } else if (response && response.success) {
              console.log('[弹窗提取] ✓ 已注册', response.fileCount, '个文件到JSON');
            } else {
              console.warn('[弹窗提取] 注册文件响应异常:', response);
            }
          });
          
          // 然后触发下载和验证
          console.log('[弹窗提取] 开始自动下载和验证');
          autoDownloadAndVerifyFiles(modalMetadata, modalKey).catch(error => {
            console.error('[弹窗提取] 自动下载过程出错:', error);
          });
        } else {
          console.log('[弹窗提取] 未检测到文件链接，仅保存论文信息');
        }
        
        // 可以在这里添加其他处理逻辑，比如显示通知等
        return modalMetadata;
      } else {
        console.log('[弹窗提取] 未从弹窗中提取到有效信息');
      }
    } catch (error) {
      console.error('[弹窗提取] 提取弹窗信息失败:', error);
    }
  }
  
  // 从指定元素（如弹窗）中提取表格格式的元数据
  function extractTableFormatMetadataFromElement(container) {
    try {
      const metadata = {
        title: '',
        authors: [],
        date: '',
        firstAuthor: '',
        authorRole: '',
        allAuthors: []
      };
      
      console.log('[表格提取] 开始从容器提取，容器:', container);
      
      let table = null;
      
      // 如果容器本身就是表格，直接使用
      if (container.tagName === 'TABLE') {
        table = container;
        console.log('[表格提取] 容器本身就是表格，直接使用');
      } else {
        // 优先查找包含论文基本信息的 descriptions-table 表格
        // 论文基本信息表格应该包含"论文名称"或"托举对象"字段
        const allTables = container.querySelectorAll('table.descriptions-table');
        console.log('[表格提取] 在容器中找到', allTables.length, '个表格');
        
        // 查找第一个包含论文基本信息的表格（不是审核表格）
        for (let i = 0; i < allTables.length; i++) {
          const t = allTables[i];
          const tableText = t.textContent || '';
          console.log(`[表格提取] 检查第${i+1}个表格，文本长度:`, tableText.length, '包含"论文名称":', tableText.includes('论文名称'), '包含"托举对象":', tableText.includes('托举对象'));
          // 检查是否包含论文基本信息的关键字段
          if (tableText.includes('论文名称') || tableText.includes('托举对象') || 
              tableText.includes('发表期刊') || tableText.includes('学术论文链接')) {
            table = t;
            console.log('[表格提取] 找到论文基本信息表格（第', i+1, '个）');
            break;
          }
        }
        
        // 如果没找到，尝试查找第一个 descriptions-table
        if (!table) {
          table = container.querySelector('table.descriptions-table');
          console.log('[表格提取] 使用第一个表格作为后备');
        }
        if (!table) {
          table = container.querySelector('table[data-v-b91c72f2]');
        }
      }
      
      // 在指定容器内查找表格行
      let rows = [];
      if (table) {
        console.log('[表格提取] 找到表格元素:', table);
        rows = table.querySelectorAll('tr[data-v-b91c72f2]');
        if (rows.length === 0) {
          rows = table.querySelectorAll('tr');
        }
      } else {
        // 如果没有找到表格，直接在容器中查找行
        rows = container.querySelectorAll('tr[data-v-b91c72f2]');
        if (rows.length === 0) {
          const titleCells = container.querySelectorAll('td.title, td[class*="title"]');
          if (titleCells.length > 0) {
            rows = Array.from(new Set(Array.from(titleCells).map(cell => cell.closest('tr')))).filter(tr => tr !== null);
          }
        }
      }
      
      console.log('[表格提取] 找到', rows.length, '行数据');
      
      // 使用与extractTableFormatMetadata相同的逻辑提取信息
      for (const row of rows) {
        let cells = row.querySelectorAll('td[data-v-b91c72f2]');
        if (cells.length === 0) {
          cells = row.querySelectorAll('td');
        }
        if (cells.length < 2) continue;
        
        const firstCell = cells[0];
        const firstCellText = firstCell ? firstCell.textContent.trim() : '';
        
        // 提取托举对象
        if (firstCell && firstCell.classList.contains('title') && firstCellText === '托举对象') {
          const authorCell = cells[1];
          if (authorCell) {
            const authorName = authorCell.textContent.trim();
            if (authorName && authorName !== '托举对象') {
              metadata.firstAuthor = authorName;
              metadata.authors.push(authorName);
              metadata.allAuthors.push(authorName);
              
              const fallbackPinyin = convertChineseToPinyinFallback(authorName);
              if (fallbackPinyin && fallbackPinyin !== authorName) {
                metadata.firstAuthorPinyin = fallbackPinyin;
              }
            }
          }
        }
        
        // 提取论文名称
        if (firstCell && firstCell.classList.contains('title') && 
            (firstCellText === '论文名称' || firstCellText === '论文标题')) {
          for (let i = 1; i < cells.length; i++) {
            const titleCell = cells[i];
            if (titleCell) {
              const titleText = titleCell.textContent.trim();
              if (titleText && titleText !== '论文名称' && titleText !== '论文标题' && titleText.length > 10) {
                metadata.title = titleText;
                break;
              }
            }
          }
        }
        
        // 提取本人作者属性
        for (let i = 0; i < cells.length - 1; i++) {
          const cell = cells[i];
          if (cell && cell.classList.contains('title')) {
            const cellText = cell.textContent.trim();
            if (cellText === '本人作者属性') {
              const roleCell = cells[i + 1];
              if (roleCell) {
                const role = roleCell.textContent.trim();
                if (role.includes('第一作者') || role === '第一作者') {
                  metadata.authorRole = 'first';
                  metadata.hasEqualContribution = false;
                } else if (role.includes('共一') || role.includes('共同第一') || role.includes('共同一作')) {
                  metadata.authorRole = 'equal';
                  metadata.hasEqualContribution = true;
                }
              }
            }
          }
        }
      }
      
      // 提取日期
      let dateFound = false;
      for (const row of rows) {
        let cells = row.querySelectorAll('td[data-v-b91c72f2]');
        if (cells.length === 0) {
          cells = row.querySelectorAll('td');
        }
        if (cells.length < 2) continue;
        
        for (let i = 0; i < cells.length - 1; i++) {
          const cell = cells[i];
          if (cell && cell.classList.contains('title')) {
            const labelText = cell.textContent.trim();
            if (labelText.includes('日期') || labelText.includes('Date') || 
                labelText.includes('发表') || labelText.includes('录用') ||
                labelText.includes('Publication') || labelText.includes('Acceptance') ||
                labelText.includes('发表/录用日期')) {
              for (let j = i + 1; j < cells.length; j++) {
                const dateCell = cells[j];
                if (dateCell) {
                  const text = dateCell.textContent.trim();
                  const dateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
                  if (dateMatch) {
                    metadata.date = dateMatch[1];
                    dateFound = true;
                    break;
                  }
                }
              }
              if (dateFound) break;
            }
          }
        }
        if (dateFound) break;
      }
      
      if (!dateFound) {
        const allCells = container.querySelectorAll('td[data-v-b91c72f2], td');
        for (const cell of allCells) {
          const text = cell.textContent.trim();
          const dateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            metadata.date = dateMatch[1];
            break;
          }
        }
      }
      
      // 提取文件链接
      const fileLinks = [];
      const fileTypes = ['正式录用通知', '证明材料', '论文全文', '其他证明材料'];
      
      for (const row of rows) {
        let cells = row.querySelectorAll('td[data-v-b91c72f2]');
        if (cells.length === 0) {
          cells = row.querySelectorAll('td');
        }
        if (cells.length < 2) continue;
        
        const firstCell = cells[0];
        if (firstCell && firstCell.classList.contains('title')) {
          const title = firstCell.textContent.trim();
          if (fileTypes.includes(title)) {
            // 查找该行中的所有文件（每个 <p> 标签可能包含一个文件）
            // 先尝试查找所有包含文件的 <p> 标签
            let fileParagraphs = row.querySelectorAll('p[data-v-b91c72f2]');
            if (fileParagraphs.length === 0) {
              fileParagraphs = row.querySelectorAll('p');
            }
            
            // 如果找到了多个文件段落，逐个处理
            if (fileParagraphs.length > 0) {
              for (const paragraph of fileParagraphs) {
                // 在每个段落中查找文件名和下载链接
                let fileNameSpan = paragraph.querySelector('span[data-v-b91c72f2]');
                if (!fileNameSpan) {
                  const allSpans = paragraph.querySelectorAll('span');
                  for (const span of allSpans) {
                    const spanText = span.textContent.trim();
                    if (spanText && (spanText.includes('.pdf') || spanText.includes('.PDF'))) {
                      fileNameSpan = span;
                      break;
                    }
                  }
                }
                const fileName = fileNameSpan ? fileNameSpan.textContent.trim() : '';
                
                // 在该段落中查找下载链接
                let allLinks = paragraph.querySelectorAll('a[data-v-b91c72f2]');
                if (allLinks.length === 0) {
                  allLinks = paragraph.querySelectorAll('a');
                }
                let downloadLink = null;
                
                for (const link of allLinks) {
                  const linkInner = link.querySelector('.el-link--inner, span');
                  const linkText = linkInner ? linkInner.textContent.trim() : link.textContent.trim();
                  if (linkText.includes('下载') || linkText.toLowerCase().includes('download')) {
                    downloadLink = link;
                    break;
                  }
                }
                
                if (downloadLink) {
                  let fileUrl = downloadLink.href;
                  if (!fileUrl || fileUrl === '#' || fileUrl.startsWith('javascript:')) {
                    const dataUrl = downloadLink.getAttribute('data-url') || 
                                   downloadLink.getAttribute('data-href') ||
                                   downloadLink.getAttribute('data-file-url') ||
                                   downloadLink.getAttribute('href');
                    if (dataUrl && !dataUrl.startsWith('javascript:')) {
                      fileUrl = dataUrl;
                    } else {
                      fileUrl = null;
                    }
                  }
                  
                  fileLinks.push({
                    type: title,
                    name: fileName,
                    url: fileUrl,
                    element: downloadLink
                  });
                }
              }
            } else {
              // 如果没有找到文件段落，使用原来的逻辑（向后兼容）
              let fileNameSpan = row.querySelector('span[data-v-b91c72f2]');
              if (!fileNameSpan) {
                const allSpans = row.querySelectorAll('span');
                for (const span of allSpans) {
                  const spanText = span.textContent.trim();
                  if (spanText && (spanText.includes('.pdf') || spanText.includes('.PDF'))) {
                    fileNameSpan = span;
                    break;
                  }
                }
              }
              const fileName = fileNameSpan ? fileNameSpan.textContent.trim() : '';
              
              let allLinks = row.querySelectorAll('a[data-v-b91c72f2]');
              if (allLinks.length === 0) {
                allLinks = row.querySelectorAll('a');
              }
              let downloadLink = null;
              
              for (const link of allLinks) {
                const linkInner = link.querySelector('.el-link--inner, span');
                const linkText = linkInner ? linkInner.textContent.trim() : link.textContent.trim();
                if (linkText.includes('下载') || linkText.toLowerCase().includes('download')) {
                  downloadLink = link;
                  break;
                }
              }
              
              if (downloadLink) {
                let fileUrl = downloadLink.href;
                if (!fileUrl || fileUrl === '#' || fileUrl.startsWith('javascript:')) {
                  const dataUrl = downloadLink.getAttribute('data-url') || 
                                 downloadLink.getAttribute('data-href') ||
                                 downloadLink.getAttribute('data-file-url') ||
                                 downloadLink.getAttribute('href');
                  if (dataUrl && !dataUrl.startsWith('javascript:')) {
                    fileUrl = dataUrl;
                  } else {
                    fileUrl = null;
                  }
                }
                
                fileLinks.push({
                  type: title,
                  name: fileName,
                  url: fileUrl,
                  element: downloadLink
                });
              }
            }
          }
        }
      }
      
      if (fileLinks.length > 0) {
        metadata.fileLinks = fileLinks;
      }
      
      if (metadata.title || metadata.firstAuthor || metadata.date || metadata.fileLinks) {
        return metadata;
      }
      
      return null;
    } catch (error) {
      console.error('[弹窗提取] 提取失败:', error);
      return null;
    }
  }

  // 监听动态添加的链接
  const observer = new MutationObserver(() => {
    markPdfLinks();
  });
  
  // 初始化
  markPdfLinks();
  
  // 设置弹窗监听
  setupModalObserver();
  
  // 监听DOM变化
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // 监听页面跳转（特别是IEEE Xplore跳转到stamp.jsp）
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // 如果跳转到stamp.jsp页面，标记PDF链接
      if (window.location.href.includes('stamp/stamp.jsp')) {
        console.log('[论文助手] 检测到跳转到IEEE stamp页面');
        setTimeout(() => {
          markPdfLinks();
        }, 1000); // 等待页面加载
      }
    }
  }, 500);
  
  // 监听来自background的消息
  // 查找配置的文件链接
  async function findConfiguredFiles() {
    const config = await getConfig();
    const files = config.files || [];
    const foundFiles = [];
    
    for (const fileConfig of files) {
      if (!fileConfig.selector) continue;
      
      const links = queryAllWithConfig(fileConfig.selector);
      for (const link of links) {
        let href = link.href || link.getAttribute('href');
        if (href) {
          // 处理相对路径（如 /pdf/2512.21338）
          if (href.startsWith('/')) {
            href = window.location.origin + href;
          } else if (href.startsWith('./') || !href.startsWith('http')) {
            // 相对路径，基于当前页面URL
            try {
              href = new URL(href, window.location.href).href;
            } catch (e) {
              console.warn('[文件查找] 无法解析相对路径:', href, e);
              continue;
            }
          }
          
          foundFiles.push({
            name: fileConfig.name,
            url: href,
            type: fileConfig.type,
            text: link.textContent.trim()
          });
        }
      }
    }
    
    return foundFiles;
  }
  
  // 拦截fetch请求以捕获API响应
  (function() {
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      return originalFetch.apply(this, args).then(response => {
        // 检查是否是目标API
        const url = args[0];
        if (typeof url === 'string' && url.includes('/rapi/opus/academicAudit/getFundInformation')) {
          console.log('[API拦截] 检测到目标API请求:', url);
          
          // 克隆响应以便读取
          const clonedResponse = response.clone();
          clonedResponse.json().then(data => {
            console.log('[API拦截] 捕获到API响应数据:', data);
            
            // 发送到background存储
            chrome.runtime.sendMessage({
              action: 'storeApiResponse',
              data: data
            }, (response) => {
              if (response && response.success) {
                console.log('[API拦截] API响应数据已存储');
              }
            });
          }).catch(err => {
            console.error('[API拦截] 解析响应失败:', err);
          });
        }
        return response;
      });
    };
  })();
  
  // 拦截XMLHttpRequest以捕获API响应
  (function() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      this._url = url;
      return originalOpen.apply(this, [method, url, ...args]);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
      if (this._url && this._url.includes('/rapi/opus/academicAudit/getFundInformation')) {
        console.log('[API拦截] 检测到XMLHttpRequest请求:', this._url);
        
        this.addEventListener('load', function() {
          if (this.status === 200) {
            try {
              const data = JSON.parse(this.responseText);
              console.log('[API拦截] 捕获到API响应数据:', data);
              
              // 发送到background存储
              chrome.runtime.sendMessage({
                action: 'storeApiResponse',
                data: data
              }, (response) => {
                if (response && response.success) {
                  console.log('[API拦截] API响应数据已存储');
                }
              });
            } catch (err) {
              console.error('[API拦截] 解析响应失败:', err);
            }
          }
        });
      }
      
      return originalSend.apply(this, args);
    };
  })();

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 处理ping消息（用于检查content script是否已加载）
    if (request.action === 'ping') {
      sendResponse({ success: true, loaded: true });
      return false; // 同步响应
    }
    
    if (request.action === 'parsePdfFromData') {
      // 从文件数据解析PDF（用于拖放功能）
      // 注意：异步处理必须返回true，并在完成后调用sendResponse
      let responseSent = false;
      const safeSendResponse = (data) => {
        if (!responseSent) {
          responseSent = true;
          try {
            sendResponse(data);
          } catch (e) {
            console.error('[PDF解析] 发送响应失败（消息通道可能已关闭）:', e);
          }
        } else {
          console.warn('[PDF解析] 尝试重复发送响应，已忽略');
        }
      };
      
      (async () => {
        try {
          console.log('[PDF解析] 收到parsePdfFromData请求，文件名:', request.fileName);
          
          // 将base64转换回ArrayBuffer（支持 data 或 fileData 参数名）
          const base64Data = request.fileData || request.data;
          if (!base64Data) {
            throw new Error('缺少文件数据');
          }
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          // 创建ArrayBuffer的副本，因为第一次使用后可能会被detached
          // 一个用于PDF解析，一个用于OCR
          const bytesForPdf = bytes.slice(); // 创建副本
          const bytesForOcr = bytes.slice(); // 创建副本
          
          // 使用pdf.js解析PDF（使用data选项而不是url）
          const result = await parsePdfFromArrayBuffer(bytesForPdf);
          
          // 如果文本太少，尝试OCR
          if (result.success && result.needsOcr) {
            console.log('[PDF解析] 文本太少，尝试OCR识别...', {
              fullTextLength: result.fullText?.length || 0,
              needsOcr: result.needsOcr
            });
            
            // 先发送一个响应，表示PDF解析已完成（即使需要OCR）
            // 这样可以避免消息通道超时
            const initialResult = { ...result };
            initialResult.ocrInProgress = true; // 标记OCR正在进行中
            safeSendResponse(initialResult);
            console.log('[PDF解析] 已发送初始响应（OCR进行中）');
            
            try {
              // 确保验证库已加载
              await loadVerificationLibraries();
              
              // 将PDF第一页转换为图像（从ArrayBuffer副本）
              console.log('[PDF解析] 开始将PDF转换为图像...');
              let imageDataUrl = await pdfFirstPageToImageFromArrayBuffer(bytesForOcr);
              console.log('[PDF解析] PDF转图像成功，图像数据长度:', imageDataUrl?.length || 0);
              
              // 图像预处理（提高OCR识别率）- 可选，如果图像质量好可以跳过
              // 根据图像大小决定是否预处理（大图像预处理耗时，可能导致卡顿）
              const imageSize = imageDataUrl.length;
              const shouldPreprocess = imageSize < 500000; // 只对小于500KB的图像进行预处理
              
              if (shouldPreprocess && window.preprocessImageForOCR) {
                console.log('[PDF解析] 开始图像预处理（图像大小:', imageSize, '字节）...');
                try {
                  // 使用轻量级预处理（只做必要的处理）
                  imageDataUrl = await window.preprocessImageForOCR(imageDataUrl, {
                    grayscale: true,
                    binarize: true,
                    denoise: false, // 去噪耗时，默认关闭
                    enhanceContrast: true
                  });
                  console.log('[PDF解析] 图像预处理完成');
                } catch (preprocessError) {
                  console.warn('[PDF解析] 图像预处理失败，使用原始图像:', preprocessError);
                }
              } else if (imageSize >= 500000) {
                console.log('[PDF解析] 图像较大（', imageSize, '字节），跳过预处理以避免卡顿');
              }
              
              // 使用二段式OCR API（OCR提取文字 -> LLM结构化）
              console.log('[PDF解析] 开始二段式OCR识别...');
              
              // 通过background script调用OCR API（二段式）
              const ocrResult = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                  action: 'performOcrOnImage',
                  imageData: imageDataUrl,
                  returnStructured: true
                }, (response) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                  } else if (response && response.success) {
                    resolve(response);
                  } else {
                    reject(new Error(response?.error || 'OCR识别失败'));
                  }
                });
              });
              
              const ocrText = ocrResult.text || '';
              const ocrStructured = ocrResult.structured || null;
              console.log('[PDF解析] 二段式OCR识别完成，文本长度:', ocrText?.length || 0, '文本预览:', ocrText?.substring(0, 100));
              console.log('[PDF解析] ========== OCR原始文本输出 ==========');
              console.log('[PDF解析]', ocrText);
              console.log('[PDF解析] ========== OCR原始文本结束 ==========');
              console.log('[PDF解析] LLM结构化结果:', ocrStructured ? '已获取' : '未获取');
              if (ocrStructured) {
                console.log('[PDF解析] ========== LLM结构化结果 ==========');
                console.log('[PDF解析]', JSON.stringify(ocrStructured, null, 2));
                console.log('[PDF解析] ========== LLM结构化结果结束 ==========');
              }
              
              if (ocrText && ocrText.trim().length > 0) {
                // 即使文本较短，也尝试使用OCR结果（降低阈值从50到10）
                if (ocrText.trim().length >= 10) {
                  console.log('[PDF解析] OCR识别成功，文本长度:', ocrText.length);
                  // 使用OCR结果更新数据
                  result.fullText = ocrText;
                  result.first500Chars = ocrText.substring(0, 500);
                  
                  // 优先使用LLM结构化结果中的标题
                  if (ocrStructured && ocrStructured.title && ocrStructured.title !== 'Not mentioned') {
                    result.title = ocrStructured.title.trim();
                    console.log('[PDF解析] 使用LLM结构化结果提取标题:', result.title);
                  }
                  
                  // 优先使用LLM结构化结果中的作者
                  if (ocrStructured && ocrStructured.first_author && ocrStructured.first_author !== 'Not mentioned') {
                    result.author = ocrStructured.first_author.trim();
                    result.firstAuthor = ocrStructured.first_author.trim();
                    console.log('[PDF解析] 使用LLM结构化结果提取第一作者:', result.firstAuthor);
                  } else if (ocrStructured && ocrStructured.authors && ocrStructured.authors !== 'Not mentioned') {
                    const authorsList = String(ocrStructured.authors).split(/[,;]/).map(a => a.trim()).filter(a => a.length > 0);
                    if (authorsList.length > 0) {
                      result.author = authorsList[0];
                      result.firstAuthor = authorsList[0];
                      console.log('[PDF解析] 使用LLM结构化结果提取作者:', result.firstAuthor);
                    }
                  }
                  
                  // 优先使用LLM结构化结果中的日期
                  if (ocrStructured && ocrStructured.dates && typeof ocrStructured.dates === 'object') {
                    const llmDates = ocrStructured.dates;
                    const normalizeOrKeep = (value) => {
                      if (!value || value === 'Not mentioned') return null;
                      const asStr = String(value).trim();
                      if (!asStr || asStr === 'Not mentioned') return null;
                      return normalizeDateString(asStr) || asStr;
                    };
                    
                    const received = normalizeOrKeep(llmDates.received);
                    const revised = normalizeOrKeep(llmDates.received_in_revised || llmDates.revised);
                    const accepted = normalizeOrKeep(llmDates.accepted);
                    const availableOnline = normalizeOrKeep(llmDates.available_online || llmDates.availableOnline);
                    
                    if (received) result.extractedDates = result.extractedDates || {};
                    if (revised) result.extractedDates = result.extractedDates || {};
                    if (accepted) result.extractedDates = result.extractedDates || {};
                    if (availableOnline) result.extractedDates = result.extractedDates || {};
                    
                    if (received && !result.extractedDates.received) result.extractedDates.received = received;
                    if (revised && !result.extractedDates.revised) result.extractedDates.revised = revised;
                    if (accepted && !result.extractedDates.accepted) result.extractedDates.accepted = accepted;
                    if (availableOnline && !result.extractedDates.availableOnline) result.extractedDates.availableOnline = availableOnline;
                    
                    // 设置creationDate（优先使用availableOnline，然后是accepted）
                    if (availableOnline) {
                      result.creationDate = availableOnline;
                    } else if (accepted) {
                      result.creationDate = accepted;
                    } else if (received) {
                      result.creationDate = received;
                    }
                    
                    console.log('[PDF解析] 使用LLM结构化结果填充日期:', {
                      received: result.extractedDates.received,
                      revised: result.extractedDates.revised,
                      accepted: result.extractedDates.accepted,
                      availableOnline: result.extractedDates.availableOnline
                    });
                  }
                  
                  // 如果LLM结构化结果中没有标题，才从OCR文本中提取标题（使用更智能的方法）
                  // 只有在没有有效标题时才从OCR提取（避免覆盖PDF元数据中的正确标题）
                  const hasValidTitle = result.title && 
                                       result.title.length >= 10 && 
                                       !result.title.match(/^(View Letter|Untitled|Document|PDF|http|www\.|doi\.org)/i) &&
                                       !result.title.includes('@') &&
                                       !result.title.match(/^[A-Z\s]{1,5}$/); // 排除太短的全大写（可能是期刊缩写）
                  
                  if (!hasValidTitle && (!ocrStructured || !ocrStructured.title || ocrStructured.title === 'Not mentioned')) {
                    const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    
                    // 跳过常见的非标题行（期刊名、网站、日期、邮箱、版权声明等）
                    const skipPatterns = [
                      /^(ADVANCED|RESEARCH ARTICLE|SCIENCE|JOURNAL|VOLUME|ISSUE|DOI|WWW\.|HTTP)/i,
                      /^(Date|Received|Accepted|Published|Author|Authors?|By):/i,
                      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/, // 日期
                      /^[A-Z\s]{5,}$/, // 全大写短行（通常是期刊名）
                      /^[a-z\s]{1,3}$/, // 太短的行
                      /^(www\.|http|https|@)/i, // 网址或邮箱
                      /@/, // 包含@符号（邮箱地址）
                      /<[^>]+@[^>]+>/, // 邮箱格式 <email@domain.com>
                      /\([^)]*@[^)]*\)/, // 邮箱格式 (email@domain.com)
                      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/, // 标准邮箱格式
                      /^(R\s*E\s*S\s*E\s*A\s*R\s*C\s*H|RESEARCH)/i, // RESEARCH 标题
                      /Open\s+Access/i, // Open Access 声明
                      /Creative\s+Commons/i, // Creative Commons 声明
                      /©\s*The\s*Author/i, // 版权声明
                      /This\s+article\s+is\s+licensed/i, // 许可证声明
                      /Attribution-NonCommercial/i, // 许可证类型
                      /NoDerivatives/i, // 许可证类型
                      /Int\.\s*J\.|International\s+Journal/i, // 期刊名
                      /Vol\.|Volume\s+\d+|Vol\s+\d+/i, // 卷号
                      /\d{4}[,\s]+Vol\.|\d{4}[,\s]+Vol\s+\d+/i, // 年份+卷号
                      /\d{4};\s*\d+\(\d+\):/i, // 年份;卷(期):
                      /doi:\s*10\.|\.doi\.org/i // DOI链接
                    ];
                    
                    // 寻找标题候选（通常是前10行中最长且符合标题特征的行）
                    let titleCandidate = '';
                    let maxLength = 0;
                    
                    for (let i = 0; i < Math.min(10, lines.length); i++) {
                      const line = lines[i];
                      
                      // 跳过明显的非标题行
                      if (skipPatterns.some(pattern => pattern.test(line))) {
                        continue;
                      }
                      
                      // 标题特征：
                      // 1. 长度在20-300字符之间（增加上限以支持长标题）
                      // 2. 包含小写字母（英文标题）或中文字符（中文标题）
                      // 3. 不是全大写（除非很短）
                      const hasLowercase = /[a-z]/.test(line);
                      const hasChinese = /[\u4e00-\u9fa5]/.test(line);
                      const isAllUppercase = /^[A-Z\s]+$/.test(line) && line.length > 15;
                      
                      // 排除URL、DOI链接、邮箱地址
                      const isUrl = /^(https?:\/\/|www\.|doi:|doi\.org|dx\.doi\.org)/i.test(line);
                      const isEmail = /@/.test(line) || /<[^>]+@[^>]+>/.test(line) || /\([^)]*@[^)]*\)/.test(line) || /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/.test(line);
                      const isDoiLink = /doi\.org|dx\.doi\.org|doi:/i.test(line);
                      const isJournalInfo = /Int\.\s*J\.|International\s+Journal|Vol\.|Volume\s+\d+|Vol\s+\d+|\d{4}[,\s]+Vol\.|\d{4}[,\s]+Vol\s+\d+|\d{4};\s*\d+\(\d+\):|doi:\s*10\.|\.doi\.org/i.test(line);
                      
                      if (line.length >= 20 && line.length <= 300 && 
                          (hasLowercase || hasChinese) && 
                          !isAllUppercase &&
                          !isUrl && !isEmail && !isDoiLink && !isJournalInfo &&
                          !line.match(/^http/) &&
                          !line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/) && // 再次检查邮箱
                          line.length > maxLength) {
                        titleCandidate = line;
                        maxLength = line.length;
                      }
                    }
                    
                    // 如果找到的标题看起来不完整（以常见词结尾，可能是被截断），尝试合并下一行
                    if (titleCandidate && titleCandidate.length < 100) {
                      const titleIndex = lines.findIndex(l => l === titleCandidate);
                      if (titleIndex >= 0 && titleIndex < lines.length - 1) {
                        const nextLine = lines[titleIndex + 1];
                        // 如果下一行也符合标题特征，合并它们
                        if (nextLine && nextLine.length >= 20 && 
                            (/[a-z\u4e00-\u9fa5]/.test(nextLine)) &&
                            !nextLine.match(/^(Author|Date|Received|Abstract|Keywords|Introduction)/i)) {
                          const combinedTitle = titleCandidate + ' ' + nextLine;
                          if (combinedTitle.length <= 300) {
                            titleCandidate = combinedTitle;
                            console.log('[PDF解析] 合并标题行:', titleCandidate);
                          }
                        }
                      }
                    }
                    
                    if (titleCandidate) {
                      // 再次验证提取的标题不是邮箱、URL等无效内容
                      const isValidTitle = !titleCandidate.match(/@/) &&
                                          !titleCandidate.match(/<[^>]+@[^>]+>/) &&
                                          !titleCandidate.match(/\([^)]*@[^)]*\)/) &&
                                          !titleCandidate.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/) &&
                                          !titleCandidate.match(/^(https?:\/\/|www\.|doi:|doi\.org|dx\.doi\.org)/i);
                      
                      if (isValidTitle) {
                        result.title = titleCandidate;
                        console.log('[PDF解析] 从OCR提取标题:', result.title);
                      } else {
                        console.log('[PDF解析] OCR提取的标题包含邮箱或URL，跳过:', titleCandidate);
                      }
                    }
                    
                    // 如果还是没有有效标题，尝试备用方法
                    if (!result.title || result.title.length < 10) {
                      console.log('[PDF解析] 未能从OCR提取标题，尝试备用方法...');
                      // 备用方法：找第一段较长的文本（支持多行合并）
                      // 排除URL、DOI链接、邮箱地址
                      let firstLongLine = lines.find(l => {
                        const isUrl = /^(https?:\/\/|www\.|doi:|doi\.org|dx\.doi\.org)/i.test(l);
                        const isDoiLink = /doi\.org|dx\.doi\.org|doi:/i.test(l);
                        const isEmail = /@/.test(l) || /<[^>]+@[^>]+>/.test(l) || /\([^)]*@[^)]*\)/.test(l) || /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/.test(l);
                        return l.length >= 30 && l.length <= 300 && 
                               /[a-z\u4e00-\u9fa5]/.test(l) &&
                               !isUrl && !isDoiLink && !isEmail &&
                               !l.match(/^http/) &&
                               !l.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/);
                      });
                      if (firstLongLine) {
                        const lineIndex = lines.indexOf(firstLongLine);
                        // 尝试合并后续行以获取完整标题
                        let combinedTitle = firstLongLine;
                        for (let i = lineIndex + 1; i < Math.min(lineIndex + 3, lines.length); i++) {
                          const nextLine = lines[i];
                          const isUrl = /^(https?:\/\/|www\.|doi:|doi\.org|dx\.doi\.org)/i.test(nextLine);
                          const isDoiLink = /doi\.org|dx\.doi\.org|doi:/i.test(nextLine);
                          if (nextLine && nextLine.length >= 10 && 
                              (/[a-z\u4e00-\u9fa5]/.test(nextLine)) &&
                              !isUrl && !isDoiLink &&
                              !nextLine.match(/^(Author|Date|Received|Abstract|Keywords|Introduction|www\.|http)/i) &&
                              combinedTitle.length + nextLine.length <= 300) {
                            combinedTitle += ' ' + nextLine;
                          } else {
                            break;
                          }
                        }
                        // 再次验证合并后的标题
                        const isValidCombinedTitle = !combinedTitle.match(/@/) &&
                                                     !combinedTitle.match(/<[^>]+@[^>]+>/) &&
                                                     !combinedTitle.match(/\([^)]*@[^)]*\)/) &&
                                                     !combinedTitle.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/) &&
                                                     !combinedTitle.match(/^(https?:\/\/|www\.|doi:|doi\.org|dx\.doi\.org)/i);
                        
                        if (isValidCombinedTitle) {
                          result.title = combinedTitle;
                          console.log('[PDF解析] 从OCR提取标题（备用方法）:', result.title);
                        } else {
                          console.log('[PDF解析] OCR备用方法提取的标题包含邮箱或URL，跳过:', combinedTitle);
                        }
                      }
                    }
                  }
                  
                  // 如果LLM结构化结果中没有作者，才从OCR文本中提取作者（使用更准确的模式）
                  if ((!result.author || result.author.length < 3) && 
                      (!ocrStructured || !ocrStructured.first_author || ocrStructured.first_author === 'Not mentioned')) {
                    // 方法1：查找明确的"Author:"或"By:"标记
                    const authorPatterns = [
                      /(?:Author|Authors?|By)[\s:]+([^\n]+?)(?:\n|$)/i,
                      /(?:Author|Authors?|By)[\s:]+([^\n]+?)(?:\n\n|\nAbstract|\nKeywords|\nDate|\nReceived)/i
                    ];
                    
                    let authorFound = false;
                    for (const pattern of authorPatterns) {
                      const match = ocrText.match(pattern);
                      if (match) {
                        const authorText = match[1].trim();
                        // 验证提取的文本看起来像作者名（包含姓名格式）
                        if (authorText.match(/[A-Z][a-z]+ [A-Z]/) || // First Last 或 First M. Last
                            authorText.match(/[A-Z][a-z]+, [A-Z]/) || // Last, First
                            /[\u4e00-\u9fa5]{2,4}/.test(authorText)) { // 中文姓名
                          // 只取第一个作者（如果有多人，用逗号或分号分隔）
                          result.author = authorText.split(/[,;]/)[0].trim();
                          console.log('[PDF解析] 从OCR提取作者（方法1）:', result.author);
                          authorFound = true;
                          break;
                        }
                      }
                    }
                    
                    // 方法2：如果没找到，尝试从文本中查找姓名格式（但要排除标题）
                    if (!authorFound) {
                      // 先确定标题的位置，避免在标题中查找作者
                      const titleStart = result.title ? ocrText.indexOf(result.title) : -1;
                      const searchStart = titleStart > 0 ? titleStart + (result.title?.length || 0) : 0;
                      const textAfterTitle = ocrText.substring(searchStart);
                      
                      const namePatterns = [
                        /([A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+)/, // First M. Last
                        /([A-Z][a-z]+ [A-Z][a-z]+)/, // First Last (但需要验证不是标题的一部分)
                        /([A-Z][a-z]+, [A-Z]\.)/, // Last, F.
                        /([\u4e00-\u9fa5]{2,4})/ // 中文姓名
                      ];
                      
                      for (const pattern of namePatterns) {
                        const matches = textAfterTitle.matchAll(new RegExp(pattern.source, 'g'));
                        for (const match of matches) {
                          const name = match[1].trim();
                          
                          // 严格验证：确保是姓名而不是标题的一部分
                          // 1. 长度限制（姓名通常不会超过30个字符）
                          // 2. 不包含常见标题词汇
                          // 3. 不是标题的一部分
                          const isTitleWord = /^(machine|learning|assisted|electronic|ionic|skin|recognition|thermal|stimuli|mechanical|deformation|soft|robots|system|method|analysis|study|research|paper|article)/i.test(name);
                          const isTooLong = name.length > 30;
                          const hasTitleKeywords = /(assisted|recognition|deformation|system|method|analysis)/i.test(name);
                          
                          if (!isTitleWord && !isTooLong && !hasTitleKeywords && 
                              !name.match(/^(Abstract|Introduction|Keywords|Date|Received|Published|Journal|Volume|Issue)/i)) {
                            result.author = name;
                            console.log('[PDF解析] 从OCR提取作者（方法2）:', result.author);
                            authorFound = true;
                            break;
                          }
                        }
                        if (authorFound) break;
                      }
                    }
                    
                    if (!authorFound) {
                      console.log('[PDF解析] 未能从OCR提取作者');
                    }
                  }
                  
                  const datePatterns = [
                    /(?:Date|Received|Accepted|Published)[\s:]+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
                    /(?:Date|Received|Accepted|Published)[\s:]+(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/i,
                    /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/
                  ];
                  
                  for (const pattern of datePatterns) {
                    const match = ocrText.match(pattern);
                    if (match) {
                      result.creationDate = match[1];
                      console.log('[PDF解析] 从OCR提取日期:', result.creationDate);
                      break;
                    }
                  }
                  
                  // 清除needsOcr标记和ocrInProgress标记
                  delete result.needsOcr;
                  delete result.ocrInProgress;
                  
                  // OCR完成后，尝试发送更新后的结果
                  // 注意：由于已经发送过初始响应，这里需要检查是否还能发送
                  // 如果消息通道已关闭，这里会失败，但不影响功能
                  try {
                    safeSendResponse(result);
                    console.log('[PDF解析] OCR完成，已发送更新后的响应');
                  } catch (e) {
                    console.warn('[PDF解析] OCR完成后无法发送更新响应（消息通道可能已关闭）:', e);
                  }
                } else {
                  console.warn('[PDF解析] OCR文本太短（<10字符），忽略:', ocrText);
                  // OCR失败，发送原始结果（如果还没发送过）
                  delete result.needsOcr;
                  delete result.ocrInProgress;
                  try {
                    safeSendResponse(result);
                  } catch (e) {
                    console.warn('[PDF解析] 无法发送OCR失败响应:', e);
                  }
                }
              } else {
                console.warn('[PDF解析] OCR返回空文本');
                // OCR失败，发送原始结果
                delete result.needsOcr;
                delete result.ocrInProgress;
                try {
                  safeSendResponse(result);
                } catch (e) {
                  console.warn('[PDF解析] 无法发送OCR失败响应:', e);
                }
              }
            } catch (ocrError) {
              console.error('[PDF解析] OCR失败，错误详情:', ocrError);
              console.error('[PDF解析] OCR错误堆栈:', ocrError.stack);
              // 即使OCR失败，也保留原始结果
              delete result.needsOcr;
              delete result.ocrInProgress;
              try {
                safeSendResponse(result);
              } catch (e) {
                console.warn('[PDF解析] 无法发送OCR错误响应:', e);
              }
            }
          } else {
            console.log('[PDF解析] 不需要OCR:', {
              success: result.success,
              needsOcr: result.needsOcr,
              fullTextLength: result.fullText?.length || 0
            });
            
            // 不需要OCR，直接发送响应
            safeSendResponse(result);
          }
        } catch (error) {
          console.error('[PDF解析] parsePdfFromData失败:', error);
          safeSendResponse({ 
            success: false, 
            error: error.message || 'PDF解析失败' 
          });
        }
      })();
      return true; // 异步响应
    } else if (request.action === 'extractPdfMetadata') {
      // 这里可以添加额外的页面信息提取逻辑
      sendResponse({ success: true });
    } else if (request.action === 'extractArxivMetadata') {
      // 异步处理，使用配置的选择器
      (async () => {
        try {
          const metadata = await extractArxivMetadata();
          sendResponse({ metadata: metadata });
        } catch (error) {
          console.error('[论文助手] 提取元数据失败:', error);
          sendResponse({ metadata: null });
        }
      })();
      return true; // 保持消息通道开放
    } else if (request.action === 'findConfiguredFiles') {
      // 查找配置的文件链接
      (async () => {
        try {
          const files = await findConfiguredFiles();
          sendResponse({ files: files });
        } catch (error) {
          console.error('[论文助手] 查找文件失败:', error);
          sendResponse({ files: [] });
        }
      })();
      return true; // 保持消息通道开放
    } else if (request.action === 'extractListPapers') {
      // 提取列表页面的所有论文信息
      const papers = extractArxivListMetadata();
      sendResponse({ papers: papers });
    } else if (request.action === 'verifyPaper') {
      // 验证论文：提取网页信息
      const metadata = extractArxivMetadata();
      sendResponse({ webMetadata: metadata });
    } else if (request.action === 'parsePdf') {
      // 解析PDF文本（在content script中执行，避免CORS问题）
      console.log('[content script] 收到parsePdf请求，PDF URL:', request.pdfUrl);
      parsePdfInContentScript(request.pdfUrl).then(result => {
        console.log('[content script] PDF解析完成，结果:', result);
        sendResponse(result);
      }).catch(error => {
        console.error('[content script] PDF解析失败:', error);
        sendResponse({ success: false, error: error.message });
      });
      return true; // 异步响应
    } else if (request.action === 'performOcr') {
      // 执行OCR识别（PDF）
      performOcrOnPdf(request.pdfUrl).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ error: error.message });
      });
      return true; // 异步响应
    } else if (request.action === 'performImageOcr') {
      // 执行OCR识别（图像）
      performImageOcr(request.imageUrl).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true; // 异步响应
    }
    return true;
  });
  
  // 标准化日期字符串为YYYY-MM-DD格式
  // 从文本中提取作者（改进版，支持上下标标记、多行合并等）
  function extractAuthorsFromText(firstPageText, fullText, info) {
    let author = info.Author || '';
    let firstAuthor = author.split(/[,;]/)[0]?.trim() || '';
    let allAuthors = author ? author.split(/[,;]/).map(a => a.trim()) : [];
    
    console.log('[作者提取] 开始提取作者，元数据作者:', author, '第一作者:', firstAuthor);
    
    // 从文本中提取作者（改进版，支持上下标标记和特殊字符）
    if (!firstAuthor && fullText) {
      console.log('[作者提取] 从第一页文本提取作者');
      
      let firstPageLines = firstPageText.split(/\n+/).filter(line => line.trim().length > 0);
      
      // 如果只有一行，尝试按多个空格或特定模式分割
      if (firstPageLines.length === 1 && firstPageLines[0].length > 200) {
        const longLine = firstPageLines[0];
        firstPageLines = longLine.split(/\s{3,}/).filter(line => line.trim().length > 0);
        if (firstPageLines.length === 1) {
          const parts = longLine.split(/\s+(?:DOI|Received|Accepted|Published|Cite this|PAPER|View Article|State Key|College|Department)/i);
          if (parts.length > 1) {
            firstPageLines = parts.filter(line => line.trim().length > 0);
          }
        }
      }
      
      // 从原始文本中直接提取作者
      const authorPattern = /([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s*[a-z\s,]*\s*[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?){1,}(?:\s+and\s+[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)?)/g;
      
      const titleEndIndex = firstPageText.indexOf('DOI:') > 0 ? firstPageText.indexOf('DOI:') : 
                           (firstPageText.indexOf('Received') > 0 ? firstPageText.indexOf('Received') : firstPageText.length);
      const searchText = firstPageText.substring(0, Math.min(titleEndIndex + 500, firstPageText.length));
      
      let bestMatch = null;
      let bestMatchLength = 0;
      
      try {
        const matches = searchText.matchAll(authorPattern);
        let matchCount = 0;
        const maxMatches = 10;
        
        for (const match of matches) {
          matchCount++;
          if (matchCount > maxMatches) break;
          
          const matchText = match[1];
          if (matchText.length > bestMatchLength && matchText.length > 30) {
            bestMatch = matchText;
            bestMatchLength = matchText.length;
          }
        }
      } catch (e) {
        const match = searchText.match(authorPattern);
        if (match) {
          bestMatch = match[1];
        }
      }
      
      if (bestMatch) {
        let authorLine = bestMatch;
        
        // 清理上下标标记
        authorLine = authorLine.replace(/\s+([a-z]\s*,\s*[a-z](?:\s*,\s*[a-z])*)\s+/gi, ' ');
        authorLine = authorLine.replace(/\s*\b[a-z](?:\s*,\s*[a-z])+\b\s*/gi, ' ');
        authorLine = authorLine.replace(/\s*\*\s*/g, ' ');
        authorLine = authorLine.replace(/\s+/g, ' ').trim();
        
        // 提取所有作者
        let authors = [];
        const parts = authorLine.split(/\s+and\s+/i);
        for (const part of parts) {
          const names = part.split(/\s*,\s*/).map(a => a.trim()).filter(a => a.length > 0);
          authors.push(...names);
        }
        
        // 过滤和验证作者名
        authors = authors.map(a => a.trim()).filter(a => {
          const words = a.split(/\s+/);
          if (words.length < 2) return false;
          const isValidName = words.every(w => /^[A-Z][a-z]+$/.test(w));
          // 过滤机构名、期刊名等无效作者
          const invalidPatterns = [
            /^(Key Lab|Laboratory|Department|University|Institute|College|School|Center|Centre|State Key)/i,
            /^(Chinese Medicine|Journal|Article|Paper|Publication|Editorial|Publisher)/i,
            /^(Inorganic Chemistry|Chemistry Communications|Science|Nature|Cell)/i,
            /^(Manuscript|Number|ID|DOI|Paper|Article|Research)/i,
            /^(Received|Accepted|Published|Available|Online)/i,
            /^(Abstract|Introduction|Keywords|References)/i,
            /^(Serum Pharmacochem|Pharmacochem)/i
          ];
          const isInvalid = invalidPatterns.some(pattern => pattern.test(a));
          return isValidName && !isInvalid && a.length > 5;
        });
        
        if (authors.length > 0) {
          firstAuthor = authors[0];
          allAuthors = authors;
          author = authors.join(', ');
          console.log('[作者提取] ✓ 找到作者，第一作者:', firstAuthor);
        }
      }
      
      // 如果从原始文本提取失败，尝试多行合并处理
      if (!firstAuthor && firstPageLines.length > 1) {
        let authorLines = [];
        let inAuthorSection = false;
        
        for (let i = 0; i < Math.min(25, firstPageLines.length); i++) {
          const line = firstPageLines[i].trim();
          const hasAuthorName = /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(line);
          const isShortLine = line.length < 200;
          const hasMarkers = /[a-z]\s*,\s*[a-z]|\*/.test(line);
          const isInstitution = /\b(University|College|Institute|Department|Laboratory|State Key)\b/i.test(line);
          
          if (hasAuthorName && !isInstitution && (isShortLine || hasMarkers)) {
            authorLines.push(line);
            inAuthorSection = true;
          } else if (inAuthorSection) {
            if (isInstitution || line.length > 200) {
              break;
            }
            if (hasAuthorName && isShortLine) {
              authorLines.push(line);
            } else {
              break;
            }
          }
        }
        
        if (authorLines.length > 0) {
          let mergedAuthorLine = authorLines.join(' ');
          mergedAuthorLine = mergedAuthorLine.replace(/\s*[a-z]\s*,\s*[a-z]\s*(?:,\s*[a-z]\s*)*/gi, '');
          mergedAuthorLine = mergedAuthorLine.replace(/\s*\*\s*/g, ' ');
          mergedAuthorLine = mergedAuthorLine.replace(/\s+/g, ' ').trim();
          
          const authors = mergedAuthorLine.split(/\s+and\s+|\s*,\s*/).map(a => a.trim()).filter(a => {
            if (a.length < 5 || !/^[A-Z][a-z]+(\s+[A-Z][a-z]+)+/.test(a)) {
              return false;
            }
            // 过滤机构名、期刊名等无效作者
            const invalidPatterns = [
              /^(State Key|College|Department|Laboratory|University|Institute|Electrochemical|ammonia|synthesis)/i,
              /^(Key Lab|Laboratory|Department|University|Institute|College|School|Center|Centre)/i,
              /^(Chinese Medicine|Journal|Article|Paper|Publication|Editorial|Publisher)/i,
              /^(Serum Pharmacochem|Pharmacochem)/i
            ];
            return !invalidPatterns.some(pattern => pattern.test(a));
          });
          
          if (authors.length > 0) {
            firstAuthor = authors[0];
            allAuthors = authors;
            author = authors.join(', ');
            console.log('[作者提取] ✓ 合并多行找到作者');
          }
        }
      }
    } else if (firstAuthor && allAuthors.length === 0) {
      allAuthors = author.split(/[,;]/).map(a => a.trim());
    }
    
    return {
      author: author || info.Author || '',
      firstAuthor: firstAuthor || (author ? author.split(/[,;]/)[0]?.trim() : '') || '',
      allAuthors: allAuthors.length > 0 ? allAuthors : (author ? author.split(/[,;]/).map(a => a.trim()) : [])
    };
  }
  
  // 从文本中提取标题（改进版，支持被分割的标题、智能合并等）
  function extractTitleFromText(firstPageText, info) {
    let title = info.Title || '';
    console.log('[标题提取] 开始提取标题，元数据标题:', title);
    
    // 检查标题是否像文件名或无效标题（如DOI、编号等）
    const isFilename = title && (title.toLowerCase().endsWith('.pdf') || title.includes('\\') || title.includes('/'));
    const isInvalidTitle = title && (
      /^[A-Z0-9]+\s*\d+\.\.\d+/.test(title) || // 如 "D5NR03036F 1..11"
      /^[A-Z0-9]+\s*\+\+/.test(title) || // 如 "D5NR03036F ++"
      /^[A-Z0-9]{5,}\s*[\d\.\+\-]+$/.test(title) || // 如 "D5NR03036F 1..11 ++"
      /^\d+[A-Z]+\d+/.test(title) || // 如 "10.1039/d5nr03036f"
      /^(HIT|DOI|ID|No\.|Number|Manuscript|Paper|Article)\s*[:\-]?\s*[\dA-Z]+/i.test(title) || // 如 "HIT202408004"
      /^[A-Z]{2,}\d{4,}/.test(title) || // 如 "HIT202408004"
      /^(Key Lab|Laboratory|Department|University|Institute|College|School|Center|Centre)/i.test(title) || // 机构名
      /^(Chinese Medicine|Journal|Article|Paper|Publication)/i.test(title) // 期刊名
    );
    console.log('[标题提取] 是否像文件名:', isFilename, '是否无效标题:', isInvalidTitle);
    
    if (isFilename || isInvalidTitle || !title || title.length < 10) {
      console.log('[标题提取] 从第一页文本提取标题，第一页文本长度:', firstPageText.length);
      
      // 如果文本没有换行符，尝试按多个空格或特定模式分割
      let firstPageLines = firstPageText.split(/\n+/).filter(line => line.trim().length > 0);
      
      // 如果只有一行，尝试按多个空格或特定模式分割
      if (firstPageLines.length === 1 && firstPageLines[0].length > 200) {
        console.log('[标题提取] 检测到单行文本，尝试智能分割...');
        const longLine = firstPageLines[0];
        firstPageLines = longLine.split(/\s{3,}/).filter(line => line.trim().length > 0);
        if (firstPageLines.length === 1) {
          const parts = longLine.split(/\s+(?:DOI|Received|Accepted|Published|Cite this|PAPER|View Article)/i);
          if (parts.length > 1) {
            firstPageLines = parts.filter(line => line.trim().length > 0);
          }
        }
        console.log('[标题提取] 智能分割后行数:', firstPageLines.length);
      }
      
      // 从原始文本中直接提取标题
      const titleEndMarkers = ['DOI:', 'doi:', 'Received', 'Accepted', 'Published', 'Cite this'];
      let titleStartIndex = 0;
      let titleEndIndex = firstPageText.length;
      
      // 查找标题结束位置
      for (const marker of titleEndMarkers) {
        const index = firstPageText.indexOf(marker);
        if (index > 0 && index < titleEndIndex) {
          titleEndIndex = index;
        }
      }
      
      // 跳过期刊名、PAPER等
      const skipPatterns = ['Nanoscale', 'PAPER', 'Cite this'];
      for (const pattern of skipPatterns) {
        const index = firstPageText.indexOf(pattern);
        if (index >= 0 && index < titleEndIndex) {
          const afterPattern = firstPageText.substring(index + pattern.length);
          const cleanStart = afterPattern.replace(/^[\s:]*/, '');
          titleStartIndex = Math.max(titleStartIndex, index + pattern.length + (afterPattern.length - cleanStart.length));
        }
      }
      
      if (titleEndIndex > titleStartIndex) {
        let titleCandidate = firstPageText.substring(titleStartIndex, titleEndIndex).trim();
        
        // 在候选区域中查找作者名位置，提前截断
        const authorPatternInText = /([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s*[a-z\s,]*\s*[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)*(?:\s+and\s+[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)?)/;
        const authorMatch = titleCandidate.match(authorPatternInText);
        if (authorMatch && authorMatch.index > 50) {
          titleCandidate = titleCandidate.substring(0, authorMatch.index).trim();
          console.log('[标题提取] 检测到作者名，截断标题候选区域');
        }
        
        // 检查候选区域是否包含完整的标题
        const hasAcademicWords = titleCandidate && (
          /(computational|screening|analysis|study|research|method|approach|system|model|algorithm|framework|design|development|evaluation|optimization|synthesis|reaction|catalyst|material|device|sensor|detection|recognition|classification|prediction|learning|network|neural|deep|machine|artificial|intelligence)/i.test(titleCandidate)
        );
        
        if (!titleCandidate || titleCandidate.length < 20 || !hasAcademicWords) {
          // 从多行文本中提取
          let foundTitleStart = false;
          for (let i = 0; i < Math.min(15, firstPageLines.length); i++) {
            const line = firstPageLines[i].trim();
            if (line.match(/^(Nanoscale|PAPER|Cite this|DOI|doi|Received|Accepted|Published|rsc\.li)/i)) {
              continue;
            }
            const isAuthorLine = line.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s*[,;]|\s+[a-z]\s*[,;]|\s+and\s+[A-Z][a-z]+)/);
            if (isAuthorLine) {
              console.log('[标题提取] 检测到作者行，停止提取');
              break;
            }
            
            const hasLowercase = line.match(/[a-z]/);
            const hasAcademicWord = /(computational|screening|analysis|study|research|method|approach|system|model|algorithm|framework|design|development|evaluation|optimization|synthesis|reaction|catalyst|material|device|sensor|detection|recognition|classification|prediction|learning|network|neural|deep|machine|artificial|intelligence)/i.test(line);
            const isShortFragment = line.length <= 5 && /^[\d\sA-Z\-]+$/.test(line);
            
            if (hasLowercase && (hasAcademicWord || line.length >= 20)) {
              foundTitleStart = true;
              if (!titleCandidate) {
                titleCandidate = line;
              } else {
                titleCandidate += ' ' + line;
              }
            } else if (foundTitleStart && isShortFragment) {
              titleCandidate += line;
            } else if (foundTitleStart && hasLowercase && line.length >= 10) {
              titleCandidate += ' ' + line;
            }
          }
        }
        
        // 智能清理和合并
        let cleanedCandidate = titleCandidate;
        const authorMatch2 = cleanedCandidate.match(authorPatternInText);
        if (authorMatch2 && authorMatch2.index > 30) {
          cleanedCandidate = cleanedCandidate.substring(0, authorMatch2.index).trim();
        }
        
        cleanedCandidate = cleanedCandidate
          .replace(/^(Nanoscale|PAPER|Cite this|DOI|doi|Received|Accepted|Published).*?/i, '')
          .trim();
        
        // 智能合并被分割的标题部分
        let mergedTitle = '';
        const parts = cleanedCandidate.split(/\s+/);
        
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const nextPart = parts[i + 1];
          
          if (part.length <= 3 && /^[\dA-Z\-]+$/.test(part) && 
              nextPart && nextPart.length <= 3 && /^[\dA-Z\-]+$/.test(nextPart)) {
            mergedTitle += part;
          } else if (part.endsWith('-') || (nextPart && nextPart.startsWith('-'))) {
            mergedTitle += part;
          } else if (part.length <= 3 && /^[\dA-Z\-]+$/.test(part) && 
                     mergedTitle.length > 0 && /[\dA-Z\-]$/.test(mergedTitle)) {
            mergedTitle += part;
          } else {
            mergedTitle += (mergedTitle ? ' ' : '') + part;
          }
        }
        
        mergedTitle = mergedTitle.replace(/\s+/g, ' ').trim();
        
        // 检查并移除末尾的作者名
        const authorSuffixPattern = /\s+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s*[,;]|\s+[a-z]\s*[,;]|\s+and\s+[A-Z][a-z]+)?$/;
        const authorSuffixMatch = mergedTitle.match(authorSuffixPattern);
        if (authorSuffixMatch && authorSuffixMatch.index > 50) {
          mergedTitle = mergedTitle.substring(0, authorSuffixMatch.index).trim();
        }
        
        // 验证标题是否有效
        if (mergedTitle.length >= 20 && mergedTitle.length <= 300 && mergedTitle.match(/[a-z]/)) {
          title = mergedTitle;
          console.log('[标题提取] ✓ 从原始文本提取标题:', title);
        }
      }
    } else {
      console.log('[标题提取] 使用元数据标题:', title);
    }
    
    return title || info.Title || '';
  }
  
  function normalizeDateString(dateStr) {
    if (!dateStr) return '';
    
    // 处理点分隔符格式：YYYY.MM.DD (如: 2023.02.27)
    if (dateStr.match(/^\d{4}\.\d{1,2}\.\d{1,2}$/)) {
      return dateStr.replace(/\./g, '-');
    }
    
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
    
    // 处理 "DD(st/nd/rd/th) Month YYYY" 格式 (如: "18th July 2025", "13 June 2025" 或 "9 August 2025")
    const dayMonthYearMatch = dateStr.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]+)\s+(\d{4})/);
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
    
    // 处理 "Month DD(st/nd/rd/th), YYYY" 格式 (如: "July 18th, 2025")
    const monthDayYearWithOrdinalMatch = dateStr.match(/([A-Z][a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
    if (monthDayYearWithOrdinalMatch) {
      const monthNames = {
        'January': '01', 'February': '02', 'March': '03', 'April': '04',
        'May': '05', 'June': '06', 'July': '07', 'August': '08',
        'September': '09', 'October': '10', 'November': '11', 'December': '12'
      };
      const month = monthNames[monthDayYearWithOrdinalMatch[1]];
      if (month) {
        const day = monthDayYearWithOrdinalMatch[2].padStart(2, '0');
        const year = monthDayYearWithOrdinalMatch[3];
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
    
    // 处理 MM-DD-YYYY 或 MM/DD/YYYY 格式
    const mdyMatch = dateStr.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (mdyMatch) {
      const month = mdyMatch[1].padStart(2, '0');
      const day = mdyMatch[2].padStart(2, '0');
      const year = mdyMatch[3];
      return `${year}-${month}-${day}`;
    }
    
    // 如果无法解析，返回原字符串
    return dateStr;
  }
  
  // 从ArrayBuffer解析PDF（用于拖放功能）
  async function parsePdfFromArrayBuffer(arrayBuffer) {
    try {
      console.log('[PDF解析] 开始从ArrayBuffer解析PDF');
      
      // 加载pdf.js库
      await loadVerificationLibraries();
      
      if (!window.pdfjsLib) {
        throw new Error('pdf.js未加载');
      }
      
      // 确保 worker 源已设置（无论是否已设置，都重新设置以确保正确）
      if (window.pdfjsLib.GlobalWorkerOptions) {
        const workerUrls = [
          'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
        ];
        // 如果未设置或设置失败，使用备用源
        if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrls[0];
          console.log('[PDF解析] 设置worker源:', workerUrls[0]);
        } else {
          console.log('[PDF解析] worker源已设置:', window.pdfjsLib.GlobalWorkerOptions.workerSrc);
        }
      }
      
      console.log('[PDF解析] 使用pdf.js加载PDF文档（从ArrayBuffer）...');
      const pdf = await window.pdfjsLib.getDocument({
        data: arrayBuffer,
        withCredentials: false
      }).promise;
      
      return await extractPdfInfo(pdf);
    } catch (error) {
      console.error('[PDF解析] parsePdfFromArrayBuffer失败:', error);
      throw error;
    }
  }

  // 检测PDF是否是扫描件
  async function isScannedPDF(pdf) {
    try {
      const maxPagesToCheck = Math.min(3, pdf.numPages);
      let totalTextLength = 0;

      for (let i = 1; i <= maxPagesToCheck; i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          totalTextLength += pageText.length;
        } catch (e) {
          console.warn(`[PDF解析] 读取第${i}页失败:`, e);
        }
      }

      // 如果前3页文本少于100字符，认为是扫描件
      const isScanned = totalTextLength < 100;
      console.log(`[PDF解析] PDF文本检测: 前${maxPagesToCheck}页共${totalTextLength}字符，${isScanned ? '可能是扫描件' : '有文本内容'}`);
      return isScanned;
    } catch (error) {
      console.error('[PDF解析] 检测PDF类型失败:', error);
      return true; // 出错时默认认为是扫描件
    }
  }

  // 将PDF页面转换为图片（改进版本：scale=4，包含完整页面）
  async function pdfPageToImage(page, scale = 4) {
    try {
      // 获取页面的完整边界框，确保包含所有内容（包括页眉页脚）
      const viewport = page.getViewport({ 
        scale: scale,
        rotation: 0,
        dontFlip: false
      });
      
      // 创建canvas，确保尺寸足够大以包含所有内容
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      // 设置白色背景，避免透明区域影响OCR
      const context = canvas.getContext('2d');
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);

      // 渲染PDF页面到canvas，确保包含所有内容
      await page.render({
        canvasContext: context,
        viewport: viewport,
        intent: 'display',
        renderInteractiveForms: false,
        enableWebGL: false
      }).promise;

      console.log('[PDF解析] 页面渲染完成，Canvas尺寸:', canvas.width, 'x', canvas.height);

      // 将canvas转换为Data URL
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
      return imageDataUrl;
    } catch (error) {
      console.error('[PDF解析] PDF页面转图片失败:', error);
      throw error;
    }
  }
  
  // 提取PDF信息（通用函数）
  async function extractPdfInfo(pdf) {
    try {
      console.log('[PDF解析] PDF加载成功，总页数:', pdf.numPages);
      
      // 提取元数据
      const metadata = await pdf.getMetadata();
      const info = metadata.info || {};
      
      console.log('[PDF解析] 提取的元数据:', {
        title: info.Title,
        author: info.Author,
        keywords: info.Keywords
      });
      
      // 提取前500字符，同时保存第一页文本用于标题提取
      let fullText = '';
      let firstPageText = '';
      let firstTwoPagesText = ''; // 保存前两页文本用于标题提取
      // 读取更多页以确保能提取到Date字段（通常在前2页内）
      const maxPages = Math.min(pdf.numPages, 5); // 增加到5页以确保能提取到Date
      
      console.log('[PDF解析] 开始提取文本，读取前', maxPages, '页');
      for (let i = 1; i <= maxPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + ' ';
          
          // 保存第一页文本用于标题提取
          if (i === 1) {
            firstPageText = pageText;
            firstTwoPagesText = pageText;
          }
          // 保存前两页文本用于标题提取（标题可能在第二页）
          if (i === 2) {
            firstTwoPagesText += ' ' + pageText;
          }
          
          console.log('[PDF解析] 第', i, '页文本长度:', pageText.length, '，累计:', fullText.length);
          
          // 如果已经找到Date字段，可以提前停止
          if (fullText.match(/Date:\s*[A-Z][a-z]+ \d{1,2}, \d{4}/i)) {
            console.log('[PDF解析] 已找到Date字段，提前停止读取');
            break;
          }
          
          // 至少读取500字符
          if (fullText.length >= 500 && i >= 2) {
            break;
          }
        } catch (error) {
          console.warn('[PDF解析] 读取第', i, '页失败:', error);
        }
      }
      
      const first500Chars = fullText.substring(0, 500);
      console.log('[PDF解析] 提取的文本长度:', fullText.length);
      console.log('[PDF解析] 文本预览:', first500Chars.substring(0, 200));
      
      // 检测PDF是否是扫描件（改进的检测逻辑）
      const isScanned = await isScannedPDF(pdf);
      console.log('[PDF解析] 是否扫描件:', isScanned);
      
      // 判断文本是否太短（用于后续处理）
      const textTooShort = fullText.trim().length < 100 || isScanned;
      
      let ocrText = '';
      let ocrStructured = null;
      let ocrLlmRawText = '';
      let ocrLlmParseError = null;
      let ocrLlmTruncatedInput = false;
      
      if (isScanned) {
        // 如果是扫描件，进行OCR识别（二段式：OCR提取文字 -> LLM结构化）
        console.log('[PDF解析] 检测到扫描件，开始OCR识别...');
        try {
          // 将PDF第一页转换为图片（使用改进的函数，scale=4，包含完整页面）
          const page = await pdf.getPage(1);
          const imageDataUrl = await pdfPageToImage(page, 4);
          
          // 通过background script调用OCR API（二段式）
          const ocrResult = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: 'performOcrOnImage',
              imageData: imageDataUrl,
              returnStructured: true
            }, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (response && response.success) {
                resolve(response);
              } else {
                reject(new Error(response?.error || 'OCR识别失败'));
              }
            });
          });
          
          if (ocrResult && ocrResult.text) {
            ocrText = ocrResult.text;
            console.log('[PDF解析] OCR识别完成，文本长度:', ocrText.length);
            // 将OCR文本合并到fullText中
            fullText = ocrText + ' ' + fullText;

            if (ocrResult.structured && typeof ocrResult.structured === 'object') {
              ocrStructured = ocrResult.structured;
              ocrLlmRawText = ocrResult.llmRawText || '';
              ocrLlmParseError = ocrResult.llmParseError || null;
              ocrLlmTruncatedInput = !!ocrResult.llmTruncatedInput;
              console.log('[PDF解析] LLM结构化结果已获取:', {
                hasTitle: !!ocrStructured.title,
                hasAuthors: !!ocrStructured.authors,
                hasDates: !!ocrStructured.dates,
                llmParseError: ocrLlmParseError,
                llmTruncatedInput: ocrLlmTruncatedInput
              });
            }
          }
        } catch (ocrError) {
          console.warn('[PDF解析] OCR识别失败:', ocrError);
          // OCR失败不影响后续处理
        }
      } else {
        // 如果不是扫描件，PDF有文本时：直接把提取文本交给LLM做结构化（可选）
        // 注意：这里暂时不调用LLM结构化，因为完整PDF的文本提取已经足够
        console.log('[PDF解析] PDF包含文本内容，使用PDF文本提取（无需OCR）');
      }
      
      // 提取标题（使用改进的提取函数）
      let title = extractTitleFromText(firstPageText, info);
      const isFilename = title && (title.toLowerCase().endsWith('.pdf') || title.includes('\\') || title.includes('/'));

      // 优先使用LLM结构化结果中的标题
      if (ocrStructured && ocrStructured.title && ocrStructured.title !== 'Not mentioned' && (!title || isFilename || title.length < 10)) {
        title = ocrStructured.title.trim();
        console.log('[PDF解析] 使用LLM结构化结果提取标题:', title);
      }
      
      // 如果使用了OCR，也从OCR文本中提取标题
      if (ocrText && (!title || isFilename)) {
        console.log('[PDF解析] 尝试从OCR文本提取标题...');
        const ocrLines = ocrText.split(/\n+/).filter(line => line.trim().length > 0);
        for (const line of ocrLines.slice(0, 20)) {
          const trimmedLine = line.trim();
          const isChineseTitle = /[\u4e00-\u9fa5]/.test(trimmedLine) && 
                                 trimmedLine.length >= 10 && trimmedLine.length <= 100 &&
                                 !trimmedLine.match(/^(摘要|关键词|作者|收到|接受|发表|期刊|卷|期|doi|doi:|http|第.*卷|第.*期)/i);
          const isEnglishTitle = trimmedLine.length >= 30 && trimmedLine.length <= 300 && 
                                !trimmedLine.match(/^(https?:\/\/|www\.|doi:|abstract|introduction|keywords|author|received|accepted|published)/i) &&
                                trimmedLine.match(/[a-z]/);
          if ((isChineseTitle || isEnglishTitle) && !title) {
            title = trimmedLine;
            console.log('[PDF解析] 从OCR文本提取标题:', title);
            break;
          }
        }
      }
      
      // 从文本中提取标题（检查第一页和第二页，标题可能在第二页）
      if ((!title || isFilename) && firstTwoPagesText && !textTooShort) {
        try {
          // 首先尝试从第一页提取（支持中英文标题）
          let titleFound = false;
          const firstPageLines = firstPageText.split(/\n+/).filter(line => line.trim().length > 0);
          for (const line of firstPageLines.slice(0, 20)) { // 检查前20行
            const trimmedLine = line.trim();
            // 检查是否是中文标题（包含中文字符，长度10-100字符）
            const isChineseTitle = /[\u4e00-\u9fa5]/.test(trimmedLine) && 
                                   trimmedLine.length >= 10 && trimmedLine.length <= 100 &&
                                   !trimmedLine.match(/^(摘要|关键词|作者|收到|接受|发表|期刊|卷|期|doi|doi:|http|第.*卷|第.*期)/i) &&
                                   !trimmedLine.match(/^\d+$/) &&
                                   !trimmedLine.match(/^[A-Z\s]{10,}$/);
            
            // 检查是否是英文标题（包含小写字母，长度30-300字符）
            // 排除URL、DOI链接、邮箱地址、版权声明、期刊信息等
            const isUrl = /^(https?:\/\/|www\.|doi:|doi\.org|dx\.doi\.org)/i.test(trimmedLine);
            const isEmail = /@/.test(trimmedLine);
            const isDoiLink = /doi\.org|dx\.doi\.org|doi:/i.test(trimmedLine);
            const isCopyright = /Open\s+Access|Creative\s+Commons|©\s*The\s*Author|This\s+article\s+is\s+licensed|Attribution-NonCommercial|NoDerivatives|RESEARCH/i.test(trimmedLine);
            // 排除期刊信息：包含"Int. J.", "Vol.", "doi:", 年份+卷号模式等
            const isJournalInfo = /Int\.\s*J\.|International\s+Journal|Vol\.|Volume\s+\d+|Vol\s+\d+|\d{4}[,\s]+Vol\.|\d{4}[,\s]+Vol\s+\d+|\d{4};\s*\d+\(\d+\):|doi:\s*10\.|\.doi\.org/i.test(trimmedLine);
            const isEnglishTitle = trimmedLine.length >= 30 && trimmedLine.length <= 300 && 
                                   !isUrl && !isEmail && !isDoiLink && !isCopyright && !isJournalInfo &&
                                   !trimmedLine.match(/^(abstract|introduction|keywords|author|received|accepted|published|journal|volume|issue|doi|doi:|http)/i) &&
                                   !trimmedLine.match(/^\d+$/) &&
                                   !trimmedLine.match(/^[A-Z\s]{10,}$/) &&
                                   trimmedLine.match(/[a-z]/) &&
                                   !trimmedLine.match(/^http/);
            
            if (isChineseTitle || isEnglishTitle) {
              title = trimmedLine;
              console.log('[PDF解析] 从第一页文本提取标题:', title);
              titleFound = true;
              break;
            }
          }
          
          // 如果第一页没找到，尝试从第二页提取
          if (!titleFound && firstTwoPagesText.length > firstPageText.length) {
            const secondPageText = firstTwoPagesText.substring(firstPageText.length);
            const secondPageLines = secondPageText.split(/\n+/).filter(line => line.trim().length > 0);
            for (const line of secondPageLines.slice(0, 20)) { // 检查前20行
              const trimmedLine = line.trim();
              const isChineseTitle = /[\u4e00-\u9fa5]/.test(trimmedLine) && 
                                     trimmedLine.length >= 10 && trimmedLine.length <= 100 &&
                                     !trimmedLine.match(/^(摘要|关键词|作者|收到|接受|发表|期刊|卷|期|doi|doi:|http|第.*卷|第.*期)/i) &&
                                     !trimmedLine.match(/^\d+$/) &&
                                     !trimmedLine.match(/^[A-Z\s]{10,}$/);
              
              // 排除URL、DOI链接、邮箱地址、版权声明、期刊信息等
              const isUrl = /^(https?:\/\/|www\.|doi:|doi\.org|dx\.doi\.org)/i.test(trimmedLine);
              const isEmail = /@/.test(trimmedLine);
              const isDoiLink = /doi\.org|dx\.doi\.org|doi:/i.test(trimmedLine);
              const isCopyright = /Open\s+Access|Creative\s+Commons|©\s*The\s*Author|This\s+article\s+is\s+licensed|Attribution-NonCommercial|NoDerivatives|RESEARCH/i.test(trimmedLine);
              // 排除期刊信息：包含"Int. J.", "Vol.", "doi:", 年份+卷号模式等
              const isJournalInfo = /Int\.\s*J\.|International\s+Journal|Vol\.|Volume\s+\d+|Vol\s+\d+|\d{4}[,\s]+Vol\.|\d{4}[,\s]+Vol\s+\d+|\d{4};\s*\d+\(\d+\):|doi:\s*10\.|\.doi\.org/i.test(trimmedLine);
              const isEnglishTitle = trimmedLine.length >= 30 && trimmedLine.length <= 300 && 
                                     !isUrl && !isEmail && !isDoiLink && !isCopyright && !isJournalInfo &&
                                     !trimmedLine.match(/^(abstract|introduction|keywords|author|received|accepted|published|journal|volume|issue|doi|doi:|http)/i) &&
                                     !trimmedLine.match(/^\d+$/) &&
                                     !trimmedLine.match(/^[A-Z\s]{10,}$/) &&
                                     trimmedLine.match(/[a-z]/) &&
                                     !trimmedLine.match(/^http/);
              
              if (isChineseTitle || isEnglishTitle) {
                title = trimmedLine;
                console.log('[PDF解析] 从第二页文本提取标题:', title);
                titleFound = true;
                break;
              }
            }
          }
          
          // 如果还没找到，尝试从前两页提取第一段长文本（去除常见前缀）
          if (!titleFound) {
            // 移除常见的PDF开头标记
            let cleanText = firstTwoPagesText.replace(/^\s*(Journal|Volume|Issue|DOI|Abstract|Keywords|Author|Received|Accepted|Published)[\s:]*/i, '').trim();
            // 排除URL和DOI链接
            cleanText = cleanText.replace(/https?:\/\/[^\s]+/gi, '');
            cleanText = cleanText.replace(/doi\.org[^\s]+/gi, '');
            cleanText = cleanText.replace(/dx\.doi\.org[^\s]+/gi, '');
            // 排除版权声明和Open Access声明
            cleanText = cleanText.replace(/R\s*E\s*S\s*E\s*A\s*R\s*C\s*H[^\n]*/gi, '');
            cleanText = cleanText.replace(/Open\s+Access[^\n]*/gi, '');
            cleanText = cleanText.replace(/Creative\s+Commons[^\n]*/gi, '');
            cleanText = cleanText.replace(/©\s*The\s*Author[^\n]*/gi, '');
            cleanText = cleanText.replace(/This\s+article\s+is\s+licensed[^\n]*/gi, '');
            cleanText = cleanText.replace(/Attribution-NonCommercial[^\n]*/gi, '');
            cleanText = cleanText.replace(/NoDerivatives[^\n]*/gi, '');
            // 排除期刊信息：包含"Int. J.", "Vol.", "doi:", 年份+卷号模式等
            cleanText = cleanText.replace(/Int\.\s*J\.[^\n]*/gi, '');
            cleanText = cleanText.replace(/International\s+Journal[^\n]*/gi, '');
            cleanText = cleanText.replace(/\d{4}[,\s]+Vol\.\s*\d+[^\n]*/gi, '');
            cleanText = cleanText.replace(/\d{4};\s*\d+\(\d+\):[^\n]*/gi, '');
            cleanText = cleanText.replace(/doi:\s*10\.[^\s]+/gi, '');
            const firstLongText = cleanText.match(/.{30,300}/);
            if (firstLongText && firstLongText[0].length >= 30) {
              const candidateTitle = firstLongText[0].trim().split(/\s+/).slice(0, 25).join(' ');
              // 再次验证不是URL、DOI、版权声明或期刊信息
              const isCopyright = /Open\s+Access|Creative\s+Commons|©\s*The\s*Author|This\s+article\s+is\s+licensed|Attribution-NonCommercial|NoDerivatives|RESEARCH/i.test(candidateTitle);
              const isJournalInfo = /Int\.\s*J\.|International\s+Journal|Vol\.|Volume\s+\d+|Vol\s+\d+|\d{4}[,\s]+Vol\.|\d{4}[,\s]+Vol\s+\d+|\d{4};\s*\d+\(\d+\):|doi:\s*10\.|\.doi\.org/i.test(candidateTitle);
              if (!candidateTitle.match(/^(https?:\/\/|www\.|doi:|doi\.org|dx\.doi\.org)/i) && 
                  !candidateTitle.match(/doi\.org|dx\.doi\.org/i) &&
                  !isCopyright && !isJournalInfo) {
                title = candidateTitle;
                console.log('[PDF解析] 从前两页文本提取标题（备用方法）:', title);
              }
            }
          }
        } catch (e) {
          console.warn('[PDF解析] 提取标题失败:', e);
        }
      }
      
      // 如果还是没有标题，使用元数据（即使可能是文件名）
      if (!title) {
        title = info.Title || '';
      }
      
      // 提取作者信息（使用改进的提取函数）
      const authorResult = extractAuthorsFromText(firstPageText, fullText, info);
      let author = authorResult.author;
      let firstAuthor = authorResult.firstAuthor;
      let allAuthors = authorResult.allAuthors;
      
      // 检查元数据作者是否看起来像计算机用户名、品牌名等无效内容
      const isComputerUsername = author && (
        author.length < 5 || 
        author === author.toLowerCase() && !author.includes(' ') ||
        author.match(/^(admin|user|asus|administrator|test|compaq|hp|dell|lenovo|acer|microsoft|apple|samsung|huawei|xiaomi|fields)$/i) ||
        author.match(/^(computer|pc|desktop|laptop|server|system|device|machine)$/i)
      );
      
      // 如果提取到的作者看起来像计算机用户名，尝试从文本重新提取
      if (isComputerUsername && (!firstAuthor || firstAuthor === author)) {
        console.log('[PDF解析] 提取的作者看起来像计算机用户名，尝试从文本重新提取');
        // extractAuthorsFromText 已经处理了这种情况，这里只是记录日志
      }
      
      // 尝试修复编码问题
      if (author && !isComputerUsername) {
        try {
          // 如果作者是乱码，尝试重新编码
          if (/[^\x00-\x7F]/.test(author) && (author.includes('é') || author.includes('æ'))) {
            // 可能是UTF-8被误解析为Latin-1，尝试修复
            const fixedAuthor = decodeURIComponent(escape(author));
            if (fixedAuthor && fixedAuthor !== author) {
              console.log('[PDF解析] 修复作者编码:', author, '->', fixedAuthor);
              author = fixedAuthor;
            }
          }
        } catch (e) {
          console.warn('[PDF解析] 作者编码修复失败:', e);
        }
      }
      
      // 如果使用了OCR，也从OCR文本中提取作者
      if (ocrText && (!author || isComputerUsername)) {
        console.log('[PDF解析] 尝试从OCR文本提取作者...');
        const ocrLines = ocrText.split(/\n+/).filter(line => line.trim().length > 0);
        for (const line of ocrLines.slice(0, 30)) {
          const trimmedLine = line.trim();
          // 英文作者模式
          const englishAuthorMatch = trimmedLine.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+\s+[A-Z][a-z]+)*)/);
          // 中文作者模式
          const chineseAuthorMatch = trimmedLine.match(/^([\u4e00-\u9fa5]{2,4}(?:\s+[\u4e00-\u9fa5]{2,4}){0,10})/);
          if (englishAuthorMatch && !author) {
            author = englishAuthorMatch[1];
            console.log('[PDF解析] 从OCR文本提取作者（英文）:', author);
            break;
          } else if (chineseAuthorMatch && !author) {
            author = chineseAuthorMatch[1];
            console.log('[PDF解析] 从OCR文本提取作者（中文）:', author);
            break;
          }
        }
      }

      // 如果有LLM结构化结果，优先使用其中的第一作者和作者信息
      if (ocrStructured) {
        // 优先使用first_author字段（如果存在）
        if (ocrStructured.first_author && ocrStructured.first_author !== 'Not mentioned' && (!firstAuthor || isComputerUsername)) {
          firstAuthor = String(ocrStructured.first_author).trim();
          console.log('[PDF解析] 使用LLM结构化结果提取第一作者:', firstAuthor);
          // 如果firstAuthor存在，也更新author
          if (!author || isComputerUsername) {
            author = firstAuthor;
          }
        }
        // 如果没有first_author，使用authors字段
        if (ocrStructured.authors && ocrStructured.authors !== 'Not mentioned' && (!author || isComputerUsername)) {
        author = String(ocrStructured.authors).trim();
        console.log('[PDF解析] 使用LLM结构化结果提取作者:', author);
          // 如果author存在但firstAuthor不存在，从author中提取第一作者
          if (!firstAuthor) {
            const authorsList = author.split(/[,;]/).map(a => a.trim()).filter(a => a.length > 0);
            if (authorsList.length > 0) {
              firstAuthor = authorsList[0];
            }
          }
        }
      }
      
      // 从文本中提取作者（支持中英文）
      if ((!author || isComputerUsername) && fullText && !textTooShort) {
        // 尝试多种作者提取模式（中英文）
        const authorPatterns = [
          // 英文作者模式
          /(?:Author|Authors?|By)[\s:]+([^\n]+?)(?:\n|Abstract|Keywords|Received|Accepted|Published|Introduction)/i,
          /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+[A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+[A-Z][a-z]+)*)/m,
          /([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+\s+[A-Z][a-z]+)*)/,
          // 中文作者模式（通常在标题下方，多个中文姓名用空格分隔）
          /([\u4e00-\u9fa5]{2,4}(?:\s+[\u4e00-\u9fa5]{2,4}){1,10})(?:\s*\([^)]+\))?(?:\s*[\u4e00-\u9fa5]{0,10})?(?:\n|摘要|关键词|Abstract|Keywords|作者|Author)/,
          // 中文作者模式（更宽松，匹配2-4个中文字符的姓名，可能有多个）
          /^([\u4e00-\u9fa5]{2,4}(?:\s+[\u4e00-\u9fa5]{2,4}){0,10})/m
        ];
        
        for (const pattern of authorPatterns) {
          const authorMatch = fullText.match(pattern);
          if (authorMatch) {
            const extractedAuthor = authorMatch[1].trim();
            // 验证提取的作者是否合理
            // 排除品牌名、计算机相关词汇、Open Access、期刊名等无效内容
            const isBrandName = extractedAuthor.match(/^(compaq|hp|dell|lenovo|acer|microsoft|apple|samsung|huawei|xiaomi|computer|pc|desktop|laptop|server|system|device|machine|fields|open\s+access|international\s+journal)$/i);
            const isInvalidAuthor = /Open\s+Access|Creative\s+Commons|©\s*The\s*Author|This\s+article|Attribution|NoDerivatives|RESEARCH|International\s+Journal|Int\.\s*J\.|Vol\.|Volume/i.test(extractedAuthor);
            const isEnglishAuthor = !isBrandName && !isInvalidAuthor &&
                                    extractedAuthor.match(/[A-Z][a-z]+/) && 
                                    extractedAuthor.length >= 5 && extractedAuthor.length <= 200 &&
                                    // 确保包含至少一个空格（姓名格式）或至少两个大写字母开头的单词
                                    (extractedAuthor.includes(' ') || extractedAuthor.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/));
            const isChineseAuthor = /[\u4e00-\u9fa5]/.test(extractedAuthor) && 
                                    extractedAuthor.length >= 2 && extractedAuthor.length <= 50 &&
                                    !extractedAuthor.match(/^(摘要|关键词|作者|收到|接受|发表|期刊|卷|期|第.*卷|第.*期)/);
            
            if (isEnglishAuthor || isChineseAuthor) {
              // 如果是中文作者，只取第一个（第一作者）
              if (isChineseAuthor) {
                const firstChineseAuthor = extractedAuthor.split(/\s+/)[0];
                if (firstChineseAuthor && /[\u4e00-\u9fa5]{2,4}/.test(firstChineseAuthor)) {
                  author = firstChineseAuthor;
                } else {
                  author = extractedAuthor.split(/\s+/).filter(n => /[\u4e00-\u9fa5]{2,4}/.test(n))[0] || extractedAuthor;
                }
              } else {
                author = extractedAuthor;
              }
              console.log('[PDF解析] 从文本提取作者:', author);
              break;
            }
          }
        }
      }
      
      // 如果还是没有作者，使用元数据（即使可能是计算机用户名）
      if (!author) {
        author = info.Author || '';
      }
      
      // 提取日期信息（优先使用Available online，然后是Accepted，最后是Received）
      let creationDate = '';
      let modDate = info.ModDate || '';
      
      // 处理PDF日期格式 D:YYYYMMDDHHmmssZ
      if (info.CreationDate && info.CreationDate.startsWith('D:')) {
        const dateStr = info.CreationDate.substring(2);
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        creationDate = `${year}-${month}-${day}`;
        console.log('[PDF解析] 转换PDF日期格式:', info.CreationDate, '->', creationDate);
      } else if (info.CreationDate) {
        creationDate = info.CreationDate;
      }
      
      // 从文本中提取所有日期（Received, Accepted, Revised, Available online，以及所有其他日期）
      let extractedDates = {
        received: null,
        accepted: null,
        revised: null,
        availableOnline: null,
        allDates: [] // 存储所有找到的日期
      };

      // 如果有LLM结构化结果，优先填充日期（扫描件PDF也能得到日期信息）
      if (ocrStructured && ocrStructured.dates && typeof ocrStructured.dates === 'object') {
        const llmDates = ocrStructured.dates;
        const normalizeOrKeep = (value) => {
          if (!value || value === 'Not mentioned') return null;
          const asStr = String(value).trim();
          if (!asStr || asStr === 'Not mentioned') return null;
          return normalizeDateString(asStr) || asStr;
        };

        const received = normalizeOrKeep(llmDates.received);
        // 优先使用received_in_revised字段（如果存在），否则使用revised
        const revised = normalizeOrKeep(llmDates.received_in_revised || llmDates.revised);
        const accepted = normalizeOrKeep(llmDates.accepted);
        const availableOnline = normalizeOrKeep(llmDates.available_online || llmDates.availableOnline);

        if (received && !extractedDates.received) extractedDates.received = received;
        if (revised && !extractedDates.revised) extractedDates.revised = revised;
        if (accepted && !extractedDates.accepted) extractedDates.accepted = accepted;
        if (availableOnline && !extractedDates.availableOnline) extractedDates.availableOnline = availableOnline;

        [received, revised, accepted, availableOnline].filter(Boolean).forEach(d => {
          if (!extractedDates.allDates.includes(d)) extractedDates.allDates.push(d);
        });

        console.log('[PDF解析] 使用LLM结构化结果填充日期:', extractedDates);
      }
      
      if (fullText && !textTooShort) {
        // 日期关键词（添加Published和revised form支持）
        const dateKeywords = {
          received: ['Received', 'Received date', 'Received:', 'Submitted', 'Submitted on'],
          accepted: ['Accepted', 'Accepted date', 'Accepted:', 'Acceptance date'],
          revised: ['Received in revised form', 'in revised form', 'revised form', 'Revised', 'Revised:'],
          availableOnline: ['Available online', 'Available online:', 'Available Online', 'Available Online:', 'available online', 'available online:', 'Published online', 'Published online:', 'Published', 'Published:', 'Online available', 'Online available:'],
          published: ['Published', 'Published:', 'Publication date', 'Publication date:']
        };
        
        // 日期格式（按优先级，包括中文格式和点分隔符格式）
        const datePatterns = [
          /(\d{1,2} [A-Z][a-z]+ \d{4})/,    // DD Month YYYY (如: 6 April 2025) - 优先匹配这个格式
          /([A-Z][a-z]+ \d{1,2}, \d{4})/,   // Month DD, YYYY (如: August 9, 2025)
          /(\d{4}\.\d{1,2}\.\d{1,2})/,      // YYYY.MM.DD (如: 2023.02.27)
          /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/,  // YYYY-MM-DD
          /(\d{1,2}[-/]\d{1,2}[-/]\d{4})/,  // MM-DD-YYYY
          /(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)/,  // 中文格式：YYYY年MM月DD日
          /(\d{4}\s*年\s*\d{1,2}\s*月)/,    // 中文格式：YYYY年MM月
          /(\d{4}\s*年)/                    // 中文格式：YYYY年
        ];
        
        // 先提取Revised日期（必须在Received之前，因为"Received in revised form"包含"Received"）
        for (const keyword of dateKeywords.revised) {
          // 使用不区分大小写的搜索
          const keywordRegex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          const keywordMatch = fullText.match(keywordRegex);
          if (keywordMatch) {
            const keywordIndex = keywordMatch.index;
            const context = fullText.substring(keywordIndex, keywordIndex + 200).replace(/\s+/g, ' ');
            for (const pattern of datePatterns) {
              const match = context.match(pattern);
              if (match) {
                let dateStr = match[1];
                // 标准化日期格式（确保"23 March 2025"转换为"2025-03-23"）
                dateStr = normalizeDateString(dateStr);
                if (dateStr) {
                  extractedDates.revised = dateStr;
                  if (!extractedDates.allDates.includes(dateStr)) {
                    extractedDates.allDates.push(dateStr);
                  }
                  console.log('[PDF解析] 找到Revised日期:', dateStr, '(原始:', match[1], ')');
                  break;
                }
              }
            }
            if (extractedDates.revised) break;
          }
        }
        
        // 提取Received日期（排除已经被Revised匹配的部分）
        for (const keyword of dateKeywords.received) {
          // 使用不区分大小写的搜索
          const keywordRegex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          // 查找所有匹配位置
          let match;
          while ((match = keywordRegex.exec(fullText)) !== null) {
            const keywordIndex = match.index;
            // 检查这个位置是否属于"Received in revised form"（如果是，跳过）
            const checkRevised = fullText.substring(keywordIndex, keywordIndex + 30).toLowerCase();
            if (checkRevised.includes('received in revised form') || checkRevised.includes('in revised form')) {
              continue; // 跳过，因为这是Revised日期的一部分
            }
            
            const context = fullText.substring(keywordIndex, keywordIndex + 200).replace(/\s+/g, ' ');
            for (const pattern of datePatterns) {
              const dateMatch = context.match(pattern);
              if (dateMatch) {
                let dateStr = dateMatch[1];
                // 标准化日期格式（确保"16 January 2025"转换为"2025-01-16"）
                dateStr = normalizeDateString(dateStr);
                if (dateStr) {
                  extractedDates.received = dateStr;
                  if (!extractedDates.allDates.includes(dateStr)) {
                    extractedDates.allDates.push(dateStr);
                  }
                  console.log('[PDF解析] 找到Received日期:', dateStr, '(原始:', dateMatch[1], ')');
                  break;
                }
              }
            }
            if (extractedDates.received) break;
          }
          if (extractedDates.received) break;
        }
        
        // 提取Accepted日期
        for (const keyword of dateKeywords.accepted) {
          // 使用不区分大小写的搜索
          const keywordRegex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          const keywordMatch = fullText.match(keywordRegex);
          if (keywordMatch) {
            const keywordIndex = keywordMatch.index;
            const context = fullText.substring(keywordIndex, keywordIndex + 200).replace(/\s+/g, ' ');
            for (const pattern of datePatterns) {
              const match = context.match(pattern);
              if (match) {
                let dateStr = match[1];
                // 标准化日期格式（确保"5 April 2025"转换为"2025-04-05"）
                dateStr = normalizeDateString(dateStr);
                if (dateStr) {
                  extractedDates.accepted = dateStr;
                  if (!extractedDates.allDates.includes(dateStr)) {
                    extractedDates.allDates.push(dateStr);
                  }
                  console.log('[PDF解析] 找到Accepted日期:', dateStr, '(原始:', match[1], ')');
                  break;
                }
              }
            }
            if (extractedDates.accepted) break;
          }
        }
        
        // 提取Published日期（优先于Available online）
        for (const keyword of dateKeywords.published) {
          // 使用不区分大小写的搜索
          const keywordRegex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          const keywordMatch = fullText.match(keywordRegex);
          if (keywordMatch) {
            const keywordIndex = keywordMatch.index;
            const context = fullText.substring(keywordIndex, keywordIndex + 200).replace(/\s+/g, ' ');
            for (const pattern of datePatterns) {
              const match = context.match(pattern);
              if (match) {
                let dateStr = match[1];
                // 标准化日期格式
                dateStr = normalizeDateString(dateStr);
                if (dateStr) {
                  extractedDates.availableOnline = dateStr; // 使用availableOnline字段存储Published日期
                  if (!extractedDates.allDates.includes(dateStr)) {
                    extractedDates.allDates.push(dateStr);
                  }
                  console.log('[PDF解析] 找到Published日期:', dateStr, '(原始:', match[1], ')');
                  break;
                }
              }
            }
            if (extractedDates.availableOnline) break;
          }
        }
        
        // 提取Available online日期（如果还没有Published日期）
        if (!extractedDates.availableOnline) {
          for (const keyword of dateKeywords.availableOnline) {
            // 使用更宽松的匹配，允许关键词前后有空格、换行等
            const keywordRegex = new RegExp('\\b' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '\\b', 'i');
            const keywordMatch = fullText.match(keywordRegex);
            if (keywordMatch) {
              const keywordIndex = keywordMatch.index;
              const keywordLength = keywordMatch[0].length;
              // 增加上下文长度到300字符，不要规范化空格，保持原始格式
              const context = fullText.substring(keywordIndex, keywordIndex + 300);
              console.log('[PDF解析] 检查Available online日期，关键词:', keyword, '匹配位置:', keywordIndex, '上下文:', context.substring(0, 150));
              
              // 在"Available online"之后直接查找日期
              // 查找"Available online"之后的下一个日期模式
              let foundDate = false;
              
              // 先尝试规范化空格后的匹配（处理多个空格的情况）
              const normalizedContext = context.replace(/\s+/g, ' ');
              console.log('[PDF解析] Available online上下文（规范化空格）:', normalizedContext.substring(0, 150));
              
              for (const pattern of datePatterns) {
                // 先尝试规范化空格后的匹配
                let matches = normalizedContext.matchAll(new RegExp(pattern.source, 'g'));
                let matchArray = Array.from(matches);
                
                // 如果规范化后没匹配到，尝试原始文本（支持多个空格）
                if (matchArray.length === 0) {
                  // 修改模式以支持多个空格：将单个空格替换为 \s+
                  const flexiblePatternSource = pattern.source.replace(/\s/g, '\\s+');
                  const flexiblePattern = new RegExp(flexiblePatternSource, 'g');
                  matches = context.matchAll(flexiblePattern);
                  matchArray = Array.from(matches);
                }
                
                for (const match of matchArray) {
                  const dateStr = match[1];
                  const dateIndex = match.index;
                  // 确保日期在"Available online"之后（至少跳过关键词本身）
                  if (dateIndex >= keywordLength) {
                    // 检查日期是否紧跟在"Available online"之后（在80个字符内，因为可能有期刊信息）
                    const distanceFromKeyword = dateIndex - keywordLength;
                    if (distanceFromKeyword <= 80) {
                      // 检查日期前是否有期刊信息（使用规范化后的上下文）
                      const beforeDate = normalizedContext.substring(keywordLength, dateIndex);
                      const hasJournalInfo = /(Computers|Electronics|Agriculture|Journal|Volume|Vol\.|\(\d{4}\)|doi|\d{6})/i.test(beforeDate);
                      
                      // 如果日期前有期刊信息，但距离关键词较近（<50字符），可能是Available online的日期
                      // 如果日期前没有期刊信息，直接使用
                      if (!hasJournalInfo || distanceFromKeyword < 50) {
                        let normalizedDateStr = normalizeDateString(dateStr);
                        if (normalizedDateStr) {
                          extractedDates.availableOnline = normalizedDateStr;
                          if (!extractedDates.allDates.includes(normalizedDateStr)) {
                            extractedDates.allDates.push(normalizedDateStr);
                          }
                          console.log('[PDF解析] 找到Available online日期:', normalizedDateStr, '(原始:', dateStr, ', 距离关键词:', distanceFromKeyword, '字符, 前文:', beforeDate.substring(0, 50), ')');
                          foundDate = true;
                          break;
                        }
                      } else {
                        console.log('[PDF解析] 跳过日期（期刊信息干扰）:', dateStr, '距离:', distanceFromKeyword, '前文:', beforeDate.substring(0, 50));
                      }
                    }
                  }
                }
                if (foundDate) break;
              }
              
              // 如果没找到，尝试更宽松的匹配（在"Available online"之后查找任何日期）
              if (!foundDate) {
                // 从"Available online"之后开始搜索（不跳过太多字符，因为日期可能就在后面）
                const searchStart = keywordIndex + keywordLength;
                let searchText = fullText.substring(searchStart, searchStart + 100); // 只搜索100字符，因为日期通常就在后面
                console.log('[PDF解析] Available online后搜索区域（宽松匹配，原始）:', searchText.substring(0, 100));
                
                // 先尝试规范化空格后的匹配（处理多个空格的情况）
                const normalizedSearchText = searchText.replace(/\s+/g, ' ');
                console.log('[PDF解析] Available online后搜索区域（宽松匹配，规范化空格）:', normalizedSearchText.substring(0, 100));
                
                for (const pattern of datePatterns) {
                  // 先尝试规范化空格后的匹配
                  let match = normalizedSearchText.match(pattern);
                  if (!match) {
                    // 如果规范化后没匹配到，尝试原始文本（支持多个空格）
                    // 修改模式以支持多个空格
                    const flexiblePattern = new RegExp(pattern.source.replace(/\\s\+/g, '\\s+').replace(/\s/g, '\\s+'), 'g');
                    match = searchText.match(flexiblePattern);
                  }
                  
                if (match) {
                    let dateStr = normalizeDateString(match[1]);
                  if (dateStr) {
                    extractedDates.availableOnline = dateStr;
                    if (!extractedDates.allDates.includes(dateStr)) {
                      extractedDates.allDates.push(dateStr);
                    }
                      console.log('[PDF解析] 找到Available online日期（宽松匹配）:', dateStr, '(原始:', match[1], ')');
                      foundDate = true;
                    break;
                  }
                }
              }
              }
              
              if (foundDate) break;
            } else {
              // 调试：如果没匹配到，输出可能的匹配位置
              const simpleMatch = fullText.match(/available\s+online/i);
              if (simpleMatch) {
                console.log('[PDF解析] 找到"available online"（但关键词匹配失败），位置:', simpleMatch.index, '上下文:', fullText.substring(simpleMatch.index, simpleMatch.index + 100));
              }
            }
          }
        }
        
        // 提取前两页中的所有日期（用于匹配）
        try {
          let firstTwoPagesText = '';
          for (let i = 1; i <= Math.min(2, pdf.numPages); i++) {
            const page = await pdf.getPage(i);
            const pageTextContent = await page.getTextContent();
            const pageText = pageTextContent.items.map(item => item.str).join(' ');
            firstTwoPagesText += pageText + ' ';
          }
          
          // 在前两页中查找所有日期（包括中文格式和点分隔符格式）
          const allDatePatterns = [
            ...datePatterns,
            /(\d{4}\.\d{1,2}\.\d{1,2})/,      // YYYY.MM.DD (如: 2023.02.27)
            /(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)/,  // 中文格式：YYYY年MM月DD日
            /(\d{4}\s*年\s*\d{1,2}\s*月)/,    // 中文格式：YYYY年MM月
            /(\d{4}\s*年)/                    // 中文格式：YYYY年
          ];
          
          for (const pattern of allDatePatterns) {
            const matches = firstTwoPagesText.matchAll(new RegExp(pattern.source, 'g'));
            for (const match of matches) {
              const dateStr = match[1];
              // 验证日期是否合理（年份在2000-2100之间）
              if (dateStr.match(/\d{4}/)) {
                const year = parseInt(dateStr.match(/\d{4}/)[0]);
                if (year >= 2000 && year <= 2100) {
                  const normalizedDate = normalizeDateString(dateStr);
                  if (normalizedDate && !extractedDates.allDates.includes(normalizedDate) && 
                      normalizedDate !== extractedDates.received && 
                      normalizedDate !== extractedDates.accepted && 
                      normalizedDate !== extractedDates.availableOnline) {
                    extractedDates.allDates.push(normalizedDate);
                    console.log('[PDF解析] 找到其他日期:', dateStr, '->', normalizedDate);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn('[PDF解析] 提取所有日期失败:', e);
        }
      }
      
      // 优先使用Available online日期，然后是Accepted，最后是Received或CreationDate
      if (extractedDates.availableOnline) {
        creationDate = normalizeDateString(extractedDates.availableOnline);
      } else if (extractedDates.accepted) {
        creationDate = normalizeDateString(extractedDates.accepted);
      } else if (extractedDates.received) {
        creationDate = normalizeDateString(extractedDates.received);
      } else if (!creationDate) {
        // 如果没有找到，尝试从文本中提取任何日期
        const datePatterns = [
          /(?:Date|Received|Accepted|Published)[\s:]+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
          /(?:Date|Received|Accepted|Published)[\s:]+(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/i,
          /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/
        ];
        
        for (const pattern of datePatterns) {
          const match = fullText.match(pattern);
          if (match) {
            creationDate = normalizeDateString(match[1]);
            break;
          }
        }
      }
      
      // 标准化日期格式
      if (creationDate) {
        creationDate = normalizeDateString(creationDate);
      }
      
      // 确保firstAuthor和allAuthors已设置
      if (!firstAuthor && author) {
        const authorsList = author.split(/[,;]/).map(a => a.trim()).filter(a => a.length > 0);
        if (authorsList.length > 0) {
          firstAuthor = authorsList[0];
          if (allAuthors.length === 0) {
            allAuthors = authorsList;
          }
        }
      }
      if (allAuthors.length === 0 && author) {
        allAuthors = author.split(/[,;]/).map(a => a.trim()).filter(a => a.length > 0);
      }
      
      // 从OCR结构化结果中提取is_co_first
      let isCoFirst = false;
      if (ocrStructured && ocrStructured.is_co_first !== undefined) {
        isCoFirst = ocrStructured.is_co_first === true;
      }
      
      return {
        success: true,
        title: title || info.Title || '', // 使用从文本提取的标题，如果没有则使用元数据
        author: author || info.Author || '', // 使用从文本提取的作者，如果没有则使用元数据
        firstAuthor: firstAuthor || (author ? author.split(/[,;]/)[0]?.trim() : '') || '', // 第一作者
        allAuthors: allAuthors.length > 0 ? allAuthors : (author ? author.split(/[,;]/).map(a => a.trim()) : []), // 所有作者
        isCoFirst: isCoFirst, // 是否共一
        keywords: info.Keywords ? info.Keywords.split(/[,;]/).map(k => k.trim()) : [],
        first500Chars: first500Chars,
        fullText: fullText,
        creationDate: creationDate,
        modDate: modDate,
        numPages: pdf.numPages,
        needsOcr: textTooShort, // 标记需要OCR
        isScanned: isScanned, // 是否扫描件
        extractedDates: extractedDates, // 保存所有提取的日期
        ocrText: ocrText, // 保存OCR识别的文本
        ocrStructured: ocrStructured, // 二段式：LLM结构化结果（可能为null）
        ocrLlmRawText: ocrLlmRawText, // LLM原始输出
        ocrLlmParseError: ocrLlmParseError,
        ocrLlmTruncatedInput: ocrLlmTruncatedInput
      };
    } catch (error) {
      console.error('[PDF解析] extractPdfInfo失败:', error);
      throw error;
    }
  }
  
  // 在content script中解析PDF文本（避免CORS问题）
  async function parsePdfInContentScript(pdfUrl) {
    try {
      console.log('[PDF解析] 在content script中开始解析PDF:', pdfUrl);
      
      // 加载pdf.js库
      await loadVerificationLibraries();
      
      if (!window.pdfjsLib) {
        throw new Error('pdf.js未加载');
      }
      
      console.log('[PDF解析] 使用pdf.js加载PDF文档...');
      const pdf = await window.pdfjsLib.getDocument({
        url: pdfUrl,
        withCredentials: false
      }).promise;
      
      return await extractPdfInfo(pdf);
    } catch (error) {
      console.error('[PDF解析] 解析失败:', error);
      return {
        success: false,
        error: error.message || 'PDF解析失败'
      };
    }
  }
  
  // 在content script中执行OCR（需要DOM环境）- 使用二段式OCR API
  async function performOcrOnPdf(pdfUrl) {
    try {
      // 不输出完整的base64数据到控制台
      if (pdfUrl && pdfUrl.startsWith('data:application/pdf;base64,')) {
        console.log('[验证模块] 开始OCR处理，PDF URL: [base64数据已隐藏]');
      } else {
      console.log('[验证模块] 开始OCR处理，PDF URL:', pdfUrl);
      }
      
      // 加载必要的库
      console.log('[验证模块] 加载验证库...');
      await loadVerificationLibraries();
      console.log('[验证模块] 验证库加载完成');
      
      // 将PDF第一页转换为图像
      console.log('[验证模块] 将PDF转换为图像...');
      const imageDataUrl = await pdfFirstPageToImage(pdfUrl);
      console.log('[验证模块] PDF转换完成，图像大小:', imageDataUrl.length, '字符');
      
      // 使用二段式OCR API（OCR提取文字 -> LLM结构化）
      console.log('[验证模块] 开始二段式OCR识别...');
      
      // 通过background script调用OCR API（二段式）
      const ocrResult = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'performOcrOnImage',
          imageData: imageDataUrl,
          returnStructured: true
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            resolve(response);
          } else {
            reject(new Error(response?.error || 'OCR识别失败'));
          }
        });
      });
      
      console.log('[验证模块] 二段式OCR识别完成');
      
      // 输出OCR原始文本
      const ocrText = ocrResult.text || '';
      console.log('[验证模块] ========== OCR原始文本输出 ==========');
      console.log('[验证模块] OCR文本长度:', ocrText.length);
      console.log('[验证模块]', ocrText);
      console.log('[验证模块] ========== OCR原始文本结束 ==========');
      
      // 输出LLM结构化结果
      const ocrStructured = ocrResult.structured || null;
      if (ocrStructured) {
        console.log('[验证模块] ========== LLM结构化结果 ==========');
        console.log('[验证模块]', JSON.stringify(ocrStructured, null, 2));
        console.log('[验证模块] ========== LLM结构化结果结束 ==========');
      } else {
        console.log('[验证模块] LLM结构化结果: 未获取');
        if (ocrResult.llmRawText) {
          console.log('[验证模块] ========== LLM原始输出 ==========');
          console.log('[验证模块]', ocrResult.llmRawText);
          console.log('[验证模块] ========== LLM原始输出结束 ==========');
        }
      }
      
      // 从OCR结构化结果中提取信息
      const extracted = {
        title: null,
        firstAuthor: null,
        allAuthors: [],
        date: null,
        dates: {
          received: null,
          accepted: null,
          published: null,
          availableOnline: null,
          other: []
        }
      };
      
      if (ocrResult.structured && typeof ocrResult.structured === 'object') {
        const structured = ocrResult.structured;
        extracted.title = structured.title && structured.title !== 'Not mentioned' ? structured.title : null;
        extracted.firstAuthor = structured.first_author && structured.first_author !== 'Not mentioned' 
          ? structured.first_author 
          : (structured.authors && structured.authors !== 'Not mentioned' 
              ? String(structured.authors).split(/[,;]/)[0].trim() 
              : null);
        if (structured.authors && structured.authors !== 'Not mentioned') {
          extracted.allAuthors = String(structured.authors).split(/[,;]/).map(a => a.trim()).filter(a => a.length > 0);
        }
        if (structured.dates && typeof structured.dates === 'object') {
          extracted.dates.received = structured.dates.received && structured.dates.received !== 'Not mentioned' ? structured.dates.received : null;
          extracted.dates.revised = structured.dates.received_in_revised && structured.dates.received_in_revised !== 'Not mentioned' 
            ? structured.dates.received_in_revised 
            : (structured.dates.revised && structured.dates.revised !== 'Not mentioned' ? structured.dates.revised : null);
          extracted.dates.accepted = structured.dates.accepted && structured.dates.accepted !== 'Not mentioned' ? structured.dates.accepted : null;
          extracted.dates.availableOnline = structured.dates.available_online && structured.dates.available_online !== 'Not mentioned' 
            ? structured.dates.available_online 
            : null;
          // 设置date字段（优先使用received，然后是accepted）
          extracted.date = extracted.dates.received || extracted.dates.accepted || extracted.dates.availableOnline || null;
        }
      } else if (ocrResult.text) {
        // 如果没有结构化结果，从OCR文本中提取（向后兼容）
        console.log('[验证模块] 未获取到结构化结果，从OCR文本提取...');
        const ocrText = ocrResult.text;
        const extractedFromText = extractFromOcrText(ocrText);
        Object.assign(extracted, extractedFromText);
      }
      
      console.log('[验证模块] OCR信息提取完成:', extracted);
      
      return extracted;
    } catch (error) {
      console.error('[验证模块] OCR处理失败:', error);
      // 返回错误信息而不是抛出异常
      return {
        firstAuthor: null,
        allAuthors: [],
        date: null,
        dates: {
          received: null,
          accepted: null,
          published: null,
          other: []
        },
        error: error.message || 'OCR处理失败'
      };
    }
  }
  
  // 对图像执行OCR识别
  async function performImageOcr(imageUrl) {
    try {
      // 加载OCR库
      await loadVerificationLibraries();
      
      // 加载图像
      const image = await loadImage(imageUrl);
      
      // 将图像转换为canvas
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = image.width;
      canvas.height = image.height;
      context.drawImage(image, 0, 0);
      
      // 转换为数据URL
      const imageDataUrl = canvas.toDataURL('image/png');
      
      // 使用OCR识别
      const ocrText = await ocrImage(imageDataUrl);
      
      return {
        success: true,
        result: {
          text: ocrText,
          imageUrl: imageUrl
        }
      };
    } catch (error) {
      console.error('[图像OCR] 识别失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // 加载图像
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // 处理跨域
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }
  
  // 加载验证所需的库
  async function loadVerificationLibraries() {
    // 加载pdf.js
    if (!window.pdfjsLib) {
      console.log('[PDF库] 开始加载pdf.js...');
      await new Promise((resolve, reject) => {
        // 检查是否已经存在脚本标签
        // 注意：即使存在脚本标签，由于content script隔离环境，我们也无法访问页面脚本的全局变量
        // 所以我们需要在content script自己的作用域中加载pdf.js
        const existingScript = document.querySelector('script[src*="pdf.js"]');
        if (existingScript) {
          console.log('[PDF库] 发现已存在的pdf.js脚本标签，但由于content script隔离环境，无法访问页面脚本的全局变量');
          console.log('[PDF库] 将在content script自己的作用域中重新加载pdf.js');
          // 不返回，继续执行下面的fetch方式
        }
        
        // 关键修复：content script运行在隔离环境，脚本标签添加到页面会在页面上下文执行
        // 我们需要通过fetch获取脚本内容，然后在content script作用域中执行
        console.log('[PDF库] 开始通过fetch加载pdf.js到content script作用域...');
        
        // 备用CDN源列表（默认使用unpkg.com）
        const pdfJsCdnUrls = [
          'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
        ];
        
        const pdfWorkerCdnUrls = [
          'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
        ];
        
        // 尝试从多个CDN源加载
        let currentCdnIndex = 0;
        const tryLoadFromCdn = (urlIndex) => {
          if (urlIndex >= pdfJsCdnUrls.length) {
            reject(new Error('所有CDN源都无法加载pdf.js'));
            return;
          }
          
          const url = pdfJsCdnUrls[urlIndex];
          const workerUrl = pdfWorkerCdnUrls[urlIndex];
          console.log(`[PDF库] 尝试从CDN加载 (${urlIndex + 1}/${pdfJsCdnUrls.length}):`, url);
          
          fetch(url)
            .then(response => {
              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }
              return response.text();
            })
            .then(scriptText => {
            console.log('[PDF库] pdf.js脚本内容已获取，长度:', scriptText.length);
            
            // 在content script的作用域中执行脚本
            try {
              // 使用Function构造函数在content script作用域中执行
              const executeScript = new Function(scriptText);
              executeScript();
              
              // 等待一小段时间让脚本执行，然后检查
              // 使用轮询方式检查，因为脚本可能需要一些时间才能完全初始化
              let attempts = 0;
              const maxAttempts = 30; // 最多尝试3秒
              const checkPdfjs = (workerUrlToUse, cdnIndex) => {
                attempts++;
                let pdfjs = null;
                
                // 方法1: 直接检查window.pdfjsLib
                try {
                  if (window.pdfjsLib && typeof window.pdfjsLib === 'object' && window.pdfjsLib.getDocument) {
                    pdfjs = window.pdfjsLib;
                    console.log('[PDF库] 在content script的window.pdfjsLib找到pdf.js');
                  }
                } catch (e) {
                  // 忽略
                }
                
                // 方法2: 通过Function构造函数在content script作用域中查找
                if (!pdfjs) {
                  try {
                    // 直接访问全局变量pdfjsLib（在Function构造函数的作用域中）
                    const getPdfjs = new Function('try { return pdfjsLib; } catch(e) { return null; }');
                    pdfjs = getPdfjs();
                    if (pdfjs && typeof pdfjs === 'object' && pdfjs.getDocument) {
                      console.log('[PDF库] 在content script作用域中找到pdfjsLib');
                      // 确保设置到window上
                      window.pdfjsLib = pdfjs;
                    }
                  } catch (e) {
                    // 忽略
                  }
                }
                
                // 方法3: 如果还没找到，尝试通过eval访问（在Function构造函数的作用域中）
                if (!pdfjs) {
                  try {
                    const getPdfjsEval = new Function('try { return eval("pdfjsLib"); } catch(e) { return null; }');
                    pdfjs = getPdfjsEval();
                    if (pdfjs && typeof pdfjs === 'object' && pdfjs.getDocument) {
                      console.log('[PDF库] 通过eval在content script作用域中找到pdfjsLib');
                      window.pdfjsLib = pdfjs;
                    }
                  } catch (e) {
                    // 忽略
                  }
                }
                
                if (pdfjs && typeof pdfjs === 'object' && pdfjs.getDocument) {
                  // 确保设置到window上
                  window.pdfjsLib = pdfjs;
                  if (pdfjs.GlobalWorkerOptions) {
                    // 使用与主脚本相同的CDN源
                    pdfjs.GlobalWorkerOptions.workerSrc = workerUrlToUse;
                    console.log('[PDF库] 设置worker源:', workerUrlToUse);
                  }
                  console.log('[PDF库] pdf.js加载成功，版本:', pdfjs.version || '未知', 'CDN源:', cdnIndex + 1);
                  resolve();
                } else if (attempts < maxAttempts) {
                  setTimeout(() => checkPdfjs(workerUrlToUse, cdnIndex), 100);
                } else {
                  console.error('[PDF库] pdf.js执行后未找到对象');
                  console.error('[PDF库] 调试信息:', {
                    'window.pdfjsLib': typeof window.pdfjsLib,
                    'window.pdfjs': typeof window.pdfjs,
                    'window.PDFJS': typeof window.PDFJS,
                    '尝试次数': attempts
                  });
                  reject(new Error('pdf.js执行后未找到对象，可能pdf.js脚本执行失败或需要更长时间初始化'));
                }
              };
              
              // 延迟一点再开始检查，给脚本执行时间
              // 保存urlIndex到闭包中，以便在checkPdfjs中使用
              const savedUrlIndex = urlIndex;
              setTimeout(() => checkPdfjs(workerUrl, savedUrlIndex), 100);
            } catch (e) {
              console.error('[PDF库] 执行pdf.js脚本失败:', e);
              reject(new Error('执行pdf.js脚本失败: ' + e.message));
            }
            })
            .catch(error => {
              console.warn(`[PDF库] CDN源 ${urlIndex + 1} 加载失败:`, error.message);
              // 尝试下一个CDN源
              tryLoadFromCdn(urlIndex + 1);
            });
        };
        
        // 开始尝试加载
        tryLoadFromCdn(0);
      });
    } else {
      console.log('[PDF库] pdf.js已加载');
    }
    
    // 加载Tesseract.js
    if (!window.Tesseract) {
      console.log('[OCR库] 开始加载Tesseract.js...');
      await new Promise((resolve, reject) => {
        // 关键修复：content script运行在隔离环境，脚本标签添加到页面会在页面上下文执行
        // 我们需要通过fetch获取脚本内容，然后在content script作用域中执行
        console.log('[OCR库] 开始通过fetch加载Tesseract.js到content script作用域...');
        
        fetch('https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/tesseract.min.js')
          .then(response => response.text())
          .then(scriptText => {
            console.log('[OCR库] Tesseract.js脚本内容已获取，长度:', scriptText.length);
            
            // 在content script的作用域中执行脚本
            try {
              // 使用Function构造函数在content script作用域中执行
              const executeScript = new Function(scriptText);
              executeScript();
              
              // 等待一小段时间让脚本执行，然后检查
              // 使用轮询方式检查，因为脚本可能需要一些时间才能完全初始化
              let attempts = 0;
              const maxAttempts = 30; // 最多尝试3秒
              const checkTesseract = () => {
                attempts++;
                let tesseract = null;
                
                // 方法1: 直接检查window.Tesseract
                try {
                  if (window.Tesseract && typeof window.Tesseract === 'object' && window.Tesseract.createWorker) {
                    tesseract = window.Tesseract;
                    console.log('[OCR库] 在content script的window.Tesseract找到Tesseract.js');
                  }
                } catch (e) {
                  // 忽略
                }
                
                // 方法2: 通过Function构造函数在content script作用域中查找
                if (!tesseract) {
                  try {
                    const getTesseract = new Function('try { return Tesseract; } catch(e) { return null; }');
                    tesseract = getTesseract();
                    if (tesseract && typeof tesseract === 'object' && tesseract.createWorker) {
                      console.log('[OCR库] 在content script作用域中找到Tesseract');
                      // 确保设置到window上
                      window.Tesseract = tesseract;
                    }
                  } catch (e) {
                    // 忽略
                  }
                }
                
                if (tesseract && typeof tesseract === 'object' && tesseract.createWorker) {
                  // 确保设置到window上
                  window.Tesseract = tesseract;
                  console.log('[OCR库] Tesseract.js加载成功');
                  resolve();
                } else if (attempts < maxAttempts) {
                  setTimeout(checkTesseract, 100);
                } else {
                  console.error('[OCR库] Tesseract.js执行后未找到对象');
                  console.error('[OCR库] 调试信息:', {
                    'window.Tesseract': typeof window.Tesseract,
                    '尝试次数': attempts
                  });
                  reject(new Error('Tesseract.js执行后未找到对象，可能脚本执行失败或需要更长时间初始化'));
                }
              };
              
              // 延迟一点再开始检查，给脚本执行时间
              setTimeout(checkTesseract, 100);
            } catch (e) {
              console.error('[OCR库] 执行Tesseract.js脚本失败:', e);
              reject(new Error('执行Tesseract.js脚本失败: ' + e.message));
            }
          })
          .catch(error => {
            console.error('[OCR库] 获取Tesseract.js脚本失败:', error);
            reject(new Error('获取Tesseract.js脚本失败: ' + error.message));
          });
      });
    } else {
      console.log('[OCR库] Tesseract.js已加载');
    }
  }
  
  // 从ArrayBuffer将PDF第一页转换为图像
  async function pdfFirstPageToImageFromArrayBuffer(arrayBuffer) {
    try {
      if (!window.pdfjsLib) {
        throw new Error('pdf.js未加载');
      }
      
      // 确保 worker 源已设置（无论是否已设置，都重新设置以确保正确）
      if (window.pdfjsLib.GlobalWorkerOptions) {
        const workerUrls = [
          'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
        ];
        // 如果未设置或设置失败，使用备用源
        if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrls[0];
          console.log('[验证模块] 设置worker源:', workerUrls[0]);
        } else {
          console.log('[验证模块] worker源已设置:', window.pdfjsLib.GlobalWorkerOptions.workerSrc);
        }
      }
      
      console.log('[验证模块] 使用pdf.js加载PDF（从ArrayBuffer）');
      const pdf = await window.pdfjsLib.getDocument({
        data: arrayBuffer,
        withCredentials: false
      }).promise;
      
      console.log('[验证模块] PDF加载成功，页数:', pdf.numPages);
      
      const page = await pdf.getPage(1);
      // 使用scale=4提高渲染质量，确保OCR识别准确
      const viewport = page.getViewport({ scale: 4.0 });
      
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      const context = canvas.getContext('2d');
      // 设置白色背景，避免透明区域影响OCR
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      console.log('[验证模块] 渲染PDF页面到canvas...');
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
      console.log('[验证模块] PDF渲染完成，Canvas尺寸:', canvas.width, 'x', canvas.height);
      return canvas.toDataURL('image/jpeg', 0.95);
    } catch (error) {
      console.error('[验证模块] PDF转图像失败:', error);
      throw new Error(`PDF转图像失败: ${error.message}`);
    }
  }
  
  // PDF第一页转图像（从URL）
  async function pdfFirstPageToImage(pdfUrl) {
    try {
      if (!window.pdfjsLib) {
        throw new Error('pdf.js未加载');
      }
      
      // 确保 worker 源已设置（无论是否已设置，都重新设置以确保正确）
      if (window.pdfjsLib.GlobalWorkerOptions) {
        const workerUrls = [
          'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
        ];
        // 如果未设置或设置失败，使用备用源
        if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrls[0];
          console.log('[验证模块] 设置worker源:', workerUrls[0]);
        } else {
          console.log('[验证模块] worker源已设置:', window.pdfjsLib.GlobalWorkerOptions.workerSrc);
        }
      }
      
      // 不输出完整的base64数据到控制台
      if (pdfUrl && pdfUrl.startsWith('data:application/pdf;base64,')) {
        console.log('[验证模块] 使用pdf.js加载PDF（base64数据已隐藏）');
      } else {
      console.log('[验证模块] 使用pdf.js加载PDF:', pdfUrl);
      }
      const pdf = await window.pdfjsLib.getDocument({
        url: pdfUrl,
        withCredentials: false,
        httpHeaders: {}
      }).promise;
      
      console.log('[验证模块] PDF加载成功，页数:', pdf.numPages);
      
      const page = await pdf.getPage(1);
      // 使用scale=4提高渲染质量，确保OCR识别准确
      const viewport = page.getViewport({ scale: 4.0 });
      
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      const context = canvas.getContext('2d');
      // 设置白色背景，避免透明区域影响OCR
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      console.log('[验证模块] 渲染PDF页面到canvas...');
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
      console.log('[验证模块] PDF渲染完成，Canvas尺寸:', canvas.width, 'x', canvas.height);
      return canvas.toDataURL('image/jpeg', 0.95);
    } catch (error) {
      console.error('[验证模块] PDF转图像失败:', error);
      throw new Error(`PDF转图像失败: ${error.message}`);
    }
  }
  
  // OCR识别（支持中英混排）- 添加超时和资源限制
  async function ocrImage(imageDataUrl, options = {}) {
    const { useChinese = false, timeout = 20000 } = options; // 默认20秒超时
    let worker = null;
    let timeoutId = null;
    try {
      if (!window.Tesseract) {
        throw new Error('Tesseract.js未加载');
      }
      
      console.log('[验证模块] 创建Tesseract worker...', useChinese ? '(中英混排)' : '(仅英文)');
      const { createWorker } = window.Tesseract;
      
      // 验证图像数据
      if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image')) {
        throw new Error('无效的图像数据格式');
      }
      console.log('[验证模块] 图像数据格式验证通过，长度:', imageDataUrl.length);
      
      // 确定语言：中英混排或仅英文
      const languages = useChinese ? 'chi_sim+eng' : 'eng';
      
      // 创建worker，使用简化的API（Tesseract.js 4.x版本）
      worker = await createWorker(languages, 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/worker.min.js',
        langPath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/tesseract-core.wasm.js',
        logger: (m) => {
          // 记录worker的日志
          if (m.status) {
            console.log('[OCR Worker]', m.status, m.progress ? `进度: ${(m.progress * 100).toFixed(1)}%` : '');
          }
        }
      });
      
      console.log('[验证模块] Worker创建成功，开始加载语言:', languages);
      
      // 加载语言包（支持多语言）
      if (useChinese) {
        await worker.loadLanguage('chi_sim');
        await worker.loadLanguage('eng');
        await worker.initialize('chi_sim+eng');
      } else {
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
      }
      
      console.log('[验证模块] Worker初始化完成，开始OCR识别...');
      
      // 使用recognize方法，传入图像数据URL
      // 可以指定PSM（页面分割模式）和区域
      const result = await worker.recognize(imageDataUrl, {
        // PSM模式：6 = 统一文本块（适合单列文本）
        // 3 = 完全自动页面分割（默认）
        // 可以根据文档类型调整
      });
      
      console.log('[验证模块] OCR识别完成，文本长度:', result.data.text.length);
      console.log('[验证模块] OCR文本预览:', result.data.text.substring(0, 100));
      
      // 如果启用了区域检测，可以获取blocks信息
      if (result.data.blocks && result.data.blocks.length > 0) {
        console.log('[验证模块] 检测到', result.data.blocks.length, '个文本块');
        // 可以按位置排序，优先处理顶部区域
        const sortedBlocks = result.data.blocks.sort((a, b) => {
          const aTop = a.bbox.y0 || 0;
          const bTop = b.bbox.y0 || 0;
          return aTop - bTop;
        });
        console.log('[验证模块] 顶部文本块:', sortedBlocks[0]?.text?.substring(0, 50));
      }
      
      const text = result.data.text;
      await worker.terminate();
      worker = null;
      
      return text;
    } catch (error) {
      console.error('[验证模块] OCR识别失败:', error);
      console.error('[验证模块] 错误详情:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        error: error
      });
      
      // 清除超时
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      // 确保worker被终止
      if (worker) {
        try {
          await worker.terminate();
        } catch (e) {
          console.warn('[验证模块] 终止worker时出错:', e);
        }
        worker = null;
      }
      
      throw new Error(`OCR识别失败: ${error.message || error.toString() || '未知错误'}`);
    }
  }
  
  // 从OCR文本中提取信息
  function extractFromOcrText(ocrText) {
    const result = {
      title: null,
      firstAuthor: null,
      allAuthors: [],
      date: null,
      dates: {
        received: null,
        accepted: null,
        published: null,
        other: []
      }
    };
    
    if (!ocrText || ocrText.trim().length === 0) {
      console.log('[OCR提取] OCR文本为空');
      return result;
    }
    
    console.log('[OCR提取] OCR文本长度:', ocrText.length);
    console.log('[OCR提取] OCR文本前500字符:', ocrText.substring(0, 500));
    
    // 提取标题（通常是第一行或前几行，且长度较长）
    const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 0) {
      // 标题通常是第一行或前几行中最长的一行（排除作者行）
      let titleCandidate = '';
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const line = lines[i];
        // 跳过明显的作者行（包含逗号、分号、数字等）
        if (line.match(/^[A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+/) && line.length < 100) {
          continue;
        }
        // 标题通常较长（至少20个字符）且不包含明显的作者模式
        // 排除编号、ID、机构名等无效标题
        const isInvalidTitle = line.match(/^(HIT|DOI|ID|No\.|Number|Manuscript|Paper|Article)\s*[:\-]?\s*[\dA-Z]+/i) ||
                              line.match(/^[A-Z]{2,}\d{4,}/) || // 如 HIT202408004
                              line.match(/^(Key Lab|Laboratory|Department|University|Institute|College|School|Center|Centre)/i) ||
                              line.match(/^(Chinese Medicine|Journal|Article|Paper|Publication)/i) ||
                              line.length < 20;
        if (line.length > titleCandidate.length && !isInvalidTitle && 
            !line.match(/^Author[s]?:|^By:|^\d+[,;]/i)) {
          titleCandidate = line;
        }
      }
      if (titleCandidate) {
        result.title = titleCandidate;
        console.log('[OCR提取] 提取到标题:', titleCandidate.substring(0, 100));
      }
    }
    
    // 提取所有作者（增强模式，处理OCR常见格式）
    const authorListPatterns = [
      // 标准格式：Author: 或 Authors:
      /Author[s]?:\s*([^\n]+(?:\n[^\n]+)*?)(?:\n\n|\nAbstract|$)/i,
      // By: 格式
      /By:\s*([^\n]+(?:\n[^\n]+)*?)(?:\n\n|\nAbstract|$)/i,
      // 开头的作者名格式（处理数字、上标等OCR常见格式）
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[\d\s,;*†‡]+/m,
      // 更宽松的格式：姓名后跟数字或符号
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[,\d\s*†‡]+/m,
      // 简单的姓名格式（至少两个单词，大写开头）
      /^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/m
    ];
    
    for (let i = 0; i < authorListPatterns.length; i++) {
      const pattern = authorListPatterns[i];
      const match = ocrText.match(pattern);
      if (match) {
        console.log('[OCR提取] 模式', i, '匹配成功:', pattern);
        let authorText = match[1];
        console.log('[OCR提取] 提取的原始作者文本:', authorText.substring(0, 200));
        
        // 清理作者文本：移除数字、上标、特殊符号
        authorText = authorText
          .replace(/\d+/g, ' ')  // 移除数字
          .replace(/[†‡*]/g, ' ')  // 移除特殊符号
          .replace(/\s+/g, ' ')  // 规范化空格
          .trim();
        
        // 分割作者（按逗号、分号或换行）
        const extractedAuthors = authorText
          .split(/[,;]\s*|\n/)
          .map(a => {
            // 清理每个作者名
            a = a.replace(/\(contributed equally\)/gi, '').trim();
            a = a.replace(/\(equal contribution\)/gi, '').trim();
            a = a.replace(/†/g, '').trim();
            a = a.replace(/‡/g, '').trim();
            a = a.replace(/\d+/g, '').trim();  // 移除残留数字
            a = a.replace(/\s+/g, ' ').trim();  // 规范化空格
            return a;
          })
          .filter(a => {
            // 过滤：至少包含两个单词，且每个单词至少2个字符
            const words = a.split(/\s+/);
            if (!a || a.length < 5 || words.length < 2 || !words.every(w => w.length >= 2)) {
              return false;
            }
            
            // 过滤机构名、期刊名等无效作者
            const invalidPatterns = [
              /^(Key Lab|Laboratory|Department|University|Institute|College|School|Center|Centre|State Key)/i,
              /^(Chinese Medicine|Journal|Article|Paper|Publication|Editorial|Publisher)/i,
              /^(Inorganic Chemistry|Chemistry Communications|Science|Nature|Cell)/i,
              /^(Manuscript|Number|ID|DOI|Paper|Article|Research)/i,
              /^(Received|Accepted|Published|Available|Online)/i,
              /^(Abstract|Introduction|Keywords|References)/i
            ];
            
            const isInvalid = invalidPatterns.some(pattern => pattern.test(a));
            if (isInvalid) {
              console.log('[OCR提取] 过滤无效作者:', a);
              return false;
            }
            
            // 检查是否像人名（至少包含一个常见人名格式）
            const hasValidNameFormat = /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(a) || 
                                       /^[A-Z][a-z]+\s+[A-Z]\.\s+[A-Z][a-z]+/.test(a);
            return hasValidNameFormat;
          });
        
        console.log('[OCR提取] 清理后的作者列表:', extractedAuthors);
        
        if (extractedAuthors.length > 0) {
          result.allAuthors = extractedAuthors;
          result.firstAuthor = extractedAuthors[0];
          console.log('[OCR提取] 成功提取第一作者:', result.firstAuthor);
          break;
        }
      }
    }
    
    // 如果没有找到作者列表，尝试提取单个作者（更宽松的模式）
    if (!result.firstAuthor) {
      console.log('[OCR提取] 尝试单个作者提取模式...');
      const authorPatterns = [
        // 标准格式：First M. Last
        /^([A-Z][a-z]+\s+[A-Z]\.\s+[A-Z][a-z]+)/,
        // 格式：Last, F.
        /^([A-Z][a-z]+,\s+[A-Z]\.)/,
        // 简单格式：至少两个大写开头的单词
        /^([A-Z][a-z]+\s+[A-Z][a-z]+)/,
        // 更宽松：第一个看起来像人名的部分
        /^([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})/
      ];
      
      for (let i = 0; i < authorPatterns.length; i++) {
        const pattern = authorPatterns[i];
        const match = ocrText.match(pattern);
        if (match) {
          let authorName = match[1].trim();
          // 清理作者名
          authorName = authorName.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
          if (authorName && authorName.length > 3) {
            result.firstAuthor = authorName;
            result.allAuthors = [authorName];
            console.log('[OCR提取] 单个作者提取成功:', result.firstAuthor);
            break;
          }
        }
      }
    }
    
    if (!result.firstAuthor) {
      console.log('[OCR提取] 未能提取到作者，OCR文本前200字符:', ocrText.substring(0, 200));
    }
    
    // 提取所有日期（使用与background.js类似的逻辑）
    const dateKeywords = {
      received: ['Received', 'Received date', 'Received:', 'Submitted', 'Submitted on', 'Submission date'],
      accepted: ['Accepted', 'Accepted date', 'Accepted:', 'Acceptance date'],
      published: ['Published', 'Published date', 'Published:', 'Publication date', 'Date of publication', 'Available online', 'Date:', 'Date'] // 添加通用的Date关键词
    };
    
    const datePatterns = [
      /(\d{1,2} [A-Z][a-z]+ \d{4})/,    // DD Month YYYY (如: 6 April 2025) - 优先匹配这个格式
      /([A-Z][a-z]+ \d{1,2}, \d{4})/,   // Month DD, YYYY (如: December 25, 2025)
      /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/,  // YYYY-MM-DD
      /(\d{1,2}[-/]\d{1,2}[-/]\d{4})/,  // MM-DD-YYYY
      /(\d{4})/                          // YYYY
    ];
    
    // 提取Received日期
    for (const keyword of dateKeywords.received) {
      const keywordIndex = ocrText.indexOf(keyword);
      if (keywordIndex !== -1) {
        const context = ocrText.substring(keywordIndex, keywordIndex + 150);
        for (const pattern of datePatterns) {
          const match = context.match(pattern);
          if (match) {
            result.dates.received = match[1];
            break;
          }
        }
        if (result.dates.received) break;
      }
    }
    
    // 提取Accepted日期
    for (const keyword of dateKeywords.accepted) {
      const keywordIndex = ocrText.indexOf(keyword);
      if (keywordIndex !== -1) {
        const context = ocrText.substring(keywordIndex, keywordIndex + 150);
        for (const pattern of datePatterns) {
          const match = context.match(pattern);
          if (match) {
            result.dates.accepted = match[1];
            break;
          }
        }
        if (result.dates.accepted) break;
      }
    }
    
    // 提取Published/Available online日期（优先）
    const publishedKeywords = ['Available online', 'Available online:', 'Published', 'Published:', 'Published date', 'Publication date', 'Date of publication'];
    for (const keyword of publishedKeywords) {
      const keywordIndex = ocrText.indexOf(keyword);
      if (keywordIndex !== -1) {
        const context = ocrText.substring(keywordIndex, keywordIndex + 200);
        for (const pattern of datePatterns) {
          const match = context.match(pattern);
          if (match) {
            let dateStr = match[1];
            // 标准化日期格式
            dateStr = normalizeDateString(dateStr);
            if (dateStr) {
              result.dates.published = dateStr;
              console.log('[OCR提取] 找到Published/Available online日期:', dateStr);
              break;
            }
          }
        }
        if (result.dates.published) break;
      }
    }
    
    // 提取其他日期
    const allDates = [];
    for (const pattern of datePatterns) {
      const matches = ocrText.matchAll(new RegExp(pattern.source, 'g'));
      for (const match of matches) {
        const date = match[1];
        if (date !== result.dates.received && date !== result.dates.accepted && date !== result.dates.published) {
          const yearMatch = date.match(/(\d{4})/);
          if (yearMatch) {
            const year = parseInt(yearMatch[1]);
            // 过滤无效年份（排除1900、1990、1997等明显错误的年份）
            const invalidYears = [1900, 1990, 1997];
            if (year >= 2000 && year <= 2100 && !invalidYears.includes(year)) {
              allDates.push(date);
            }
          }
        }
      }
    }
    result.dates.other = [...new Set(allDates)].slice(0, 5);
    
    // 设置主要日期字段（用于兼容）
    result.date = result.dates.received || result.dates.accepted || result.dates.published || null;
    
    return result;
  }
})();
