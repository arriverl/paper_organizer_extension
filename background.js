// 后台脚本：处理PDF下载和解析（集成pdf.js）
'use strict';

// 存储已下载的论文信息
let downloadedPapers = [];

// 从storage加载已下载论文列表
chrome.storage.local.get(['papers'], (result) => {
  if (result.papers && Array.isArray(result.papers)) {
    downloadedPapers = result.papers;
    console.log('[论文助手] 已加载', downloadedPapers.length, '篇论文记录');
  } else {
    downloadedPapers = [];
    console.log('[论文助手] 论文记录为空，初始化为空数组');
  }
});

// 加载pdf.js库
let pdfjsLib = null;
let pdfJsLoading = false;
let pdfJsLoadPromise = null;

async function loadPdfJs() {
  if (pdfjsLib) {
    console.log('[论文助手] pdf.js已加载');
    return pdfjsLib;
  }
  if (pdfJsLoading && pdfJsLoadPromise) {
    console.log('[论文助手] pdf.js正在加载中...');
    return pdfJsLoadPromise;
  }
  
  pdfJsLoading = true;
  pdfJsLoadPromise = (async () => {
    try {
      console.log('[论文助手] 开始加载pdf.js...');
      
      // 在background script中使用importScripts加载pdf.js
      // Manifest V2的background script支持importScripts
      try {
        importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
        
        // 检查是否成功加载
        if (typeof self !== 'undefined' && self.pdfjsLib) {
          pdfjsLib = self.pdfjsLib;
        } else if (typeof globalThis !== 'undefined' && globalThis.pdfjsLib) {
          pdfjsLib = globalThis.pdfjsLib;
        } else if (typeof window !== 'undefined' && window.pdfjsLib) {
          pdfjsLib = window.pdfjsLib;
        } else {
          console.error('[论文助手] pdf.js加载后未找到pdfjsLib对象');
          pdfjsLib = null;
        }
        
        if (pdfjsLib) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          console.log('[论文助手] pdf.js加载成功，版本:', pdfjsLib.version || '未知');
        }
      } catch (e) {
        console.error('[论文助手] importScripts加载pdf.js失败:', e);
        pdfjsLib = null;
      }
      
      if (!pdfjsLib) {
        console.error('[论文助手] pdf.js未加载，PDF解析功能将不可用');
      }
      
      return pdfjsLib;
    } catch (error) {
      console.error('[论文助手] 加载pdf.js失败，将使用基础功能:', error);
      pdfjsLib = null;
      return null;
    } finally {
      pdfJsLoading = false;
    }
  })();
  
  return pdfJsLoadPromise;
}

// 存储API响应数据
let apiResponseData = null;

// 监听webRequest，拦截目标API响应
chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    // 检查是否是目标API
    if (details.url.includes('/rapi/opus/academicAudit/getFundInformation')) {
      console.log('[API拦截] 检测到目标API请求:', details.url);
    }
  },
  { urls: ['*://kecaihui-tm-zz.cast.org.cn/*'] },
  ['requestBody']
);

// 使用webRequest API拦截响应（需要监听响应头）
// 注意：由于Chrome扩展的限制，我们需要在content script中拦截fetch/XMLHttpRequest
// 这里我们提供一个存储机制，让content script可以存储API响应

// OCR/LLM配置（从storage读取）
// 注意：ocrConfig 在 ocr-api.js 中定义并加载，这里只负责补充 LLM 配置与动态更新。
let llmConfig = {
  baseUrl: '',
  apiKey: '',
  model: 'deepseek-v3.2'
};

chrome.storage.local.get(['llmConfig'], (result) => {
  if (result.llmConfig) {
    llmConfig = { ...llmConfig, ...result.llmConfig };
    console.log('[LLM] LLM配置已加载:', { baseUrl: llmConfig.baseUrl || '(reuse ocrBaseUrl)', model: llmConfig.model, hasApiKey: !!llmConfig.apiKey });
  }
});

// 监听配置变更，热更新 background 中使用的配置
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.ocrConfig && changes.ocrConfig.newValue && typeof ocrConfig !== 'undefined') {
    ocrConfig = { ...ocrConfig, ...changes.ocrConfig.newValue };
    console.log('[OCR] OCR配置已更新:', { baseUrl: ocrConfig.baseUrl, model: ocrConfig.model, hasApiKey: !!ocrConfig.apiKey });
  }
  if (changes.llmConfig && changes.llmConfig.newValue) {
    llmConfig = { ...llmConfig, ...changes.llmConfig.newValue };
    console.log('[LLM] LLM配置已更新:', { baseUrl: llmConfig.baseUrl || '(reuse ocrBaseUrl)', model: llmConfig.model, hasApiKey: !!llmConfig.apiKey });
  }
});

function getOcrPureTextPrompt() {
  // 明确要求提取全部可见文字，不要做邮箱界面判断，不要加入占位符
  // 注意：使用image_url格式时，提示词中不需要<image>占位符
  return '请只返回图片/PDF页面中的**全部可见文字**，按从上到下顺序逐行输出。不要做邮箱界面判断，不要加入---占位符，不要输出JSON，不要总结。输出所有识别到的文字，包括标题、正文、日期、作者等所有内容。';
}

function isDegenerateOcrOutput(text) {
  const t = String(text || '').replace(/\s+/g, '');
  if (t.length < 50) return false;
  const counts = {};
  for (const ch of t) counts[ch] = (counts[ch] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const unique = entries.length;
  const topCount = entries[0]?.[1] || 0;
  const topRatio = topCount / t.length;
  if (unique <= 3 && topRatio > 0.8) return true;
  if (/^[\}\]\)\{\[,.:;"'`~!@#$%^&*+=<>|\\/-]+$/.test(t) && topRatio > 0.6) return true;
  return false;
}

function getAcademicStructuringPrompt() {
  // 二段式流程的第二段：LLM从OCR文本中提取结构化信息
  // 适配邮件场景，不要因为看到"收件箱"就判断为界面
  return `你是学术文档信息抽取助手。下面是OCR识别得到的原始文本（可能包含论文首页、录用通知、邮件、网页截图等）。请从中提取论文关键信息并输出严格JSON。

重要提示：
1) 如果文本中包含"收件箱"、"草稿箱"等邮箱界面词汇，但同时也包含论文相关信息（如论文名称、作者、录用日期等），请判断为【邮件】类型，并提取其中的论文信息。
2) 不要因为出现"收件箱"就判为界面，要检查是否包含实际的论文/录用信息。
3) 对于邮件场景，重点关注：邮件主题/托举对象、论文名称、作者、录用日期、发件人邮箱等信息。

要求：
1) 只输出一个JSON对象，不要输出任何额外文字、不要使用Markdown代码块。
2) 若缺失，填写 "Not mentioned"。
3) 日期请尽量标准化为 YYYY-MM-DD；若只出现到月份/年份，保留原样并在 confidence_note 说明不确定性。
4) first_author字段：提取第一作者的全名（如果作者列表中有多个作者，取第一个）。
5) is_co_first字段：判断第一作者是否为共一作者。如果作者列表中第一个作者名字旁边有"*"、"†"、"‡"等共一标记，或者明确标注"co-first author"、"共同第一作者"等，则填写true，否则填写false。

输出JSON格式（字段名必须一致）：
{
  "document_type": "[论文首页/录用通知/邮件/其他]",
  "title": "",
  "first_author": "",
  "is_co_first": false,
  "authors": "",
  "dates": {
    "received": "",
    "received_in_revised": "",
    "accepted": "",
    "available_online": ""
  },
  "confidence_note": ""
}`;
}

async function callChatCompletions({ baseUrl, apiKey, model, messages, temperature = 0, max_tokens = 2048 }) {
  if (!baseUrl) throw new Error('Base URL未配置');
  if (!apiKey) throw new Error('API Key未配置');
  if (!model) throw new Error('Model未配置');

  const apiUrl = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const requestBody = {
    model,
    messages,
    temperature,
    max_tokens,
    stream: false
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API请求失败: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('API返回内容为空');
  }
  return { content, raw: data };
}

function extractJsonFromText(text) {
  if (!text) return { json: null, error: 'empty' };

  const tryParse = (jsonStr) => {
    try {
      return { json: JSON.parse(jsonStr), error: null };
    } catch (e) {
      return { json: null, error: e.message };
    }
  };

  // ```json ... ```
  const jsonBlock = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonBlock?.[1]) return tryParse(jsonBlock[1]);

  // ``` ... ```
  const codeBlock = text.match(/```\s*([\s\S]*?)\s*```/);
  if (codeBlock?.[1]) return tryParse(codeBlock[1]);

  // 通过括号计数抽取第一个完整JSON对象
  let braceCount = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (braceCount === 0) start = i;
      braceCount++;
    } else if (ch === '}') {
      braceCount--;
      if (braceCount === 0 && start !== -1) {
        const candidate = text.slice(start, i + 1);
        const parsed = tryParse(candidate);
        if (parsed.json) return parsed;
        start = -1;
      }
    }
  }

  // 最后兜底：找最长的 {...}
  const matches = text.match(/\{[\s\S]*\}/g);
  if (matches?.length) {
    matches.sort((a, b) => b.length - a.length);
    for (const m of matches) {
      const parsed = tryParse(m);
      if (parsed.json) return parsed;
    }
  }

  return { json: null, error: 'json_parse_failed' };
}

function buildStructuringInputText(ocrText) {
  const text = (ocrText || '').replace(/\r/g, '');
  const maxChars = 16000;
  if (text.length <= maxChars) return { text, truncated: false };

  const head = text.slice(0, 12000);
  const tail = text.slice(-2500);
  const keywordRegex = /(received|accepted|revised|available\s+online|published|submission|manuscript|doi|录用|接受|修订|在线|收到|投稿)/i;

  const lines = text.split('\n');
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!keywordRegex.test(lines[i])) continue;
    for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
      const line = lines[j].trim();
      if (!line) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      picked.push(line);
      if (picked.length >= 80) break;
    }
    if (picked.length >= 80) break;
  }

  const keywordsBlock = picked.length ? `\n\n[关键行摘录]\n${picked.join('\n')}` : '';
  const combined = `${head}\n\n[...OCR文本过长已截断...]\n${keywordsBlock}\n\n[尾部文本]\n${tail}`;
  return { text: combined.slice(0, maxChars), truncated: true };
}

async function ocrExtractTextFromImageDataUrl(imageDataUrl) {
  if (!ocrConfig?.apiKey) {
    throw new Error('OCR API Key未配置，请在设置中配置API Key');
  }
  if (!ocrConfig?.baseUrl) {
    throw new Error('OCR Base URL未配置');
  }
  if (!ocrConfig?.model) {
    throw new Error('OCR模型未配置');
  }

  const retryPrompts = [
    getOcrPureTextPrompt(),
    '请只返回图片中的全部可见文字，逐行输出。不要做界面判断，不要加入占位符。',
    'Extract all visible text from the image line by line. Output only the text, no placeholders.'
  ];

  let lastContent = '';
  for (let i = 0; i < retryPrompts.length; i++) {
    const currentPrompt = retryPrompts[i];
    console.log(`[OCR] 尝试第${i + 1}次，prompt前100字符:`, currentPrompt.substring(0, 100));
    console.log(`[OCR] 图片数据URL长度:`, imageDataUrl.length, '前50字符:', imageDataUrl.substring(0, 50));
    
    const { content } = await callChatCompletions({
      baseUrl: ocrConfig.baseUrl,
      apiKey: ocrConfig.apiKey,
      model: ocrConfig.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: currentPrompt },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
          ]
        }
      ],
      temperature: 0,
      max_tokens: 4096
    });

    console.log('[OCR] API返回内容长度:', content.length);
    console.log('[OCR] API返回内容前200字符:', content.substring(0, 200));
    
    // 检查返回内容是否包含提示词（说明可能有问题）
    if (content.includes(currentPrompt.substring(0, 50))) {
      console.warn('[OCR] ⚠️ 警告：返回内容包含提示词，可能API调用有问题！');
      console.warn('[OCR] 返回内容:', content);
    }

    lastContent = content;
    if (!isDegenerateOcrOutput(content)) {
      return content;
    }
    console.warn('[OCR] 检测到异常输出（低多样性/重复符号），准备重试...');
  }

  console.warn('[OCR] 多次重试后仍异常，返回最后一次输出');
  return lastContent;
}

// 检查同一论文的所有文件是否都有路径，如果有则生成或更新JSON
function checkAndGenerateJsonForPaper(paperKey, paperData, pageUrl) {
  // 查找同一论文的所有待处理文件
  const paperFiles = [];
  for (const [fileKey, record] of pendingDownloads.entries()) {
    if (record.paperKey === paperKey && record.filePath) {
      paperFiles.push({
        filePath: record.filePath,
        fileType: record.fileInfo.type || '未知类型',
        fileName: record.fileInfo.name
      });
    }
  }
  
  // 如果至少有一个文件有路径，生成或更新JSON
  if (paperFiles.length > 0) {
    // 提取文件路径列表
    const filePaths = paperFiles.map(f => f.filePath);
    
    // 检查是否已经生成过JSON（通过检查是否有标记）
    const hasGenerated = Array.from(pendingDownloads.values())
      .some(r => r.paperKey === paperKey && r.jsonGenerated);
    
    // 如果已经生成过，延迟更新（等待所有文件都记录完成）
    // 如果还没生成，立即生成
    if (hasGenerated) {
      // 已经生成过，延迟更新（给其他文件时间记录）
      // 清除之前的延迟定时器（如果存在）
      if (paperJsonUpdateTimers && paperJsonUpdateTimers[paperKey]) {
        clearTimeout(paperJsonUpdateTimers[paperKey]);
      }
      
      // 设置新的延迟（2秒后更新，如果期间没有新文件）
      if (!paperJsonUpdateTimers) {
        paperJsonUpdateTimers = {};
      }
      paperJsonUpdateTimers[paperKey] = setTimeout(() => {
        // 重新收集所有文件路径（可能已经有新文件了）
        const updatedPaperFiles = [];
        for (const [fileKey, record] of pendingDownloads.entries()) {
          if (record.paperKey === paperKey && record.filePath) {
            updatedPaperFiles.push({
              filePath: record.filePath,
              fileType: record.fileInfo.type || '未知类型',
              fileName: record.fileInfo.name
            });
          }
        }
        
        const updatedFilePaths = updatedPaperFiles.map(f => f.filePath);
        
        // 更新JSON文件（覆盖模式）
        generateSimpleVerificationJson(paperData, updatedFilePaths, pageUrl).catch(err => {
          console.error('[验证JSON] 更新失败:', err);
        });
        
        console.log('[验证JSON] 延迟更新JSON（包含所有已记录文件）:', {
          paperKey: paperKey,
          fileCount: updatedPaperFiles.length,
          filePaths: updatedFilePaths
        });
        
        delete paperJsonUpdateTimers[paperKey];
      }, 2000); // 延迟2秒
    } else {
      // 还没生成过，立即生成
      // 标记所有文件为已生成JSON
      for (const [fileKey, record] of pendingDownloads.entries()) {
        if (record.paperKey === paperKey) {
          record.jsonGenerated = true;
        }
      }
      
      // 生成JSON文件
      generateSimpleVerificationJson(paperData, filePaths, pageUrl).catch(err => {
        console.error('[验证JSON] 生成失败:', err);
        // 如果生成失败，重置标记，允许重试
        for (const [fileKey, record] of pendingDownloads.entries()) {
          if (record.paperKey === paperKey) {
            record.jsonGenerated = false;
          }
        }
      });
      
      console.log('[验证JSON] 检测到文件路径，开始生成JSON:', {
        paperKey: paperKey,
        fileCount: paperFiles.length,
        filePaths: filePaths
      });
    }
  }
}

// 生成验证JSON文件（简单版本，仅包含网页元数据和文件路径）
// 使用论文标题前10个字作为文件名
async function generateSimpleVerificationJson(paperData, filePaths, pageUrl) {
  try {
    // 获取下载目录（从第一个文件路径提取）
    const firstFilePath = Array.isArray(filePaths) ? filePaths[0] : filePaths;
    if (!firstFilePath) {
      console.warn('[验证JSON] 没有文件路径，跳过生成JSON文件');
      return;
    }
    
    let downloadDir;
    if (firstFilePath.includes('\\')) {
      // Windows路径
      const pathParts = firstFilePath.split('\\');
      pathParts.pop(); // 移除文件名
      downloadDir = pathParts.join('\\');
    } else {
      // Unix路径
      const pathParts = firstFilePath.split('/');
      pathParts.pop(); // 移除文件名
      downloadDir = pathParts.join('/');
    }
    
    if (!downloadDir) {
      // 如果无法从路径提取，尝试从storage获取
      const storage = await new Promise((resolve) => {
        chrome.storage.local.get(['downloadDirectory'], resolve);
      });
      downloadDir = storage.downloadDirectory;
    }
    
    if (!downloadDir) {
      console.warn('[验证JSON] 无法确定下载目录，跳过生成JSON文件');
      return;
    }
    
    // 构建JSON数据
    const verificationData = {
      // 网页元数据
      webData: {
        title: paperData.title || '',
        firstAuthor: paperData.firstAuthor || paperData.author || '',
        allAuthors: paperData.allAuthors || [],
        date: paperData.extractedDate || paperData.date || '',
        dates: paperData.dates || null,
        pageUrl: pageUrl || paperData.pageUrl || ''
      },
      
      // 文件信息（列表格式，与Python验证器兼容）
      files: [],
      
      // 时间戳
      timestamp: paperData.downloadTime || new Date().toISOString(),
      
      // 版本信息
      version: '1.0'
    };
    
    // 填充文件路径（列表格式，去重）
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    const seenFiles = new Set(); // 用于去重，基于文件名+路径
    
    paths.forEach((filePath, index) => {
      if (filePath) {
        // 从文件路径提取文件名
        const fileName = filePath.split(/[/\\]/).pop();
        // 使用文件名+路径作为唯一标识进行去重
        const fileKey = `${fileName}:${filePath}`;
        
        if (seenFiles.has(fileKey)) {
          console.log('[验证JSON] 跳过重复文件:', fileName);
          return; // 跳过重复文件
        }
        seenFiles.add(fileKey);
        
        // 根据文件名判断文件类型
        let fileType = '论文全文';
        if (fileName.includes('录用通知') || fileName.includes('acceptance')) {
          fileType = '正式录用通知';
        } else if (fileName.includes('证明') || fileName.includes('proof')) {
          fileType = '证明材料';
        } else if (fileName.includes('论文') || fileName.includes('paper')) {
          fileType = '论文全文';
        }
        
        verificationData.files.push({
          type: fileType,
          fileName: fileName,
          filePath: filePath,
          downloadTime: new Date().toISOString()
        });
      }
    });
    
    // 生成JSON内容
    const jsonContent = JSON.stringify(verificationData, null, 2);
    
    // 使用论文标题前10个字作为文件名
    const title = paperData.title || '未知标题';
    // 清理标题，只保留前10个字符（中英文都算1个字符）
    let jsonFileName = title.substring(0, 10)
      .replace(/[<>:"/\\|?*()\x00-\x1F]/g, '_')  // 替换非法字符
      .replace(/\s+/g, '_')  // 空格替换为下划线
      .replace(/_{2,}/g, '_')  // 多个下划线合并为一个
      .replace(/^_+|_+$/g, '');  // 移除首尾下划线
    
    if (!jsonFileName || jsonFileName.length === 0) {
      jsonFileName = '未知标题';
    }
    
    jsonFileName = jsonFileName + '.json';
    
    // 构建完整路径
    // Chrome下载API在Windows上也使用正斜杠，需要统一转换
    let normalizedDir = downloadDir.replace(/\\/g, '/');
    
    // 进一步清理文件名，确保没有非法字符
    // Chrome下载API对文件名有严格限制
    // Windows文件名不能包含: < > : " | ? * \ / 以及控制字符 (0x00-0x1F)
    // 同时避免使用保留名称: CON, PRN, AUX, NUL, COM1-9, LPT1-9
    let cleanedFileName = jsonFileName
      .replace(/[<>:"|?*\\/\x00-\x1F]/g, '_')  // 替换所有非法字符（包括反斜杠和正斜杠）
      .replace(/\s+/g, '_')  // 空格替换为下划线
      .replace(/_{2,}/g, '_')  // 多个下划线合并
      .replace(/^_+|_+$/g, '')  // 移除首尾下划线
      .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, '_$1$2');  // 避免Windows保留名称
    
    // 确保文件名不为空且长度合理（Windows限制255字符）
    if (!cleanedFileName || cleanedFileName.length === 0) {
      console.warn('[验证JSON] 清理后的文件名为空，使用默认名称');
      cleanedFileName = 'paper_info.json';
    } else if (cleanedFileName.length > 200) {
      // 如果文件名太长，截断并保留扩展名
      const ext = cleanedFileName.substring(cleanedFileName.lastIndexOf('.'));
      const nameWithoutExt = cleanedFileName.substring(0, cleanedFileName.lastIndexOf('.'));
      cleanedFileName = nameWithoutExt.substring(0, 200 - ext.length) + ext;
      console.warn('[验证JSON] 文件名过长，已截断:', cleanedFileName);
    }
    
    // 构建最终路径（使用正斜杠，Chrome API会自动转换）
    const finalPath = `${normalizedDir}/${cleanedFileName}`;
    
    console.log('[验证JSON] 准备下载JSON文件:', {
      downloadDir: downloadDir,
      normalizedDir: normalizedDir,
      originalFileName: jsonFileName,
      cleanedFileName: cleanedFileName,
      finalPath: finalPath,
      pathLength: finalPath.length
    });
    
    // 创建Blob并下载
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    
    // 使用chrome.downloads下载JSON文件（覆盖模式）
    chrome.downloads.download({
      url: blobUrl,
      filename: finalPath,
      saveAs: false,
      conflictAction: 'overwrite'  // 覆盖已存在的JSON文件
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        const error = chrome.runtime.lastError;
        console.error('[验证JSON] 下载失败:', error);
        console.error('[验证JSON] 错误详情:', {
          message: error.message,
          finalPath: finalPath,
          pathLength: finalPath.length,
          downloadDir: downloadDir,
          normalizedDir: normalizedDir,
          cleanedFileName: cleanedFileName,
          fileNameLength: cleanedFileName.length
        });
        
        // 如果路径包含中文字符或路径太长，尝试使用相对路径
        if (finalPath.match(/[\u4e00-\u9fa5]/) || finalPath.length > 250) {
          console.warn('[验证JSON] 路径包含中文字符或过长，尝试使用相对路径重试...');
          // 只使用文件名，让Chrome自动保存到默认下载目录
          // 注意：需要重新创建blob URL，因为之前的可能已被撤销
          const blobUrl2 = URL.createObjectURL(blob);
          chrome.downloads.download({
            url: blobUrl2,
            filename: cleanedFileName,
            saveAs: false,
            conflictAction: 'overwrite'
          }, (downloadId2) => {
            URL.revokeObjectURL(blobUrl2);
            if (chrome.runtime.lastError) {
              console.error('[验证JSON] 相对路径下载也失败:', chrome.runtime.lastError);
            } else {
              console.log('[验证JSON] ✓ JSON文件已生成（使用相对路径）:', cleanedFileName);
              console.log('[验证JSON] 📁 文件已保存到默认下载目录');
              
              // 显示通知
              try {
                chrome.notifications.create({
                  type: 'basic',
                  iconUrl: 'icons/icon48.png',
                  title: 'JSON文件已生成',
                  message: `文件名: ${cleanedFileName}\n\n文件已保存到默认下载目录。`
                });
              } catch (e) {
                console.log('[验证JSON] 通知创建失败（可能未授权）:', e);
              }
            }
          });
        } else {
          // 如果失败但不是中文路径问题，直接撤销URL
          URL.revokeObjectURL(blobUrl);
        }
      } else {
        URL.revokeObjectURL(blobUrl);
        console.log('[验证JSON] ✓ JSON文件已生成:', finalPath);
        console.log('[验证JSON] 📁 文件位置:', downloadDir);
        console.log('[验证JSON] 📄 文件名:', cleanedFileName);
        
        // 显示通知，告知用户JSON文件位置
        try {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'JSON文件已生成',
            message: `文件名: ${cleanedFileName}\n位置: ${downloadDir}\n\n文件已保存到下载目录，可直接打开使用。`
          });
        } catch (e) {
          console.log('[验证JSON] 通知创建失败（可能未授权）:', e);
        }
      }
    });
  } catch (error) {
    console.error('[验证JSON] 生成失败:', error);
  }
}

// 生成固定文件名的验证JSON文件，供Python软件读取（完整版本，包含验证结果）
async function generateVerificationJsonFile(verificationResult, fileInfo = {}) {
  try {
    // 获取下载目录
    const storage = await new Promise((resolve) => {
      chrome.storage.local.get(['downloadDirectory'], resolve);
    });
    const downloadDir = storage.downloadDirectory;
    
    if (!downloadDir) {
      console.warn('[验证JSON] 未设置下载目录，跳过生成JSON文件');
      return;
    }
    
    // 构建JSON数据，包含所有验证需要的信息
    const verificationData = {
      // 网页元数据
      webData: {
        title: verificationResult.webMetadata?.title || '',
        firstAuthor: verificationResult.webMetadata?.firstAuthor || '',
        allAuthors: verificationResult.webMetadata?.allAuthors || [],
        date: verificationResult.webMetadata?.date || '',
        dates: verificationResult.webMetadata?.dates || null,
        pageUrl: verificationResult.pageUrl || ''
      },
      
      // PDF提取的数据
      pdfTextData: verificationResult.pdfTextData || null,
      
      // OCR提取的数据
      ocrData: verificationResult.ocrData || null,
      
      // 验证结果
      matchResult: verificationResult.matchResult || null,
      
      // 文件信息（列表格式，与Python验证器兼容）
      files: [],
      
      // 时间戳
      timestamp: verificationResult.timestamp || new Date().toISOString(),
      
      // 版本信息
      version: '1.0'
    };
    
    // 如果有文件信息，填充文件路径（列表格式）
    if (fileInfo.filePath) {
      const fileName = fileInfo.filePath.split(/[/\\]/).pop();
      let fileType = '论文全文';
      if (fileName.includes('录用通知') || fileName.includes('acceptance')) {
        fileType = '正式录用通知';
      } else if (fileName.includes('证明') || fileName.includes('proof')) {
        fileType = '证明材料';
      } else if (fileName.includes('论文') || fileName.includes('paper')) {
        fileType = '论文全文';
      }
      
      verificationData.files.push({
        type: fileType,
        fileName: fileName,
        filePath: fileInfo.filePath,
        downloadTime: new Date().toISOString()
      });
    }
    
    // 如果有多个文件，尝试从paperFilesMap中获取
    if (verificationResult.webMetadata) {
      const paperKey = getPaperKey(verificationResult.webMetadata);
      const paperRecord = paperFilesMap.get(paperKey);
      if (paperRecord && paperRecord.files && paperRecord.files.length > 0) {
        const files = paperRecord.files.slice(0, 3); // 最多3个文件
        files.forEach((file) => {
          if (file && file.filePath) {
            const fileName = file.filePath.split(/[/\\]/).pop();
            let fileType = file.type || '论文全文';
            if (fileName.includes('录用通知') || fileName.includes('acceptance')) {
              fileType = '正式录用通知';
            } else if (fileName.includes('证明') || fileName.includes('proof')) {
              fileType = '证明材料';
            } else if (fileName.includes('论文') || fileName.includes('paper')) {
              fileType = '论文全文';
            }
            
            verificationData.files.push({
              type: fileType,
              fileName: fileName,
              filePath: file.filePath,
              downloadTime: file.downloadTime || new Date().toISOString()
            });
          }
        });
      }
    }
    
    // 生成JSON内容
    const jsonContent = JSON.stringify(verificationData, null, 2);
    
    // 固定文件名：verification_data.json
    const jsonFileName = 'verification_data.json';
    
    // 构建完整路径
    const separator = downloadDir.includes('\\') ? '\\' : '/';
    const jsonFilePath = `${downloadDir}${separator}${jsonFileName}`;
    
    // 创建Blob并下载
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    
    // 使用chrome.downloads下载JSON文件（覆盖模式）
    chrome.downloads.download({
      url: blobUrl,
      filename: jsonFilePath,
      saveAs: false,
      conflictAction: 'overwrite'  // 覆盖已存在的JSON文件
    }, (downloadId) => {
      URL.revokeObjectURL(blobUrl);
      
      if (chrome.runtime.lastError) {
        console.error('[验证JSON] 下载失败:', chrome.runtime.lastError);
      } else {
        console.log('[验证JSON] ✓ JSON文件已生成:', jsonFilePath);
      }
    });
  } catch (error) {
    console.error('[验证JSON] 生成失败:', error);
  }
}

async function structureAcademicInfoFromOcrText(ocrText) {
  const baseUrl = llmConfig.baseUrl || ocrConfig.baseUrl;
  const apiKey = llmConfig.apiKey || ocrConfig.apiKey;
  const model = llmConfig.model;

  const { text: structInputText, truncated } = buildStructuringInputText(ocrText);
  const { content } = await callChatCompletions({
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: '你是一个严谨的JSON信息抽取器。' },
      { role: 'user', content: `${getAcademicStructuringPrompt()}\n\nOCR文本如下：\n${structInputText}` }
    ],
    temperature: 0,
    max_tokens: 2048
  });

  const parsed = extractJsonFromText(content);
  return {
    rawText: content,
    structured: parsed.json,
    isStructured: !!parsed.json,
    parseError: parsed.error,
    truncatedInput: truncated
  };
}

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] 收到消息:', request.action, request);
  
  if (request.action === 'storeApiResponse') {
    // 存储API响应数据
    apiResponseData = request.data;
    console.log('[API拦截] 存储API响应数据:', apiResponseData);
    chrome.storage.local.set({ lastApiResponse: apiResponseData }, () => {
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'getApiResponse') {
    // 获取存储的API响应数据
    chrome.storage.local.get(['lastApiResponse'], (result) => {
      if (result.lastApiResponse) {
        apiResponseData = result.lastApiResponse;
        sendResponse({ success: true, data: apiResponseData });
      } else {
        sendResponse({ success: false, message: '未找到API响应数据' });
      }
    });
    return true;
  } else if (request.action === 'processApiResponse') {
    // 处理API响应数据，提取信息并下载文件
    chrome.storage.local.get(['lastApiResponse'], async (result) => {
      if (!result.lastApiResponse) {
        sendResponse({ success: false, message: '未找到API响应数据，请先触发API请求' });
        return;
      }
      
      const apiData = result.lastApiResponse;
      try {
        const processedData = await processApiResponseData(apiData);
        sendResponse({ success: true, data: processedData });
      } catch (error) {
        console.error('[API处理] 处理失败:', error);
        sendResponse({ success: false, message: error.message });
      }
    });
    return true;
  } else if (request.action === 'clearAllPapers') {
    // 清空所有论文记录
    downloadedPapers = [];
    paperFilesMap.clear(); // 同时清空文件映射
    pendingDownloads.clear(); // 同时清空待处理下载记录
    chrome.storage.local.set({ papers: [] }, () => {
      console.log('[论文助手] 所有论文记录已清空（包括内存变量和文件映射）');
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'checkPaperDuplicate') {
    // 检查论文是否重复
    // 在检查前，先从storage同步最新数据，确保查重基于用户保存的记录
    console.log('[Background] 开始检查重复，论文信息:', request.paperInfo);
    chrome.storage.local.get(['papers'], (result) => {
      try {
        const storedPapers = result.papers || [];
        // 同步到内存变量
        downloadedPapers = storedPapers;
        console.log('[查重] 从storage同步数据，当前记录数:', downloadedPapers.length);
        
        const paperInfo = request.paperInfo;
        const pdfUrl = request.pdfUrl || null;
        const duplicateCheck = checkPaperDuplicate(paperInfo, pdfUrl);
        console.log('[查重] 检查结果:', duplicateCheck);
        sendResponse(duplicateCheck);
      } catch (error) {
        console.error('[查重] 处理失败:', error);
        sendResponse({ duplicate: false, error: error.message });
      }
    });
    return true; // 表示会异步响应
  } else if (request.action === 'savePaperInfo') {
    // 保存论文信息到列表
    const paperInfo = request.paperInfo;
    console.log('[Background] 开始保存论文信息:', paperInfo);
    if (paperInfo) {
      // 在检查重复前，先从storage同步最新数据
      chrome.storage.local.get(['papers'], (result) => {
        try {
          const storedPapers = result.papers || [];
          // 同步到内存变量
          downloadedPapers = storedPapers;
          console.log('[保存论文] 从storage同步数据，当前记录数:', downloadedPapers.length);
          
          // 检查是否重复
          const duplicateCheck = checkPaperDuplicate(paperInfo, null);
          if (duplicateCheck.duplicate) {
            console.log('[保存论文] 检测到重复论文:', duplicateCheck.reason);
            sendResponse({ success: false, error: `论文已存在: ${duplicateCheck.reason}` });
            return;
          }
          
          downloadedPapers.push(paperInfo);
          chrome.storage.local.set({ papers: downloadedPapers }, () => {
            if (chrome.runtime.lastError) {
              console.error('[保存论文] 保存到storage失败:', chrome.runtime.lastError);
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            console.log('[论文助手] 论文信息已保存:', paperInfo);
            sendResponse({ success: true });
          });
        } catch (error) {
          console.error('[保存论文] 处理失败:', error);
          sendResponse({ success: false, error: error.message });
        }
      });
      return true; // 表示会异步响应
    } else {
      sendResponse({ success: false, error: '论文信息为空' });
      return true;
    }
  } else if (request.action === 'registerAllFilesForPaper') {
    // 一次性注册同一论文的所有文件（在检测到弹窗时调用）
    const allFileInfos = request.allFileInfos || [];
    const webMetadata = request.webMetadata;
    
    if (!allFileInfos || allFileInfos.length === 0) {
      sendResponse({ success: false, error: '没有文件信息' });
      return true;
    }
    
    console.log('[文件注册] 一次性注册', allFileInfos.length, '个文件');
    
    // 生成论文唯一标识
    const paperData = {
      title: webMetadata.title || '未知标题',
      firstAuthor: webMetadata.firstAuthor || '未知作者',
      author: webMetadata.firstAuthor || '未知作者',
      allAuthors: webMetadata.allAuthors || [],
      extractedDate: webMetadata.date || '',
      date: webMetadata.date || '',
      dates: webMetadata.dates || {},
      pageUrl: webMetadata.pageUrl || '',
      pageTitle: webMetadata.pageTitle || '',
      downloadTime: new Date().toISOString()
    };
    const paperKey = getPaperKey(paperData);
    
    // 获取下载目录并生成完整文件路径
    chrome.storage.local.get(['downloadDirectory'], (result) => {
      const downloadDir = result.downloadDirectory;
      
      if (!downloadDir) {
        console.warn('[文件注册] 未设置下载目录，无法生成文件路径');
        sendResponse({ success: false, error: '未设置下载目录' });
        return;
      }
      
      const separator = downloadDir.includes('\\') ? '\\' : '/';
      const filePaths = [];
      
      // 为每个文件创建待处理记录
      for (const fileInfo of allFileInfos) {
        const fileKey = request.fileKeys && request.fileKeys[allFileInfos.indexOf(fileInfo)] 
          ? request.fileKeys[allFileInfos.indexOf(fileInfo)]
          : `${fileInfo.type}:${fileInfo.name}`;
        
        // 直接使用文件名+下载目录生成完整路径
        const filePath = `${downloadDir}${separator}${fileInfo.name}`;
        filePaths.push(filePath);
        
        // 立即创建待处理记录（包含完整路径）
    const pendingRecord = {
      fileInfo: fileInfo,
      webMetadata: webMetadata,
      paperKey: paperKey,
      paperData: paperData,
      downloadTime: Date.now(),
          filePath: filePath, // 直接使用生成路径
          downloadId: null,
      jsonGenerated: false // 标记JSON是否已生成
    };
    
    pendingDownloads.set(fileKey, pendingRecord);
        console.log('[文件注册] ✓ 已记录文件:', {
      fileKey: fileKey,
      fileName: fileInfo.name,
      fileType: fileInfo.type,
          filePath: filePath
        });
      }
      
      // 立即生成包含所有文件的JSON
      generateSimpleVerificationJson(paperData, filePaths, webMetadata.pageUrl).catch(err => {
        console.error('[文件注册] 生成JSON失败:', err);
      });
      
      // 标记所有文件为已生成JSON
      for (const fileInfo of allFileInfos) {
        const fileKey = request.fileKeys && request.fileKeys[allFileInfos.indexOf(fileInfo)] 
          ? request.fileKeys[allFileInfos.indexOf(fileInfo)]
          : `${fileInfo.type}:${fileInfo.name}`;
        const record = pendingDownloads.get(fileKey);
        if (record) {
          record.jsonGenerated = true;
        }
      }
      
      console.log('[文件注册] ✓ 已生成包含所有文件的JSON，文件数:', filePaths.length);
      
      sendResponse({ success: true, fileCount: filePaths.length });
    });
    
    return true;
  } else if (request.action === 'monitorDownloadAndVerify') {
    // 立即记录文件信息和网页元数据，直接使用文件名+下载目录生成路径
    const fileInfo = request.fileInfo;
    const webMetadata = request.webMetadata;
    const fileKey = request.fileKey;
    
    console.log('[下载监听] 立即记录文件信息:', { fileKey, fileName: fileInfo.name, fileType: fileInfo.type });
    
    // 生成论文唯一标识
    const paperData = {
      title: webMetadata.title || '未知标题',
      firstAuthor: webMetadata.firstAuthor || '未知作者',
      author: webMetadata.firstAuthor || '未知作者',
      allAuthors: webMetadata.allAuthors || [],
      extractedDate: webMetadata.date || '',
      date: webMetadata.date || '',
      dates: webMetadata.dates || {},
      pageUrl: webMetadata.pageUrl || '',
      pageTitle: webMetadata.pageTitle || '',
      downloadTime: new Date().toISOString()
    };
    const paperKey = getPaperKey(paperData);
    
    // 获取下载目录并生成完整文件路径
    chrome.storage.local.get(['downloadDirectory'], (result) => {
      const downloadDir = result.downloadDirectory;
      
      if (!downloadDir) {
        console.warn('[下载监听] 未设置下载目录，无法生成文件路径');
        sendResponse({ success: false, error: '未设置下载目录' });
            return;
          }
          
      // 直接使用文件名+下载目录生成完整路径
      const separator = downloadDir.includes('\\') ? '\\' : '/';
      const filePath = `${downloadDir}${separator}${fileInfo.name}`;
      
      // 检查是否已经注册过（通过registerAllFilesForPaper）
      // 需要检查多种可能的fileKey格式
      let existingRecord = pendingDownloads.get(fileKey);
      
      // 如果直接匹配失败，尝试查找相同论文和文件名的记录
      if (!existingRecord || !existingRecord.jsonGenerated) {
        for (const [key, record] of pendingDownloads.entries()) {
          if (record.paperKey === paperKey && 
              record.fileInfo.name === fileInfo.name &&
              record.jsonGenerated) {
            existingRecord = record;
            // 更新fileKey映射，使用找到的key
            const foundKey = key;
            console.log('[下载监听] 找到已注册的文件记录，fileKey:', foundKey);
            break;
          }
        }
      }
      
      if (existingRecord && existingRecord.jsonGenerated) {
        // 如果已经注册过，只更新文件路径（如果不同）
        if (existingRecord.filePath !== filePath) {
          existingRecord.filePath = filePath;
          console.log('[下载监听] 更新文件路径:', filePath);
          
          // 更新JSON中的文件路径（使用去重后的文件列表）
          const paperFiles = [];
          const seenFiles = new Set(); // 用于去重
          for (const [key, record] of pendingDownloads.entries()) {
            if (record.paperKey === paperKey && record.filePath) {
              const fileKey = `${record.fileInfo.name}:${record.filePath}`;
              if (!seenFiles.has(fileKey)) {
                seenFiles.add(fileKey);
                paperFiles.push(record.filePath);
              }
            }
          }
          
          if (paperFiles.length > 0) {
            generateSimpleVerificationJson(paperData, paperFiles, webMetadata.pageUrl).catch(err => {
              console.error('[下载监听] 更新JSON失败:', err);
            });
          }
        } else {
          console.log('[下载监听] 文件已注册，路径未变化，跳过');
        }
        sendResponse({ success: true });
        return;
      }
      
      // 立即创建待处理记录（包含完整路径）
    const pendingRecord = {
      fileInfo: fileInfo,
      webMetadata: webMetadata,
      paperKey: paperKey,
      paperData: paperData,
      downloadTime: Date.now(),
        filePath: filePath, // 直接使用生成路径
        downloadId: null,
      jsonGenerated: false // 标记JSON是否已生成
    };
    
    pendingDownloads.set(fileKey, pendingRecord);
      console.log('[下载监听] ✓ 已记录待处理文件（路径已生成）:', {
                  fileKey: fileKey,
                  fileName: fileInfo.name,
      fileType: fileInfo.type,
        paperKey: paperKey,
        filePath: filePath
      });
      
      // 检查同一论文的所有文件是否都已记录，如果是则立即生成JSON
      checkAndGenerateJsonForPaper(paperKey, paperData, webMetadata.pageUrl);
    
    sendResponse({ success: true });
    });
    
    return true;
  } else if (request.action === 'getPendingDownloads') {
    // 获取所有待处理的下载记录
    const pendingList = Array.from(pendingDownloads.entries()).map(([fileKey, record]) => ({
      fileKey: fileKey,
      fileInfo: record.fileInfo,
      webMetadata: record.webMetadata,
      paperKey: record.paperKey,
      paperData: record.paperData,
      downloadTime: record.downloadTime,
      filePath: record.filePath,
      downloadId: record.downloadId
    }));
    sendResponse({ success: true, pendingDownloads: pendingList });
    return true;
  } else if (request.action === 'exportPendingDownload') {
    // 导出单个待处理下载的JSON
    const fileKey = request.fileKey;
    if (!fileKey || !pendingDownloads.has(fileKey)) {
      sendResponse({ success: false, error: '未找到待处理的下载记录' });
      return true;
    }
    
    const record = pendingDownloads.get(fileKey);
    const filePath = record.filePath || record.fileInfo.name || '待下载文件.pdf';
    
    // 生成JSON文件
    generateMetadataFile(
      record.paperData,
      filePath,
      record.fileInfo.type || '未知类型',
      record.fileInfo.name || filePath
    ).then(() => {
      sendResponse({ success: true, message: 'JSON文件已生成' });
    }).catch(err => {
      console.error('[导出] JSON文件生成失败:', err);
      sendResponse({ success: false, error: err.message });
    });
    
    return true;
  } else if (request.action === 'getPendingFilesForPaper') {
    // 获取指定论文的所有待处理文件信息（用于导出JSON）
    const paperKey = request.paperKey;
    if (!paperKey) {
      sendResponse({ success: false, error: '缺少paperKey参数' });
      return true;
    }
    
    // 查找所有匹配该论文的待处理文件
    const matchingFiles = [];
    for (const [fileKey, record] of pendingDownloads.entries()) {
      if (record.paperKey === paperKey) {
        matchingFiles.push({
          fileKey: fileKey,
          fileInfo: record.fileInfo,
          fileName: record.fileInfo.name,
          fileType: record.fileInfo.type || '未知类型',
          downloadTime: record.downloadTime
        });
      }
    }
    
    sendResponse({ success: true, files: matchingFiles });
    return true;
  } else if (request.action === 'performOcrOnImage') {
    // 使用OCR API识别图片（可选：二段式 OCR -> LLM 结构化）
    (async () => {
      try {
        console.log('[OCR] 开始OCR识别...');
        const imageData = request.imageData; // base64图片数据或dataURL
        if (!imageData) {
          throw new Error('缺少imageData');
        }

        // 统一为dataURL
        let imageDataUrl = imageData;
        if (!imageDataUrl.startsWith('data:')) {
          imageDataUrl = `data:image/jpeg;base64,${imageData}`;
        }

        // 第一段：OCR输出纯文本
        const ocrText = await ocrExtractTextFromImageDataUrl(imageDataUrl);
        console.log('[OCR] ✓ OCR识别完成，文本长度:', ocrText.length);
        console.log('[OCR] ========== OCR原始文本输出 ==========');
        console.log('[OCR]', ocrText);
        console.log('[OCR] ========== OCR原始文本结束 ==========');

        // 可选第二段：LLM结构化
        const returnStructured = !!request.returnStructured;
        if (!returnStructured) {
          sendResponse({ success: true, text: ocrText });
          return;
        }

        console.log('[LLM] 开始从OCR文本提取结构化信息...');
        const llmResult = await structureAcademicInfoFromOcrText(ocrText);
        console.log('[LLM] ✓ 结构化完成，是否结构化:', llmResult.isStructured, '解析错误:', llmResult.parseError || '无');
        console.log('[LLM] ========== LLM原始输出 ==========');
        console.log('[LLM]', llmResult.rawText);
        console.log('[LLM] ========== LLM原始输出结束 ==========');
        console.log('[LLM] ========== LLM结构化结果 ==========');
        console.log('[LLM]', JSON.stringify(llmResult.structured, null, 2));
        console.log('[LLM] ========== LLM结构化结果结束 ==========');

        sendResponse({
          success: true,
          text: ocrText,
          llmRawText: llmResult.rawText,
          structured: llmResult.structured,
          llmParseError: llmResult.parseError,
          llmTruncatedInput: llmResult.truncatedInput
        });
      } catch (error) {
        console.error('[OCR] OCR识别失败:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 异步响应
  } else if (request.action === 'getDownloadedFileForVerification') {
    // 获取已下载的文件信息用于验证
    const fileKey = request.fileKey;
    const fileName = request.fileName;
    
    if (fileKey && window.pendingVerifications && window.pendingVerifications.has(fileKey)) {
      const verification = window.pendingVerifications.get(fileKey);
      sendResponse({ 
        success: true, 
        download: verification.download,
        fileInfo: verification.fileInfo,
        webMetadata: verification.webMetadata
      });
      return true;
    }
    
    // 如果没找到，尝试根据文件名查找
    if (fileName) {
      chrome.downloads.search({
        filenameRegex: fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        orderBy: ['-startTime'],
        limit: 5
      }, (downloads) => {
        if (downloads && downloads.length > 0) {
          const matchingDownload = downloads.find(d => 
            d.filename && d.filename.includes(fileName.replace(/\s+/g, ''))
          ) || downloads[0];
          
          if (matchingDownload) {
            sendResponse({ 
              success: true, 
              download: matchingDownload 
            });
          } else {
            sendResponse({ success: false, error: '未找到下载的文件' });
          }
        } else {
          sendResponse({ success: false, error: '未找到下载的文件' });
        }
      });
      return true;
    }
    
    sendResponse({ success: false, error: '未找到下载的文件' });
    return true;
  } else if (request.action === 'downloadAndVerify') {
    // 下载并验证文件
    const url = request.url;
    const fileInfo = request.fileInfo;
    const webMetadata = request.webMetadata;
    
    // 判断文件类型
    const isPdf = fileInfo.isPdf || url.toLowerCase().endsWith('.pdf');
    const isImage = fileInfo.isImage || /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(url);
    
    // 下载文件
    chrome.downloads.download({
      url: url,
      conflictAction: 'uniquify',  // PDF文件使用uniquify，避免覆盖
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[下载验证] 下载失败:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      
      // 监听下载完成
      const listener = (delta) => {
        if (delta.id === downloadId && delta.state && delta.state.current === 'complete') {
          chrome.downloads.onChanged.removeListener(listener);
          
          chrome.downloads.search({ id: downloadId }, (results) => {
            if (results && results[0]) {
              verifyDownloadedFile(results[0], fileInfo, webMetadata);
            }
          });
        } else if (delta.id === downloadId && delta.state && delta.state.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(listener);
          console.error('[下载验证] 下载被中断');
        }
      };
      
      chrome.downloads.onChanged.addListener(listener);
    });
    
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'downloadPdf') {
    handlePdfDownload(
      request.url, 
      request.pageUrl, 
      request.pageTitle,
      request.pageMetadata  // 传递页面元数据
    );
    sendResponse({ success: true });
  } else if (request.action === 'ocrImage') {
    // OCR识别图像
    handleImageOcr(
      request.imageUrl,
      request.pageUrl,
      request.pageTitle
    ).then(result => {
      sendResponse({ success: true, result: result });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // 异步响应
  } else if (request.action === 'verifyPaper') {
    // 验证论文：执行完整的验证流程
    let pdfUrl = request.pdfUrl;
    const fileInfo = request.fileInfo || {};
    
    // 如果pdfUrl是blob URL，直接使用（来自拖放功能）
    if (pdfUrl && pdfUrl.startsWith('blob:')) {
      console.log('[验证模块] 检测到blob URL，直接使用:', pdfUrl);
      handlePaperVerification(pdfUrl, request.pageUrl, request.webMetadata, fileInfo).then(result => {
        sendResponse({ success: true, result: result });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true; // 异步响应
    }
    
    // 如果pdfUrl是文件路径，尝试从下载记录中获取实际URL
    if (fileInfo.filePath && !pdfUrl) {
      // 尝试从downloadId获取文件信息
      if (fileInfo.downloadId) {
        chrome.downloads.search({ id: fileInfo.downloadId }, (downloads) => {
          if (downloads && downloads.length > 0) {
            const download = downloads[0];
            // 使用下载的URL（如果可用且不是blob URL）
            if (download.url && !download.url.startsWith('blob:') && 
                (download.url.toLowerCase().endsWith('.pdf') || download.url.includes('/pdf/'))) {
              pdfUrl = download.url;
            } else if (download.filename) {
              // 如果URL不可用，使用文件路径（需要通过文件读取）
              pdfUrl = download.filename;
            }
            
            handlePaperVerification(pdfUrl, request.pageUrl, request.webMetadata, fileInfo).then(result => {
              sendResponse({ success: true, result: result });
            }).catch(error => {
              sendResponse({ success: false, error: error.message });
            });
          } else {
            sendResponse({ success: false, error: '未找到下载的文件' });
          }
        });
        return true;
      }
      
      // 如果没有downloadId，尝试根据文件名查找
      if (fileInfo.name) {
        chrome.downloads.search({
          filenameRegex: fileInfo.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          orderBy: ['-startTime'],
          limit: 5
        }, (downloads) => {
          if (downloads && downloads.length > 0) {
            const matchingDownload = downloads.find(d => 
              d.filename && d.filename.includes(fileInfo.name.replace(/\s+/g, ''))
            ) || downloads[0];
            
            if (matchingDownload) {
              if (matchingDownload.url && !matchingDownload.url.startsWith('blob:') && 
                  (matchingDownload.url.toLowerCase().endsWith('.pdf') || matchingDownload.url.includes('/pdf/'))) {
                pdfUrl = matchingDownload.url;
              } else if (matchingDownload.filename) {
                pdfUrl = matchingDownload.filename;
              }
            }
          }
          
          handlePaperVerification(pdfUrl, request.pageUrl, request.webMetadata, fileInfo).then(result => {
            sendResponse({ success: true, result: result });
          }).catch(error => {
            sendResponse({ success: false, error: error.message });
          });
        });
        return true;
      }
    }
    
    // 正常验证流程
    handlePaperVerification(pdfUrl, request.pageUrl, request.webMetadata, fileInfo).then(result => {
      sendResponse({ success: true, result: result });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // 异步响应
  } else if (request.action === 'quickProcessPaper') {
    // 一键处理论文：自动下载、解析、OCR、验证、重命名
    handleQuickProcess(
      request.pdfUrl,
      request.pageUrl,
      request.pageTitle,
      request.pageMetadata
    ).then(result => {
      sendResponse({ success: true, result: result });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // 异步响应
  } else if (request.action === 'extractListPapers') {
    // 从列表页面提取论文
    chrome.tabs.sendMessage(sender.tab.id, { action: 'extractListPapers' }, (response) => {
      sendResponse(response);
    });
    return true;
  } else if (request.action === 'verifyPaperData') {
    // 验证手动上传的PDF数据（从ArrayBuffer解析的）
    // 注意：异步处理必须返回true，并在完成后调用sendResponse
    let responseSent = false;
    const safeSendResponse = (data) => {
      if (!responseSent) {
        responseSent = true;
        try {
          sendResponse(data);
        } catch (e) {
          console.error('[验证] 发送响应失败（消息通道可能已关闭）:', e);
        }
      } else {
        console.warn('[验证] 尝试重复发送响应，已忽略');
      }
    };
    
    (async () => {
      try {
        console.log('[Background] 收到verifyPaperData请求，开始处理...');
        const startTime = Date.now();
        const pdfData = request.pdfData;
        const webMetadata = request.webMetadata;
        
        if (!pdfData || !webMetadata) {
          console.error('[Background] verifyPaperData缺少必要参数');
          safeSendResponse({ success: false, error: '缺少必要参数' });
          return;
        }
        
        console.log('[Background] 参数验证通过，开始提取日期信息...');
        // 提取日期信息
        const webDate = webMetadata.date || '';
        let webDates = null;
        if (webDate) {
          try {
            const parsedDate = new Date(webDate);
            if (!isNaN(parsedDate.getTime())) {
              const year = parsedDate.getFullYear();
              const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
              const day = String(parsedDate.getDate()).padStart(2, '0');
              webDates = {
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
        
        console.log('[Background] 日期信息提取完成，开始执行匹配验证...');
        // 执行匹配验证
        const matchResult = matchVerification(
          {
            firstAuthor: webMetadata.firstAuthor || '',
            allAuthors: webMetadata.authors || webMetadata.allAuthors || [],
            date: webDate,
            dates: webDates || webMetadata.dates || null,
            title: webMetadata.title || ''
          },
          pdfData || { firstAuthor: '', allAuthors: [], date: '', dates: null, title: '' },
          { firstAuthor: '', allAuthors: [], date: '', dates: null, title: '' } // OCR数据为空（因为已经解析了PDF）
        );
        
        const elapsedTime = Date.now() - startTime;
        console.log(`[Background] 匹配验证完成，耗时: ${elapsedTime}ms，准备发送响应...`);
        
        safeSendResponse({ 
          success: true, 
          result: {
            matchResult: matchResult,
            pdfData: pdfData
          }
        });
        console.log('[Background] verifyPaperData响应已发送');
      } catch (error) {
        console.error('[验证] verifyPaperData失败:', error);
        console.error('[验证] 错误堆栈:', error.stack);
        safeSendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 异步响应
  }
  return true;
});

// 处理API响应数据
async function processApiResponseData(apiData) {
  try {
    console.log('[API处理] 开始处理API响应数据');
    
    if (!apiData || !apiData.data) {
      throw new Error('API响应数据格式不正确');
    }
    
    const data = apiData.data;
    const result = {
      opusName: data.opusName || '',
      conferenceName: data.conferenceName || '',
      conferenceDate: data.conferenceDateStr || data.conferenceDate || '',
      conferenceEndDate: data.conferenceEndDateStr || data.conferenceEndDate || '',
      universityName: data.universityName || '',
      evidenceFiles: [],
      metadata: {
        title: data.opusName || '',
        authors: [data.opusName || ''],
        date: data.conferenceDateStr || data.conferenceDateStr || '',
        firstAuthor: data.opusName || ''
      }
    };
    
    // 解析evidence字段（JSON字符串）
    if (data.evidence) {
      try {
        const evidenceArray = JSON.parse(data.evidence);
        if (Array.isArray(evidenceArray)) {
          result.evidenceFiles = evidenceArray.map(file => ({
            fileName: file.fileName || '',
            filePath: file.filePath || '',
            url: file.path || '',
            fileSize: file.fileSize || 0,
            fileSuffix: file.fileSuffix || ''
          }));
        }
      } catch (e) {
        console.error('[API处理] 解析evidence失败:', e);
      }
    }
    
    console.log('[API处理] 处理完成:', result);
    return result;
  } catch (error) {
    console.error('[API处理] 处理失败:', error);
    throw error;
  }
}

// 处理PDF下载
async function handlePdfDownload(pdfUrl, pageUrl, pageTitle, pageMetadata = null) {
  try {
    console.log('[论文助手] 开始处理PDF:', pdfUrl);
    
    // 第一阶段：尝试从URL直接解析PDF元数据
    let paperInfo = null;
    
    try {
      await loadPdfJs();
      if (pdfjsLib) {
        paperInfo = await parsePdfFromUrl(pdfUrl);
        console.log('[论文助手] PDF元数据提取成功:', paperInfo);
      }
    } catch (error) {
      console.log('[论文助手] 从URL解析失败，使用页面元数据或基础模式:', error);
    }
    
    // 处理IEEE Xplore的stamp.jsp URL（需要转换为实际PDF URL）
    if (pdfUrl.includes('stamp/stamp.jsp')) {
      // IEEE stamp页面通常会在页面中嵌入PDF，我们需要找到实际的PDF URL
      // 或者直接使用stamp.jsp URL，因为pdf.js可能能够处理
      console.log('[论文助手] 检测到IEEE stamp.jsp URL');
    }
    
    // 如果PDF解析失败，尝试使用从页面提取的元数据（arXiv或IEEE）
    if (!paperInfo || !paperInfo.title || paperInfo.title === '待提取') {
      if (pageMetadata) {
        console.log('[论文助手] 使用从页面提取的元数据:', pageMetadata);
        // 从页面元数据提取日期信息
        const pageDate = pageMetadata.date || '';
        const allDates = extractAllDates(pageDate);
        
        paperInfo = {
          title: pageMetadata.title || '待提取',
          author: pageMetadata.authors ? pageMetadata.authors.join(', ') : '待提取',
          keywords: [],
          extractedDate: pageDate || '待提取', // 兼容旧字段
          firstAuthor: pageMetadata.firstAuthor || (pageMetadata.authors && pageMetadata.authors[0]) || '待提取',
          allAuthors: pageMetadata.authors || [],
          hasEqualContribution: false,
          equalContributionAuthors: [],
          firstAuthorHasEqual: false,
          dates: {
            received: allDates.received,
            accepted: allDates.accepted,
            published: allDates.published,
            other: allDates.other
          },
          first500Chars: '',
          arxivId: pageMetadata.arxivId || '',
          arnumber: pageMetadata.arnumber || ''
        };
      } else {
        // 如果都没有，使用基础信息
        paperInfo = {
          title: '待提取',
          author: '待提取',
          keywords: [],
          extractedDate: '待提取', // 兼容旧字段
          firstAuthor: '待提取',
          allAuthors: [],
          hasEqualContribution: false,
          equalContributionAuthors: [],
          firstAuthorHasEqual: false,
          dates: {
            received: null,
            accepted: null,
            published: null,
            other: []
          },
          first500Chars: ''
        };
      }
    } else {
      // 如果PDF解析成功，但页面元数据有更好的信息，可以合并
      if (pageMetadata && pageMetadata.title && (!paperInfo.title || paperInfo.title === '待提取')) {
        paperInfo.title = pageMetadata.title;
      }
      if (pageMetadata && pageMetadata.firstAuthor && (!paperInfo.firstAuthor || paperInfo.firstAuthor === '待提取')) {
        paperInfo.firstAuthor = pageMetadata.firstAuthor;
      }
      if (pageMetadata && pageMetadata.authors && (!paperInfo.allAuthors || paperInfo.allAuthors.length === 0)) {
        paperInfo.allAuthors = pageMetadata.authors;
      }
      // 合并日期信息（页面元数据优先）
      if (pageMetadata && pageMetadata.date) {
        const pageDates = extractAllDates(pageMetadata.date);
        if (pageDates.received && !paperInfo.dates.received) {
          paperInfo.dates.received = pageDates.received;
        }
        if (pageDates.accepted && !paperInfo.dates.accepted) {
          paperInfo.dates.accepted = pageDates.accepted;
        }
        if (pageDates.published && !paperInfo.dates.published) {
          paperInfo.dates.published = pageDates.published;
        }
        // 更新兼容字段
        if (!paperInfo.extractedDate || paperInfo.extractedDate === '待提取') {
          paperInfo.extractedDate = pageMetadata.date;
        }
      }
      if (pageMetadata && pageMetadata.arnumber) {
        paperInfo.arnumber = pageMetadata.arnumber;
      }
    }
    
    // 下载并重命名文件
    downloadAndRename(pdfUrl, paperInfo, pageUrl, pageTitle);
    
  } catch (error) {
    console.error('[论文助手] 处理失败:', error);
    // 即使失败也尝试下载
    downloadPdfFile(pdfUrl, pageUrl, pageTitle);
  }
}

// 从URL解析PDF（第二阶段：提取前500字符和日期）
async function parsePdfFromUrl(url) {
  if (!pdfjsLib) {
    throw new Error('pdf.js未加载');
  }
  
  try {
    const loadingTask = pdfjsLib.getDocument({
      url: url,
      withCredentials: false,
      httpHeaders: {}
    });
    const pdf = await loadingTask.promise;
    
    // 第一阶段：提取元数据
    const metadata = await pdf.getMetadata();
    const info = metadata.info || {};
    
    console.log('[论文助手] 提取的元数据:', {
      title: info.Title,
      author: info.Author,
      keywords: info.Keywords
    });
    
    // 第二阶段：提取前500字符
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 3); // 最多读取前3页
    
    console.log('[PDF解析] 开始提取文本，读取前', maxPages, '页');
    for (let i = 1; i <= maxPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + ' ';
        console.log('[PDF解析] 第', i, '页文本长度:', pageText.length, '，累计:', fullText.length);
        
        if (fullText.length >= 500) {
          break;
        }
      } catch (error) {
        console.warn('[PDF解析] 读取第', i, '页失败:', error);
        // 继续读取下一页
      }
    }
    
    const first500Chars = fullText.substring(0, 500);
    console.log('[PDF解析] 提取的文本长度:', fullText.length, '，前500字符预览:', first500Chars.substring(0, 100));
    
    // 提取所有日期信息（Received, Accepted, Published, 其他）
    const allDates = extractAllDates(first500Chars + ' ' + (info.Title || ''));
    
    // 提取作者信息（包括equal contribution和验证）
    const authorInfo = extractAllAuthors(first500Chars, info);
    const firstAuthor = authorInfo.firstAuthor || extractFirstAuthor(first500Chars, info) || 
                      (info.Author ? info.Author.split(/[,;]/)[0].trim() : '');
    
    return {
      title: info.Title || '',
      author: info.Author || '',
      keywords: info.Keywords ? info.Keywords.split(/[,;]/).map(k => k.trim()) : [],
      extractedDate: allDates.received || allDates.accepted || allDates.published || null, // 兼容旧字段
      firstAuthor: firstAuthor,
      allAuthors: authorInfo.authors || [],
      hasEqualContribution: authorInfo.hasEqualContribution || false,
      equalContributionAuthors: authorInfo.equalContributionAuthors || [],
      firstAuthorHasEqual: authorInfo.firstAuthorHasEqual || false,
      // 所有日期信息
      dates: {
        received: allDates.received,
        accepted: allDates.accepted,
        published: allDates.published,
        other: allDates.other
      },
      first500Chars: first500Chars,
      creationDate: info.CreationDate || '',
      modDate: info.ModDate || ''
    };
    
  } catch (error) {
    console.error('[论文助手] 解析PDF失败:', error);
    console.error('[论文助手] 错误详情:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    
    // 如果是CORS错误，提供更详细的提示
    if (error.message && (error.message.includes('CORS') || error.message.includes('cross-origin') || error.message.includes('NetworkError'))) {
      throw new Error('PDF解析失败：CORS跨域问题。PDF URL可能无法从background script直接访问。');
    }
    
    // 如果是加载错误
    if (error.name === 'InvalidPDFException' || error.message.includes('Invalid PDF')) {
      throw new Error('PDF解析失败：无效的PDF文件或文件损坏。');
    }
    
    throw error;
  }
}

// 从文本中提取日期（使用关键词定位）- 保留用于兼容性
function extractDateFromText(text) {
  const allDates = extractAllDates(text);
  // 返回第一个找到的日期（优先Received，然后Accepted，然后Published）
  return allDates.received || allDates.accepted || allDates.published || null;
}

// 提取所有类型的日期（Received, Accepted, Published, 其他）
function extractAllDates(text) {
  const result = {
    received: null,
    revised: null,
    accepted: null,
    published: null,
    other: []
  };
  
  // 日期关键词（添加revised form支持）
  const dateKeywords = {
    received: [
      'Received', 'Received date', 'Received:', 'Submitted', 
      'Submitted on', 'Submission date'
    ],
    revised: [
      'Received in revised form', 'in revised form', 'revised form', 
      'Revised', 'Revised:', 'Received in revised'
    ],
    accepted: [
      'Accepted', 'Accepted date', 'Accepted:', 'Acceptance date'
    ],
    published: [
      'Published', 'Published date', 'Published:', 
      'Publication date', 'Date of publication', 'Available online', 'Available online:',
      'Date:', 'Date' // 添加通用的Date关键词
    ]
  };
  
  // 日期格式（按优先级排序，更具体的格式优先）
  const datePatterns = [
    /(\d{1,2} [A-Z][a-z]+ \d{4})/,    // DD Month YYYY (如: 6 April 2025) - 优先匹配这个格式
    /([A-Z][a-z]+ \d{1,2}, \d{4})/,   // Month DD, YYYY (如: December 25, 2025)
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/,  // YYYY-MM-DD
    /(\d{1,2}[-/]\d{1,2}[-/]\d{4})/,  // MM-DD-YYYY
    /(\d{4})/                          // YYYY
  ];
  
  // 先提取Revised日期（必须在Received之前，因为"Received in revised form"包含"Received"）
  for (const keyword of dateKeywords.revised) {
    // 使用不区分大小写的搜索
    const keywordRegex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const keywordMatch = text.match(keywordRegex);
    if (keywordMatch) {
      const keywordIndex = keywordMatch.index;
      const context = text.substring(keywordIndex, keywordIndex + 200).replace(/\s+/g, ' ');
      console.log('[论文助手] 检查Revised日期，关键词:', keyword, '上下文:', context.substring(0, 100));
      for (const pattern of datePatterns) {
        const match = context.match(pattern);
        if (match) {
          result.revised = match[1];
          console.log('[论文助手] 找到Revised日期:', match[1], '(关键词:', keyword + ')');
          break;
        }
      }
      if (result.revised) break;
    }
  }
  
  // 提取Received日期（排除已经被Revised匹配的部分）
  for (const keyword of dateKeywords.received) {
    // 使用不区分大小写的搜索
    const keywordRegex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    // 查找所有匹配位置
    let match;
    while ((match = keywordRegex.exec(text)) !== null) {
      const keywordIndex = match.index;
      // 检查这个位置是否属于"Received in revised form"（如果是，跳过）
      const checkRevised = text.substring(keywordIndex, keywordIndex + 30).toLowerCase();
      if (checkRevised.includes('received in revised form') || checkRevised.includes('in revised form')) {
        continue; // 跳过，因为这是Revised日期的一部分
      }
      
      // 提取关键词后的上下文（处理可能的多余空格）
      const context = text.substring(keywordIndex, keywordIndex + 200).replace(/\s+/g, ' ');
      console.log('[论文助手] 检查Received日期，关键词:', keyword, '上下文:', context.substring(0, 100));
      for (const pattern of datePatterns) {
        const dateMatch = context.match(pattern);
        if (dateMatch) {
          result.received = dateMatch[1];
          console.log('[论文助手] 找到Received日期:', dateMatch[1], '(关键词:', keyword + ')');
          break;
        }
      }
      if (result.received) break;
    }
    if (result.received) break;
  }
  
  // 提取Accepted日期
  for (const keyword of dateKeywords.accepted) {
    // 使用不区分大小写的搜索
    const keywordRegex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const keywordMatch = text.match(keywordRegex);
    if (keywordMatch) {
      const keywordIndex = keywordMatch.index;
      const context = text.substring(keywordIndex, keywordIndex + 200).replace(/\s+/g, ' ');
      console.log('[论文助手] 检查Accepted日期，关键词:', keyword, '上下文:', context.substring(0, 100));
      for (const pattern of datePatterns) {
        const match = context.match(pattern);
        if (match) {
          result.accepted = match[1];
          console.log('[论文助手] 找到Accepted日期:', match[1], '(关键词:', keyword + ')');
          break;
        }
      }
      if (result.accepted) break;
    }
  }
  
  // 提取Published日期
  for (const keyword of dateKeywords.published) {
    // 使用不区分大小写的搜索
    const keywordRegex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const keywordMatch = text.match(keywordRegex);
    if (keywordMatch) {
      const keywordIndex = keywordMatch.index;
      // 提取关键词后的上下文（处理可能的多余空格）
      const context = text.substring(keywordIndex, keywordIndex + 200).replace(/\s+/g, ' ');
      console.log('[论文助手] 检查Published日期，关键词:', keyword, '上下文:', context.substring(0, 100));
      for (const pattern of datePatterns) {
        const match = context.match(pattern);
        if (match) {
          result.published = match[1];
          console.log('[论文助手] 找到Published日期:', match[1], '(关键词:', keyword + ')');
          break;
        }
      }
      if (result.published) break;
    }
  }
  
  // 提取其他日期
  const allDates = [];
  for (const pattern of datePatterns) {
    const matches = text.matchAll(new RegExp(pattern.source, 'g'));
    for (const match of matches) {
      const date = match[1];
      if (date !== result.received && date !== result.revised && date !== result.accepted && date !== result.published) {
        // 检查年份是否合理
        const yearMatch = date.match(/(\d{4})/);
        if (yearMatch) {
          const year = parseInt(yearMatch[1]);
          if (year >= 1900 && year <= 2100) {
            allDates.push(date);
          }
        }
      }
    }
  }
  
  // 去重并限制数量
  result.other = [...new Set(allDates)].slice(0, 5);
  
  // 如果revised日期存在，也添加到other中（如果还没有）
  if (result.revised && !result.other.includes(result.revised)) {
    result.other.push(result.revised);
  }
  
  return result;
}

// 提取第一作者和所有作者（包括equal contribution标记）
function extractFirstAuthor(text, metadata) {
  // 优先从元数据获取，但需要验证不是品牌名或计算机用户名
  if (metadata.Author) {
    const authors = metadata.Author.split(/[,;]/);
    const firstAuthor = authors[0].trim();
    // 检查是否是品牌名或计算机用户名
    const isBrandName = firstAuthor.match(/^(compaq|hp|dell|lenovo|acer|microsoft|apple|samsung|huawei|xiaomi|computer|pc|desktop|laptop|server|system|device|machine|fields|admin|user|asus|administrator|test)$/i);
    const isComputerUsername = firstAuthor.length < 5 || 
                                (firstAuthor === firstAuthor.toLowerCase() && !firstAuthor.includes(' '));
    if (!isBrandName && !isComputerUsername) {
      return firstAuthor;
    }
    console.log('[论文助手] 元数据作者看起来像品牌名或计算机用户名，跳过:', firstAuthor);
  }
  
  // 检查是否有equal contribution标记
  const equalContributionPatterns = [
    /contributed equally/i,
    /equal contribution/i,
    /equally contributed/i,
    /contributed\.\s*equally/i,
    /\(contributed equally\)/i,
    /\(equal contribution\)/i
  ];
  
  let hasEqualContribution = false;
  for (const pattern of equalContributionPatterns) {
    if (pattern.test(text)) {
      hasEqualContribution = true;
      console.log('[论文助手] 检测到equal contribution标记');
      break;
    }
  }
  
  // 从文本中提取作者
  const authorPatterns = [
    /^([A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+)/,
    /^([A-Z][a-z]+, [A-Z]\.)/,
    /Author[s]?:\s*([^\n]+)/i,
    /By:\s*([^\n]+)/i
  ];
  
  for (const pattern of authorPatterns) {
    const match = text.match(pattern);
    if (match) {
      let author = match[1].trim();
      // 清理equal contribution标记
      author = author.replace(/\(contributed equally\)/gi, '').trim();
      author = author.replace(/\(equal contribution\)/gi, '').trim();
      
      // 验证作者名是否合理（排除品牌名、计算机用户名、Open Access等无效内容）
      const isBrandName = author.match(/^(compaq|hp|dell|lenovo|acer|microsoft|apple|samsung|huawei|xiaomi|computer|pc|desktop|laptop|server|system|device|machine|fields|admin|user|asus|administrator|test|open\s+access)$/i);
      const isInvalidAuthor = /Open\s+Access|Creative\s+Commons|©\s*The\s*Author|This\s+article|Attribution|NoDerivatives|RESEARCH/i.test(author);
      const isComputerUsername = author.length < 5 || 
                                  (author === author.toLowerCase() && !author.includes(' '));
      const hasValidNameFormat = author.match(/[A-Z][a-z]+/) && author.length >= 5;
      
      if (!isBrandName && !isInvalidAuthor && !isComputerUsername && hasValidNameFormat) {
        return author;
      } else {
        console.log('[论文助手] 提取的作者看起来无效，跳过:', author, {isBrandName, isInvalidAuthor, isComputerUsername, hasValidNameFormat});
      }
    }
  }
  
  return null;
}

// 提取所有作者（包括equal contribution信息，并验证第一作者是否在标记中）
function extractAllAuthors(text, metadata) {
  const authors = [];
  let hasEqualContribution = false;
  const equalContributionAuthors = []; // 记录哪些作者有equal contribution标记
  
  // 检查equal contribution标记，并提取相关作者
  const equalContributionPatterns = [
    /contributed equally/i,
    /equal contribution/i,
    /equally contributed/i,
    /contributed\.\s*equally/i,
    /\(contributed equally\)/i,
    /\(equal contribution\)/i
  ];
  
  // 特殊标记（†, ‡等）
  const specialMarkers = [/†/, /‡/, /\*/, /#/];
  
  // 首先检查是否有equal contribution关键词
  let foundKeyword = false;
  let keywordContext = '';
  for (const pattern of equalContributionPatterns) {
    const match = text.match(pattern);
    if (match) {
      foundKeyword = true;
      // 提取标记前后200字符的上下文
      const start = Math.max(0, match.index - 200);
      const end = Math.min(text.length, match.index + match[0].length + 200);
      keywordContext = text.substring(start, end);
      console.log('[论文助手] 检测到equal contribution标记:', pattern);
      break;
    }
  }
  
  // 如果有equal contribution关键词，尝试提取相关作者
  if (foundKeyword && keywordContext) {
    // 在上下文中查找作者名
    const authorNamePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[†‡\*#]?/g;
    const contextAuthors = keywordContext.match(authorNamePattern) || [];
    
    // 检查标记前后的作者
    const lines = keywordContext.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/contributed equally|equal contribution/i.test(lines[i])) {
        // 检查前后几行的作者
        for (let j = Math.max(0, i - 2); j < Math.min(lines.length, i + 3); j++) {
          const lineAuthors = lines[j].match(authorNamePattern) || [];
          for (const author of lineAuthors) {
            const cleanAuthor = author.trim().replace(/[†‡\*#]/g, '').trim();
            if (cleanAuthor.split(/\s+/).length >= 2) { // 至少包含名和姓
              equalContributionAuthors.push(cleanAuthor);
            }
          }
        }
      }
    }
    
    if (equalContributionAuthors.length > 0) {
      // 去重
      const uniqueECAuthors = [...new Set(equalContributionAuthors)];
      equalContributionAuthors.length = 0;
      equalContributionAuthors.push(...uniqueECAuthors);
      hasEqualContribution = true;
      console.log('[论文助手] 找到可能有equal contribution的作者:', equalContributionAuthors.slice(0, 5).join(', '));
    }
  }
  
  // 检查特殊标记（†, ‡等）
  for (const markerPattern of specialMarkers) {
    // 查找标记后的说明文字
    const markerWithNote = new RegExp(
      markerPattern.source + '\\s*(?:contributed\\s+equally|equal\\s+contribution|These\\s+authors\\s+contributed\\s+equally)',
      'i'
    );
    const match = text.match(markerWithNote);
    if (match) {
      hasEqualContribution = true;
      console.log('[论文助手] 检测到特殊标记:', markerPattern);
      // 查找标记前的作者
      const markerPos = match.index;
      const beforeText = text.substring(Math.max(0, markerPos - 300), markerPos);
      // 提取标记前的作者名
      const authorsWithMarker = beforeText.match(
        new RegExp('([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*)\\s*' + markerPattern.source, 'g')
      );
      if (authorsWithMarker) {
        const extracted = authorsWithMarker.map(m => {
          const authorMatch = m.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
          return authorMatch ? authorMatch[1] : null;
        }).filter(a => a);
        equalContributionAuthors.push(...extracted);
        console.log('[论文助手] 找到带标记的作者:', extracted.join(', '));
      }
    }
  }
  
  // 从元数据提取（但需要验证不是品牌名、计算机用户名或Open Access等无效内容）
  if (metadata.Author) {
    const metaAuthors = metadata.Author.split(/[,;]/).map(a => a.trim()).filter(a => {
      if (!a) return false;
      const isBrandName = a.match(/^(compaq|hp|dell|lenovo|acer|microsoft|apple|samsung|huawei|xiaomi|computer|pc|desktop|laptop|server|system|device|machine|fields|admin|user|asus|administrator|test|open\s+access)$/i);
      const isInvalidAuthor = /Open\s+Access|Creative\s+Commons|©\s*The\s*Author|This\s+article|Attribution|NoDerivatives|RESEARCH/i.test(a);
      const isComputerUsername = a.length < 5 || 
                                  (a === a.toLowerCase() && !a.includes(' '));
      const hasValidNameFormat = a.match(/[A-Z][a-z]+/) && a.length >= 5;
      return !isBrandName && !isInvalidAuthor && !isComputerUsername && hasValidNameFormat;
    });
    if (metaAuthors.length > 0) {
      authors.push(...metaAuthors);
    } else {
      console.log('[论文助手] 元数据作者都被过滤掉（可能是品牌名或计算机用户名）');
    }
  }
  
  // 从文本中提取作者列表
  const authorListPatterns = [
    /Author[s]?:\s*([^\n]+(?:\n[^\n]+)*?)(?:\n\n|\nAbstract|$)/i,
    /By:\s*([^\n]+(?:\n[^\n]+)*?)(?:\n\n|\nAbstract|$)/i,
    /^([A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+(?:\s*[,;]\s*[A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+)*)/m
  ];
  
  for (const pattern of authorListPatterns) {
    const match = text.match(pattern);
    if (match) {
      const authorText = match[1];
      // 分割作者
      const extractedAuthors = authorText
        .split(/[,;]\s*|\n/)
        .map(a => {
          // 清理标记
          a = a.replace(/\(contributed equally\)/gi, '').trim();
          a = a.replace(/\(equal contribution\)/gi, '').trim();
          a = a.replace(/†/g, '').trim();
          a = a.replace(/‡/g, '').trim();
          return a;
        })
        .filter(a => a && a.length > 2);
      
      // 过滤掉品牌名、无效作者和Open Access等
      const validAuthors = extractedAuthors.filter(a => {
        const isBrandName = a.match(/^(compaq|hp|dell|lenovo|acer|microsoft|apple|samsung|huawei|xiaomi|computer|pc|desktop|laptop|server|system|device|machine|fields|admin|user|asus|administrator|test|open\s+access)$/i);
        const isInvalidAuthor = /Open\s+Access|Creative\s+Commons|©\s*The\s*Author|This\s+article|Attribution|NoDerivatives|RESEARCH/i.test(a);
        const isComputerUsername = a.length < 5 || 
                                    (a === a.toLowerCase() && !a.includes(' '));
        const hasValidNameFormat = a.match(/[A-Z][a-z]+/) && a.length >= 5;
        return !isBrandName && !isInvalidAuthor && !isComputerUsername && hasValidNameFormat;
      });
      
      if (validAuthors.length > 0) {
        authors.push(...validAuthors);
        break;
      }
    }
  }
  
  // 去重
  const uniqueAuthors = [];
  const seen = new Set();
  for (const author of authors) {
    if (!seen.has(author.toLowerCase())) {
      uniqueAuthors.push(author);
      seen.add(author.toLowerCase());
    }
  }
  
  // 验证第一作者是否在equal contribution列表中
  let firstAuthorHasEqual = false;
  if (uniqueAuthors.length > 0 && equalContributionAuthors.length > 0) {
    const firstAuthor = uniqueAuthors[0];
    // 模糊匹配：检查第一作者是否在equal contribution列表中
    for (const ecAuthor of equalContributionAuthors) {
      // 提取姓氏进行比较
      const firstAuthorLast = firstAuthor.split(/\s+/).pop() || '';
      const ecAuthorLast = ecAuthor.split(/\s+/).pop() || '';
      if (firstAuthorLast && ecAuthorLast && 
          firstAuthorLast.toLowerCase() === ecAuthorLast.toLowerCase()) {
        firstAuthorHasEqual = true;
        console.log('[论文助手] 验证: 第一作者 "' + firstAuthor + '" 在equal contribution列表中');
        break;
      }
      // 完全匹配
      if (firstAuthor.toLowerCase().includes(ecAuthor.toLowerCase()) ||
          ecAuthor.toLowerCase().includes(firstAuthor.toLowerCase())) {
        firstAuthorHasEqual = true;
        console.log('[论文助手] 验证: 第一作者 "' + firstAuthor + '" 在equal contribution列表中');
        break;
      }
    }
  }
  
  return {
    authors: uniqueAuthors,
    firstAuthor: uniqueAuthors[0] || null,
    hasEqualContribution: hasEqualContribution,
    equalContributionAuthors: [...new Set(equalContributionAuthors)],
    firstAuthorHasEqual: firstAuthorHasEqual
  };
}

// 检查论文是否已存在（去重）
// 注意：此函数会从storage同步数据，确保查重基于最新的用户保存记录
// 由于此函数可能被异步调用，我们需要确保每次都从storage获取最新数据
function checkPaperDuplicate(paperInfo, pdfUrl) {
  // 使用内存中的downloadedPapers（在调用此函数前应该已经从storage同步）
  let papersToCheck = downloadedPapers;
  
  // 如果内存数据为空或未定义，说明可能刚清空了记录，直接返回不重复
  if (!papersToCheck || papersToCheck.length === 0) {
    console.log('[查重] 当前记录为空，不重复');
    return { duplicate: false };
  }
  
  console.log('[查重] 检查重复，当前记录数:', papersToCheck.length);
  
  // 检查已下载的论文列表
  for (const paper of papersToCheck) {
    // 方法1：通过arXiv ID匹配
    if (paperInfo.arxivId && paper.arxivId && paperInfo.arxivId === paper.arxivId) {
      return { duplicate: true, reason: 'arXiv ID相同', existingPaper: paper };
    }
    
    // 方法2：通过PDF URL匹配
    if (pdfUrl && paper.originalUrl && pdfUrl === paper.originalUrl) {
      return { duplicate: true, reason: 'PDF URL相同', existingPaper: paper };
    }
    
    // 方法3：通过标题和第一作者匹配（模糊匹配）
    if (paperInfo.title && paperInfo.firstAuthor && 
        paper.title && paper.firstAuthor) {
      const titleSimilarity = calculateSimilarity(
        paperInfo.title.toLowerCase(),
        paper.title.toLowerCase()
      );
      const authorSimilarity = calculateSimilarity(
        paperInfo.firstAuthor.toLowerCase(),
        paper.firstAuthor.toLowerCase()
      );
      
      // 如果标题和作者都高度相似（>80%），认为是重复
      if (titleSimilarity > 0.8 && authorSimilarity > 0.8) {
        return { duplicate: true, reason: '标题和作者高度相似', existingPaper: paper };
      }
    }
  }
  
  return { duplicate: false };
}

// 计算字符串相似度（简单的编辑距离算法）
function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;
  
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  // 简单的包含检查
  if (longer.includes(shorter) || shorter.includes(longer)) {
    return shorter.length / longer.length;
  }
  
  // 计算编辑距离
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  
  return 1 - (distance / maxLength);
}

// 计算编辑距离（Levenshtein距离）
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

// 存储每个论文的下载文件列表（用于合并多个文件到一个JSON）
const paperFilesMap = new Map(); // key: paperKey, value: { metadata, files: [] }
// 存储待处理的下载记录（在触发下载时立即创建，下载完成后更新路径）
const pendingDownloads = new Map(); // key: fileKey, value: { fileInfo, webMetadata, paperKey, downloadTime }
// JSON更新定时器（用于延迟更新，等待所有文件记录完成）
let paperJsonUpdateTimers = {}; // key: paperKey, value: timeoutId

// 生成论文唯一标识（用于合并同一论文的多个文件）
function getPaperKey(paperData) {
  const title = (paperData.title || '').trim();
  const author = (paperData.firstAuthor || paperData.author || '').trim();
  const date = (paperData.extractedDate || paperData.date || '').trim();
  return `${title}|${author}|${date}`;
}

// 清理文件名中的非法字符（用于生成JSON文件名）
// Windows限制：完整路径最大260字符，单个文件名最大255字符
function sanitizeFileName(fileName, maxLength = 100) {
  if (!fileName || typeof fileName !== 'string') {
    return '未知标题';
  }
  
  // 移除或替换Windows/Linux文件名中的非法字符
  let sanitized = fileName
    .replace(/[<>:"/\\|?*()\x00-\x1F]/g, '_')  // 替换非法字符、控制字符和括号
    .replace(/-/g, '_')              // 替换连字符为下划线（避免某些API问题）
    .replace(/\s+/g, '_')            // 空格替换为下划线
    .replace(/_{2,}/g, '_')          // 多个下划线合并为一个
    .replace(/^_+|_+$/g, '');         // 移除首尾下划线
  
  // 限制长度（考虑.json扩展名，所以减5）
  if (sanitized.length > maxLength - 5) {
    sanitized = sanitized.substring(0, maxLength - 5);
    // 确保截断后不会以_结尾
    sanitized = sanitized.replace(/_+$/, '');
  }
  
  // 如果处理后为空，使用默认名称
  if (!sanitized || sanitized.length === 0) {
    sanitized = '未知标题';
  }
  
  return sanitized;
}

// 生成元数据文件（JSON格式，用于Python GUI验证）
// 支持记录同一论文的多个下载文件
async function generateMetadataFile(paperData, pdfFilePath, fileType = '论文全文', fileName = null) {
  try {
    // pdfFilePath是浏览器下载的实际路径（Chrome API返回的filename）
    // 在Windows上可能是 "C:\Users\...\file.pdf"，在Linux/Mac上是 "/home/.../file.pdf"
    
    // 确保pdfFilePath是绝对路径
    let actualFilePath = pdfFilePath;
    
    // 检查是否是绝对路径
    const isAbsolutePath = pdfFilePath && (
      pdfFilePath.includes('\\') ||  // Windows路径包含反斜杠
      pdfFilePath.startsWith('/') ||  // Unix路径以/开头
      /^[A-Za-z]:/.test(pdfFilePath)  // Windows盘符路径（如 C:）
    );
    
    // 如果不是绝对路径，需要从storage获取用户设置的下载目录并拼接
    // 注意：由于chrome.storage.local.get是异步的，我们需要在Promise中处理
    if (!isAbsolutePath && pdfFilePath) {
      // 先尝试同步获取（如果已经在内存中）
      // 如果不行，我们需要在异步回调中处理
      // 为了简化，我们在这里先使用原路径，然后在保存fileInfo时再处理
      console.warn('[元数据文件] 文件路径不是绝对路径，将在保存时使用用户设置的下载目录:', pdfFilePath);
    }
    
    // 提取文件目录和文件名（兼容Windows和Unix路径）
    let actualFileName, fileDir;
    if (actualFilePath.includes('\\')) {
      // Windows路径（使用反斜杠）
      const pathParts = actualFilePath.split('\\');
      actualFileName = pathParts.pop();
      fileDir = pathParts.join('\\');
    } else {
      // Unix路径（使用正斜杠）
      const pathParts = actualFilePath.split('/');
      actualFileName = pathParts.pop();
      fileDir = pathParts.join('/');
    }
    
    // 使用传入的文件名，如果没有则使用实际文件名
    const displayFileName = fileName || actualFileName;
    
    // 获取论文唯一标识
    const paperKey = getPaperKey(paperData);
    
    // 检查是否已有该论文的记录
    let paperRecord = paperFilesMap.get(paperKey);
    
    if (!paperRecord) {
      // 创建新记录
      paperRecord = {
        metadata: {
          // 基本信息
          title: paperData.title || '',
          firstAuthor: paperData.firstAuthor || paperData.author || '',
          allAuthors: paperData.allAuthors || [],
          date: paperData.extractedDate || paperData.date || '',
          dates: paperData.dates || {
            received: null,
            accepted: null,
            published: null,
            revised: null,
            other: []
          },
          
          // 网页信息
          pageUrl: paperData.pageUrl || '',
          pageTitle: paperData.pageTitle || '',
          originalUrl: paperData.originalUrl || '',
          
          // 其他标识
          arxivId: paperData.arxivId || '',
          arnumber: paperData.arnumber || '',
          doi: paperData.doi || '',
          
          // 下载时间（使用第一个文件的下载时间）
          downloadTime: paperData.downloadTime || new Date().toISOString(),
          
          // 版本信息
          metadataVersion: '1.0',
          extensionVersion: '1.0.2'
        },
        files: [],
        fileDir: fileDir  // 保存文件目录，用于生成JSON文件
      };
      paperFilesMap.set(paperKey, paperRecord);
    }
    
    // 添加当前文件到文件列表
    const fileInfo = {
      type: fileType,  // 文件类型：论文全文、正式录用通知、证明材料等
      fileName: displayFileName,  // 显示的文件名
      filePath: pdfFilePath,  // 使用完整绝对路径
      downloadTime: paperData.downloadTime || new Date().toISOString()
    };
    
    // 检查是否已存在相同文件（避免重复）
    const fileExists = paperRecord.files.some(f => 
      f.filePath === pdfFilePath || (f.fileName === displayFileName && f.type === fileType)
    );
    
    if (!fileExists) {
      paperRecord.files.push(fileInfo);
    }
    
    // 更新下载时间（使用最新的）
    if (paperData.downloadTime) {
      paperRecord.metadata.downloadTime = paperData.downloadTime;
    }
    
    // 生成JSON文件的函数（在路径处理完成后调用）
    const generateJsonFile = () => {
      // 格式化下载时间（YYYY/MM/DD HH:mm:ss）
      const downloadTime = new Date(paperRecord.metadata.downloadTime);
      const formattedTime = downloadTime.getFullYear() + '/' +
        String(downloadTime.getMonth() + 1).padStart(2, '0') + '/' +
        String(downloadTime.getDate()).padStart(2, '0') + ' ' +
        String(downloadTime.getHours()).padStart(2, '0') + ':' +
        String(downloadTime.getMinutes()).padStart(2, '0') + ':' +
        String(downloadTime.getSeconds()).padStart(2, '0');
      
      // 构建完整的元数据对象
      const metadata = {
        ...paperRecord.metadata,
        downloadTimeFormatted: formattedTime,  // 格式化的下载时间
        files: paperRecord.files,  // 所有下载的文件列表
        metadataGeneratedTime: new Date().toISOString()
      };
      
      // 继续生成JSON文件...
      continueGenerateJson(metadata, fileDir);
    };
    
    // 如果路径处理是异步的，等待处理完成后再生成JSON
    if (!isAbsolutePath && pdfFilePath) {
      // 已经在buildFileInfo的回调中处理，需要在那里调用generateJsonFile
      // 但为了保持代码结构，我们使用setTimeout确保文件信息已添加
      setTimeout(() => {
        generateJsonFile();
      }, 100);
    } else {
      // 同步处理，直接生成JSON
      generateJsonFile();
    }
    
    return; // 提前返回，避免执行下面的代码
  } catch (error) {
    console.error('[元数据文件] 生成失败:', error);
    throw error;
  }
}

// 继续生成JSON文件的函数
function continueGenerateJson(metadata, fileDir) {
  try {
    
    // 生成JSON文件名（使用标题）
    const title = metadata.title || '未知标题';
    
    // 计算可用文件名长度
    // Windows限制：完整路径最大260字符，单个文件名最大255字符
    // 考虑路径长度，为文件名预留空间
    let maxFileNameLength = 80; // 默认最大80字符（更保守）
    let normalizedDir = '';
    if (fileDir) {
      normalizedDir = fileDir.replace(/\\/g, '/');
      const dirLength = normalizedDir.length;
      // 预留路径长度 + 分隔符 + 扩展名，确保总长度不超过255（留5字符缓冲）
      // 同时考虑单个文件名最大255字符的限制
      maxFileNameLength = Math.max(30, Math.min(150, 255 - dirLength - 1 - 5));
    }
    
    // 先截断标题
    const sanitizedTitle = sanitizeFileName(title, maxFileNameLength);
    const jsonFileName = sanitizedTitle + '.json';
    
    // Chrome API的filename参数需要使用正斜杠，即使是在Windows上
    // 但我们需要确保路径格式正确
    let jsonFilePath;
    if (fileDir) {
      jsonFilePath = `${normalizedDir}/${jsonFileName}`;
      
      // 最终检查：确保总路径长度不超过260字符，文件名不超过255字符
      if (jsonFilePath.length > 260 || jsonFileName.length > 255) {
        console.warn('[元数据文件] 路径或文件名过长，进一步截断:', {
          originalPathLength: jsonFilePath.length,
          originalFileNameLength: jsonFileName.length,
          dirLength: normalizedDir.length,
          maxFileNameLength: maxFileNameLength
        });
        
        // 重新计算文件名长度（更严格）
        const safePathLength = Math.min(255, 260 - normalizedDir.length - 1 - 5);
        const newMaxLength = Math.max(30, safePathLength);
        const truncatedTitle = sanitizeFileName(title, newMaxLength);
        const truncatedFileName = truncatedTitle + '.json';
        jsonFilePath = `${normalizedDir}/${truncatedFileName}`;
        
        console.log('[元数据文件] 截断后:', {
          pathLength: jsonFilePath.length,
          fileNameLength: truncatedFileName.length,
          truncatedTitle: truncatedTitle
        });
      }
    } else {
      // 如果没有目录，只检查文件名长度
      if (jsonFileName.length > 255) {
        const truncatedTitle = sanitizeFileName(title, 250);
        const truncatedFileName = truncatedTitle + '.json';
        jsonFilePath = truncatedFileName;
        console.warn('[元数据文件] 文件名过长，已截断:', {
          original: jsonFileName.length,
          truncated: truncatedFileName.length
        });
      } else {
        jsonFilePath = jsonFileName;
      }
    }
    
    console.log('[元数据文件] 准备生成JSON文件:', {
      title: title,
      titleLength: title.length,
      sanitizedTitle: sanitizedTitle,
      sanitizedLength: sanitizedTitle.length,
      jsonFileName: jsonFileName,
      fileDir: fileDir,
      fileDirLength: fileDir ? fileDir.length : 0,
      jsonFilePath: jsonFilePath,
      jsonFilePathLength: jsonFilePath.length,
      maxFileNameLength: maxFileNameLength
    });
    
    // 将元数据转换为JSON字符串
    const jsonContent = JSON.stringify(metadata, null, 2);
    
    // 创建Blob并下载
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    
    // 使用chrome.downloads下载JSON文件
    chrome.downloads.download({
      url: blobUrl,
      filename: jsonFilePath,
      saveAs: false,
      conflictAction: 'overwrite'  // 覆盖已存在的JSON文件，确保包含所有文件（同一论文的多个文件会合并）
    }, (downloadId) => {
      URL.revokeObjectURL(blobUrl); // 清理blob URL
      
      if (chrome.runtime.lastError) {
        console.error('[元数据文件] 下载失败:', chrome.runtime.lastError);
        console.error('[元数据文件] 失败的文件路径:', jsonFilePath);
        console.error('[元数据文件] 原始标题:', title);
        console.error('[元数据文件] 清理后的标题:', sanitizedTitle);
        
        // 如果下载失败，尝试使用简单的文件名（只包含标题前30字符 + 时间戳）
        console.log('[元数据文件] 尝试使用简单文件名重新下载...');
        const simpleTitle = sanitizeFileName(title, 30);
        const timestamp = Date.now();
        const simpleFileName = `${simpleTitle}_${timestamp}.json`;
        const simplePath = fileDir ? `${normalizedDir}/${simpleFileName}` : simpleFileName;
        
        const blob2 = new Blob([jsonContent], { type: 'application/json' });
        const blobUrl2 = URL.createObjectURL(blob2);
        
        chrome.downloads.download({
          url: blobUrl2,
          filename: simplePath,
          saveAs: false,
          conflictAction: 'overwrite'
        }, (downloadId2) => {
          URL.revokeObjectURL(blobUrl2);
          
          if (chrome.runtime.lastError) {
            console.error('[元数据文件] 简单文件名下载也失败，保存到storage:', chrome.runtime.lastError);
            // 保存到storage作为备用方案
            chrome.storage.local.get(['pendingJsonFiles'], (result) => {
              const pendingFiles = result.pendingJsonFiles || [];
              pendingFiles.push({
                metadata: metadata,
                filePath: pdfFilePath,
                timestamp: new Date().toISOString(),
                title: title,
                paperKey: paperKey
              });
              chrome.storage.local.set({ pendingJsonFiles: pendingFiles }, () => {
                console.log('[元数据文件] 已保存到storage，共', pendingFiles.length, '个待处理文件');
                console.log('[元数据文件] 提示：可以在扩展的popup中导出这些JSON文件');
              });
            });
            return;
          }
          
          console.log('[元数据文件] ✓ JSON文件已生成（使用简单文件名）:', simplePath);
          console.log('[元数据文件] 📁 文件位置:', fileDir);
          console.log('[元数据文件] 📄 文件名:', simpleFileName);
          console.log('[元数据文件] 📋 包含文件数:', paperRecord.files.length);
        });
        return;
      }
      
      console.log('[元数据文件] ✓ JSON文件已生成:', jsonFilePath);
      console.log('[元数据文件] 📁 文件位置:', fileDir);
      console.log('[元数据文件] 📄 文件名:', jsonFileName);
      console.log('[元数据文件] 📋 包含文件数:', paperRecord.files.length);
      
      // 监听下载完成，确保文件已保存
      const listener = (delta) => {
        if (delta.id === downloadId && delta.state && delta.state.current === 'complete') {
          chrome.downloads.onChanged.removeListener(listener);
          console.log('[元数据文件] ✅ JSON文件已保存到:', jsonFilePath);
          
          // 显示所有文件信息
          console.log('[元数据文件] 📦 包含的文件列表:');
          paperRecord.files.forEach((f, idx) => {
            console.log(`  ${idx + 1}. [${f.type}] ${f.fileName}`);
          });
        }
      };
      chrome.downloads.onChanged.addListener(listener);
    });
    
  } catch (error) {
    console.error('[元数据文件] 生成失败:', error);
    throw error;
  }
}

// 第三阶段：下载并重命名文件
async function downloadAndRename(pdfUrl, paperInfo, pageUrl, pageTitle) {
  return new Promise((resolve, reject) => {
    // 在检查重复前，先从storage同步最新数据
    chrome.storage.local.get(['papers'], (result) => {
      const storedPapers = result.papers || [];
      // 同步到内存变量
      downloadedPapers = storedPapers;
      console.log('[下载] 从storage同步数据，当前记录数:', downloadedPapers.length);
      
      // 检查是否重复
      const duplicateCheck = checkPaperDuplicate(paperInfo, pdfUrl);
      if (duplicateCheck.duplicate) {
        console.log('[论文助手] 检测到重复论文:', duplicateCheck.reason);
        console.log('[论文助手] 已存在的论文:', duplicateCheck.existingPaper);
        
        // 通知用户
        try {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: '论文已存在',
            message: `检测到重复论文: ${duplicateCheck.reason}\n标题: ${paperInfo.title || '未知'}`
          });
        } catch (e) {
          console.log('[论文助手] 通知创建失败:', e);
        }
        
        // 返回已存在的论文信息
        resolve(duplicateCheck.existingPaper);
        return;
      }
      
      // 继续下载流程
      const date = paperInfo.extractedDate || paperInfo.creationDate || '未知日期';
      const author = paperInfo.firstAuthor || paperInfo.author || '未知作者';
      const title = paperInfo.title || '未知标题';
      
      // 构建标签（不使用文件名，只使用标签）
      const tags = [];
      if (date && date !== '未知日期') {
        tags.push(`日期:${date}`);
      }
      if (author && author !== '未知作者') {
        tags.push(`作者:${author}`);
      }
      if (title && title !== '未知标题') {
        tags.push(`标题:${title.substring(0, 50)}`);
      }
      if (paperInfo.arxivId) {
        tags.push(`arXiv:${paperInfo.arxivId}`);
      }
      if (paperInfo.arnumber) {
        tags.push(`IEEE:${paperInfo.arnumber}`);
      }
      
      console.log('[论文助手] 准备下载文件，标签:', tags);
      
      // 下载文件（不指定文件名，只使用标签）
      chrome.downloads.download({
        url: pdfUrl,
        conflictAction: 'uniquify',  // PDF文件使用uniquify，避免覆盖
        saveAs: false,
        tags: tags
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('[论文助手] 下载失败:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
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
                
                // 生成元数据文件（用于Python GUI验证）
                // 文件类型：论文全文
                generateMetadataFile(paperData, filePath, '论文全文', null).catch(err => {
                  console.warn('[论文助手] 生成元数据文件失败:', err);
                });
                
                // 生成验证JSON文件（供Python软件读取）
                generateSimpleVerificationJson(paperData, [filePath], pageUrl).catch(err => {
                  console.warn('[验证JSON] 生成验证JSON文件失败:', err);
                });
                
                // 通知popup更新
                chrome.runtime.sendMessage({
                  action: 'paperDownloaded',
                  paper: paperData
                });
                
                resolve(paperData);
              } else {
                reject(new Error('无法获取下载文件信息'));
              }
            });
          } else if (delta.id === downloadId && delta.state && delta.state.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(listener);
            reject(new Error('下载被中断'));
          }
        });
      });
    });
  });
}

// 基础下载方式（备用）
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
            
            // 生成验证JSON文件（供Python软件读取）
            generateSimpleVerificationJson(paperData, [filePath], pageUrl).catch(err => {
              console.warn('[验证JSON] 生成验证JSON文件失败:', err);
            });
          }
        });
      }
    });
  });
}

// 处理论文验证流程
async function handlePaperVerification(pdfUrl, pageUrl, webMetadata, fileInfo = {}) {
  try {
    console.log('[验证模块] 开始验证论文:', pdfUrl);
    console.log('[验证模块] 网页元数据:', webMetadata);
    console.log('[验证模块] 文件信息:', fileInfo);
    
    // 如果pdfUrl是blob URL，直接使用（这是从拖放功能创建的）
    if (pdfUrl && pdfUrl.startsWith('blob:')) {
      console.log('[验证模块] 使用blob URL进行验证（来自拖放功能）:', pdfUrl);
      // blob URL可以直接使用，不需要特殊处理
    }
    // 如果pdfUrl是文件路径而不是URL，需要特殊处理
    // Chrome扩展无法直接读取本地文件，所以如果URL是文件路径，我们需要跳过验证或提示用户
    else if (pdfUrl && !pdfUrl.startsWith('http') && !pdfUrl.startsWith('blob:') && !pdfUrl.startsWith('file:') && !pdfUrl.startsWith('data:')) {
      // 这可能是文件路径，Chrome扩展无法直接访问
      console.warn('[验证模块] PDF URL是文件路径，无法直接访问:', pdfUrl);
      
      // 尝试从下载记录中获取URL
      if (fileInfo.downloadId) {
        const downloads = await new Promise((resolve) => {
          chrome.downloads.search({ id: fileInfo.downloadId }, resolve);
        });
        if (downloads && downloads.length > 0 && downloads[0].url && 
            !downloads[0].url.startsWith('blob:') && !downloads[0].url.startsWith('file:') &&
            (downloads[0].url.toLowerCase().endsWith('.pdf') || downloads[0].url.includes('/pdf/'))) {
          pdfUrl = downloads[0].url;
          console.log('[验证模块] 从下载记录获取URL:', pdfUrl);
        } else {
          // 如果无法获取URL，返回错误
          throw new Error('无法访问本地文件。请使用拖放功能将PDF文件拖入验证区域进行验证。');
        }
      } else {
        // 如果没有downloadId，返回错误
        throw new Error('无法访问本地文件。请使用拖放功能将PDF文件拖入验证区域进行验证。');
      }
    }
    
    // 如果是file:// URL，也会被CORS阻止，需要特殊处理
    if (pdfUrl && pdfUrl.startsWith('file://')) {
      console.warn('[验证模块] PDF URL是file://协议，可能被CORS阻止:', pdfUrl);
      // 尝试从下载记录中获取URL
      if (fileInfo.downloadId) {
        const downloads = await new Promise((resolve) => {
          chrome.downloads.search({ id: fileInfo.downloadId }, resolve);
        });
        if (downloads && downloads.length > 0 && downloads[0].url && 
            !downloads[0].url.startsWith('blob:') && !downloads[0].url.startsWith('file:') &&
            (downloads[0].url.toLowerCase().endsWith('.pdf') || downloads[0].url.includes('/pdf/'))) {
          pdfUrl = downloads[0].url;
          console.log('[验证模块] 从下载记录获取URL:', pdfUrl);
        } else if (fileInfo.filePath) {
          // 如果URL不可用，尝试根据文件路径查找
          const pathFileName = fileInfo.filePath.split(/[/\\]/).pop();
          const allDownloads = await new Promise((resolve) => {
            chrome.downloads.search({
              filenameRegex: pathFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              orderBy: ['-startTime'],
              limit: 10
            }, resolve);
          });
          
          if (allDownloads && allDownloads.length > 0) {
            const matchingDownload = allDownloads.find(d => {
              const downloadFileName = d.filename ? d.filename.split(/[/\\]/).pop() : '';
              return downloadFileName === pathFileName || downloadFileName === fileInfo.name;
            }) || allDownloads[0];
            
            if (matchingDownload && matchingDownload.url && 
                !matchingDownload.url.startsWith('blob:') && !matchingDownload.url.startsWith('file:') &&
                (matchingDownload.url.toLowerCase().endsWith('.pdf') || matchingDownload.url.includes('/pdf/'))) {
              pdfUrl = matchingDownload.url;
              console.log('[验证模块] 通过文件名从下载记录获取URL:', pdfUrl);
            } else {
              throw new Error(`无法访问本地文件 "${fileInfo.name}"。请使用拖放功能将PDF文件拖入验证区域进行验证。`);
            }
          } else {
            throw new Error(`无法访问本地文件 "${fileInfo.name}"。请使用拖放功能将PDF文件拖入验证区域进行验证。`);
          }
        } else {
          throw new Error('无法访问本地文件。请使用拖放功能将PDF文件拖入验证区域进行验证。');
        }
      } else if (fileInfo.filePath) {
        // 如果没有downloadId，尝试根据文件路径查找
        const pathFileName = fileInfo.filePath.split(/[/\\]/).pop();
        const allDownloads = await new Promise((resolve) => {
          chrome.downloads.search({
            filenameRegex: pathFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            orderBy: ['-startTime'],
            limit: 10
          }, resolve);
        });
        
        if (allDownloads && allDownloads.length > 0) {
          const matchingDownload = allDownloads.find(d => {
            const downloadFileName = d.filename ? d.filename.split(/[/\\]/).pop() : '';
            return downloadFileName === pathFileName || downloadFileName === fileInfo.name;
          }) || allDownloads[0];
          
          if (matchingDownload && matchingDownload.url && 
              !matchingDownload.url.startsWith('blob:') && !matchingDownload.url.startsWith('file:') &&
              (matchingDownload.url.toLowerCase().endsWith('.pdf') || matchingDownload.url.includes('/pdf/'))) {
            pdfUrl = matchingDownload.url;
            console.log('[验证模块] 通过文件路径从下载记录获取URL:', pdfUrl);
          } else {
            throw new Error(`无法访问本地文件 "${fileInfo.name}"。请使用拖放功能将PDF文件拖入验证区域进行验证。`);
          }
        } else {
          throw new Error(`无法访问本地文件 "${fileInfo.name}"。请使用拖放功能将PDF文件拖入验证区域进行验证。`);
        }
      } else {
        throw new Error('无法访问本地文件。请使用拖放功能将PDF文件拖入验证区域进行验证。');
      }
    }
    
    // blob URL可以直接使用（从拖放功能创建的），不需要特殊处理
    // 只有在blob URL失效时才需要查找替代方案
    
    // 如果webMetadata不完整，尝试从页面重新提取
    if (!webMetadata || (!webMetadata.firstAuthor && !webMetadata.authors)) {
      console.log('[验证模块] 网页元数据不完整，尝试从页面重新提取');
      // 这里可以发送消息到content script重新提取
    }
    
    const verificationResult = {
      pdfUrl: pdfUrl,
      pageUrl: pageUrl,
      webMetadata: webMetadata || {},
      pdfTextData: null,
      ocrData: null,
      matchResult: null,
      timestamp: new Date().toISOString()
    };
    
    // 1. 从PDF文本中提取信息（在content script中执行，避免CORS问题）
    try {
      console.log('[验证模块] 步骤1: 在content script中解析PDF，URL:', pdfUrl);
      
      // 找到对应的标签页
      let pdfTab = null;
      if (pageUrl) {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({}, resolve);
        });
        pdfTab = tabs.find(tab => tab.url && tab.url === pageUrl);
      }
      
      // 如果没找到，查找一个合适的普通网页标签页（排除扩展页面）
      if (!pdfTab) {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({}, resolve);
        });
        // 查找一个http/https页面（content script可以注入的页面）
        // 排除扩展页面（chrome-extension://）和特殊页面（chrome://, about:）
        pdfTab = tabs.find(tab => {
          const url = tab.url || '';
          return url.startsWith('http://') || url.startsWith('https://');
        }) || 
        tabs.find(tab => {
          const url = tab.url || '';
          return tab.active && (url.startsWith('http://') || url.startsWith('https://'));
        }) ||
        null;
      }
      
      if (pdfTab) {
        console.log('[验证模块] 找到标签页，ID:', pdfTab.id, 'URL:', pdfTab.url);
        
        // 验证标签页URL是否有效（必须是http/https，不能是扩展页面）
        const tabUrl = pdfTab.url || '';
        if (!tabUrl.startsWith('http://') && !tabUrl.startsWith('https://')) {
          console.warn('[验证模块] 标签页URL无效（不是http/https），尝试查找其他标签页');
          const allTabs = await new Promise((resolve) => {
            chrome.tabs.query({}, resolve);
          });
          pdfTab = allTabs.find(tab => {
            const url = tab.url || '';
            return url.startsWith('http://') || url.startsWith('https://');
          }) || null;
          
          if (!pdfTab) {
            throw new Error('未找到可用的网页标签页。请打开任意网页（如百度、Google等），然后重试。');
          }
        }
        
        console.log('[验证模块] 使用标签页，ID:', pdfTab.id, 'URL:', pdfTab.url);
        
        // 先检查content script是否已加载（最多等待2秒）
        let contentScriptReady = false;
        for (let i = 0; i < 10; i++) {
          try {
            await new Promise((resolve) => {
              chrome.tabs.sendMessage(pdfTab.id, { action: 'ping' }, (response) => {
                if (chrome.runtime.lastError) {
                  // Content script可能还没加载，等待后重试
                  if (i < 9) {
                    setTimeout(() => resolve(), 200); // 每次等待200ms
                  } else {
                    console.warn('[验证模块] Content script ping失败，但继续尝试发送消息');
                    resolve();
                  }
                } else if (response && response.loaded) {
                  console.log('[验证模块] Content script已加载');
                  contentScriptReady = true;
                  resolve();
                } else {
                  resolve();
                }
              });
            });
            if (contentScriptReady) break;
          } catch (e) {
            console.warn('[验证模块] Content script检查出错:', e);
            if (i < 9) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
        }
        
        // 检查是否是data URL（base64数据）或blob URL
        let pdfParseResult = null;
        
        if (pdfUrl.startsWith('data:application/pdf;base64,')) {
          // data URL（base64数据），直接使用parsePdfFromData
          console.log('[验证模块] 检测到data URL（base64），使用parsePdfFromData方式');
          const base64Data = pdfUrl.split(',')[1];
          
          pdfParseResult = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              console.error('[验证模块] PDF解析请求超时');
              reject(new Error('PDF解析请求超时'));
            }, 60000); // 增加到60秒，因为PDF解析可能需要较长时间
            
            console.log('[验证模块] 发送parsePdfFromData消息到content script，标签页ID:', pdfTab.id);
            chrome.tabs.sendMessage(pdfTab.id, {
              action: 'parsePdfFromData',
              fileData: base64Data,
              fileName: fileInfo.name || fileInfo.fileName || 'uploaded.pdf'
            }, (response) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) {
                console.error('[验证模块] 发送消息失败:', chrome.runtime.lastError.message);
                reject(new Error(chrome.runtime.lastError.message));
              } else if (response && response.error) {
                console.error('[验证模块] PDF解析返回错误:', response.error);
                reject(new Error(response.error));
              } else {
                console.log('[验证模块] PDF解析响应:', response);
                resolve(response || {});
              }
            });
          });
        } else if (pdfUrl.startsWith('blob:')) {
          // blob URL需要特殊处理：在background script中使用fetch读取
          console.log('[验证模块] 检测到blob URL，尝试读取并转换为base64');
          
          try {
            // 在background script中使用fetch读取blob URL
            const response = await fetch(pdfUrl);
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binaryString = '';
            const chunkSize = 8192;
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
              const chunk = uint8Array.slice(i, i + chunkSize);
              binaryString += String.fromCharCode.apply(null, chunk);
            }
            const base64 = btoa(binaryString);
            
            // 使用base64数据解析PDF
            pdfParseResult = await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                console.error('[验证模块] PDF解析请求超时');
                reject(new Error('PDF解析请求超时'));
              }, 60000); // 增加到60秒
              
              console.log('[验证模块] 发送parsePdfFromData消息到content script，标签页ID:', pdfTab.id);
              chrome.tabs.sendMessage(pdfTab.id, {
                action: 'parsePdfFromData',
                fileData: base64,
                fileName: fileInfo.name || fileInfo.fileName || 'uploaded.pdf'
              }, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                  console.error('[验证模块] 发送消息失败:', chrome.runtime.lastError.message);
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (response && response.error) {
                  console.error('[验证模块] PDF解析返回错误:', response.error);
                  reject(new Error(response.error));
                } else {
                  console.log('[验证模块] PDF解析响应:', response);
                  resolve(response || {});
                }
              });
            });
          } catch (error) {
            console.error('[验证模块] 读取blob URL失败:', error);
            throw new Error(`无法读取blob URL: ${error.message}`);
          }
        } else {
          // 普通URL，直接使用parsePdf
          pdfParseResult = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              console.error('[验证模块] PDF解析请求超时');
              reject(new Error('PDF解析请求超时'));
            }, 60000); // 增加到60秒
            
            console.log('[验证模块] 发送parsePdf消息到content script，标签页ID:', pdfTab.id);
            chrome.tabs.sendMessage(pdfTab.id, {
              action: 'parsePdf',
              pdfUrl: pdfUrl
            }, (response) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) {
                console.error('[验证模块] 发送消息失败:', chrome.runtime.lastError.message);
                reject(new Error(chrome.runtime.lastError.message));
              } else if (response && response.error) {
                console.error('[验证模块] PDF解析返回错误:', response.error);
                reject(new Error(response.error));
              } else {
                console.log('[验证模块] PDF解析响应:', response);
                resolve(response || {});
              }
            });
          });
        }
        
        if (pdfParseResult && pdfParseResult.success && pdfParseResult.first500Chars) {
          console.log('[验证模块] PDF文本解析成功，文本长度:', pdfParseResult.first500Chars.length);
          console.log('[验证模块] PDF文本预览:', pdfParseResult.first500Chars.substring(0, 200));
          
          // 使用fullText（如果可用）或first500Chars，确保能提取到Date字段
          const textForExtraction = (pdfParseResult.fullText && pdfParseResult.fullText.length > 0) 
            ? pdfParseResult.fullText 
            : pdfParseResult.first500Chars;
          console.log('[验证模块] 用于日期提取的文本长度:', textForExtraction.length);
          
          // 优先使用从content.js返回的字段（如果存在）
          let firstAuthor = pdfParseResult.firstAuthor || '';
          let allAuthors = pdfParseResult.allAuthors || [];
          let isCoFirst = pdfParseResult.isCoFirst || false;
          
          // 如果没有，使用background script中的提取函数处理文本
          if (!firstAuthor) {
          const allDates = extractAllDates(textForExtraction + ' ' + (pdfParseResult.title || ''));
          const authorInfo = extractAllAuthors(pdfParseResult.first500Chars, {
            Title: pdfParseResult.title,
            Author: pdfParseResult.author
          });
            firstAuthor = authorInfo.firstAuthor || extractFirstAuthor(pdfParseResult.first500Chars, {
            Title: pdfParseResult.title,
            Author: pdfParseResult.author
          }) || (pdfParseResult.author ? pdfParseResult.author.split(/[,;]/)[0].trim() : '');
          
            if (allAuthors.length === 0) {
              allAuthors = authorInfo.authors || [];
            }
          }
          
          // 优先使用从content.js返回的extractedDates（如果存在），否则提取
          let dates = pdfParseResult.extractedDates || {};
          let dateStr = dates.received || dates.accepted || dates.published || dates.availableOnline || '';
          
          if (!dates.received && !dates.accepted && !dates.published) {
            dates = extractAllDates(textForExtraction + ' ' + (pdfParseResult.title || '')) || {};
            dateStr = dates.received || dates.accepted || dates.published || '';
          }
          
          // 如果有OCR结构化结果，优先使用其中的信息
          if (pdfParseResult.ocrStructured && typeof pdfParseResult.ocrStructured === 'object') {
            const ocrStruct = pdfParseResult.ocrStructured;
            // 优先使用OCR结构化结果中的first_author
            if (ocrStruct.first_author && ocrStruct.first_author !== 'Not mentioned' && !firstAuthor) {
              firstAuthor = String(ocrStruct.first_author).trim();
            }
            // 优先使用OCR结构化结果中的authors
            if (ocrStruct.authors && ocrStruct.authors !== 'Not mentioned' && allAuthors.length === 0) {
              const ocrAuthors = String(ocrStruct.authors).split(/[,;]/).map(a => a.trim()).filter(a => a.length > 0);
              if (ocrAuthors.length > 0) {
                allAuthors = ocrAuthors;
                if (!firstAuthor) {
                  firstAuthor = ocrAuthors[0];
                }
              }
            }
            // 使用OCR结构化结果中的is_co_first
            if (ocrStruct.is_co_first !== undefined) {
              isCoFirst = ocrStruct.is_co_first === true;
            }
            // 优先使用OCR结构化结果中的dates
            if (ocrStruct.dates && typeof ocrStruct.dates === 'object') {
              const ocrDates = ocrStruct.dates;
              if (ocrDates.received && ocrDates.received !== 'Not mentioned' && !dates.received) {
                dates.received = ocrDates.received;
              }
              if (ocrDates.received_in_revised && ocrDates.received_in_revised !== 'Not mentioned') {
                dates.revised = ocrDates.received_in_revised;
              } else if (ocrDates.revised && ocrDates.revised !== 'Not mentioned' && !dates.revised) {
                dates.revised = ocrDates.revised;
              }
              if (ocrDates.accepted && ocrDates.accepted !== 'Not mentioned' && !dates.accepted) {
                dates.accepted = ocrDates.accepted;
              }
              if (ocrDates.available_online && ocrDates.available_online !== 'Not mentioned' && !dates.availableOnline) {
                dates.availableOnline = ocrDates.available_online;
              }
              // 更新dateStr
              dateStr = dates.received || dates.accepted || dates.published || dates.availableOnline || dateStr;
            }
          }
          
          console.log('[验证模块] 提取结果:', {
            firstAuthor: firstAuthor,
            allAuthors: allAuthors,
            isCoFirst: isCoFirst,
            dates: dates,
            dateStr: dateStr
          });
          
          verificationResult.pdfTextData = {
            firstAuthor: firstAuthor || '',
            allAuthors: allAuthors.length > 0 ? allAuthors : [],
            isCoFirst: isCoFirst,
            date: dateStr,
            dates: dates,
            text: pdfParseResult.first500Chars || pdfParseResult.fullText || '',
            title: pdfParseResult.title || '',
            hasEqualContribution: isCoFirst || false,
            equalContributionAuthors: isCoFirst ? allAuthors : [],
            firstAuthorHasEqual: isCoFirst || false
          };
          
          console.log('[验证模块] PDF文本提取完成:', {
            firstAuthor: verificationResult.pdfTextData.firstAuthor,
            date: verificationResult.pdfTextData.date,
            dates: verificationResult.pdfTextData.dates
          });
        } else {
          // PDF解析失败或文本为空，可能是扫描件，继续执行OCR
          const errorMsg = pdfParseResult && pdfParseResult.error ? pdfParseResult.error : 'PDF解析失败：可能是扫描件，将尝试OCR';
          console.warn('[验证模块] PDF文本解析失败或为空:', errorMsg, '完整响应:', pdfParseResult);
          // 不抛出错误，继续执行OCR
          verificationResult.pdfTextData = {
            firstAuthor: '',
            allAuthors: [],
            date: '',
            dates: null,
            text: '',
            title: '',
            isScanned: true, // 标记为扫描件
            error: errorMsg
          };
        }
      } else {
        throw new Error('未找到可用的标签页执行PDF解析');
      }
    } catch (error) {
      console.error('[验证模块] PDF文本提取失败:', error);
      console.error('[验证模块] 错误堆栈:', error.stack);
      verificationResult.pdfTextData = {
        firstAuthor: '',
        allAuthors: [],
        date: '',
        dates: null,
        text: '',
        error: error.message || 'PDF解析失败，请查看控制台日志'
      };
    }
    
    // 2. 通知content script执行OCR（需要在页面上下文中执行）
    // 只有在PDF文本解析失败或文本内容很少时才执行OCR
    const pdfTextExtracted = verificationResult.pdfTextData && 
                             verificationResult.pdfTextData.text && 
                             verificationResult.pdfTextData.text.length > 100;
    const pdfHasAuthor = verificationResult.pdfTextData && 
                        (verificationResult.pdfTextData.firstAuthor || 
                         (verificationResult.pdfTextData.allAuthors && verificationResult.pdfTextData.allAuthors.length > 0));
    const pdfHasDate = verificationResult.pdfTextData && 
                      (verificationResult.pdfTextData.date || 
                       (verificationResult.pdfTextData.dates && 
                        (verificationResult.pdfTextData.dates.received || 
                         verificationResult.pdfTextData.dates.accepted || 
                         verificationResult.pdfTextData.dates.published)));
    
    // 如果PDF文本解析成功且提取到了足够的信息，跳过OCR
    if (pdfTextExtracted && (pdfHasAuthor || pdfHasDate)) {
      console.log('[验证模块] PDF文本解析成功，已提取到足够信息，跳过OCR');
      verificationResult.ocrData = {
        title: null,
        firstAuthor: null,
        allAuthors: [],
        date: null,
        dates: null,
        skipped: true,
        reason: 'PDF文本解析成功，已提取到足够信息'
      };
    } else {
      // 只有在PDF文本解析失败或信息不足时才执行OCR
      console.log('[验证模块] PDF文本解析失败或信息不足，执行OCR');
      
      // 由于OCR需要在DOM环境中运行，我们通过content script来处理
      // 使用pageUrl对应的标签页，而不是当前活动标签页
      let ocrTab = null;
      if (pageUrl) {
        // 尝试找到对应的标签页
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({}, resolve);
        });
        ocrTab = tabs.find(tab => tab.url && tab.url === pageUrl);
      }
      
      // 如果没找到，尝试使用当前活动标签页
      if (!ocrTab) {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, resolve);
        });
        ocrTab = tabs && tabs[0] ? tabs[0] : null;
      }
      
      if (ocrTab) {
        try {
          // 发送消息到content script执行OCR
          const ocrResult = await new Promise((resolve, reject) => {
            // 设置超时
            const timeout = setTimeout(() => {
              reject(new Error('OCR请求超时'));
            }, 30000); // 30秒超时
            
            chrome.tabs.sendMessage(ocrTab.id, {
              action: 'performOcr',
              pdfUrl: pdfUrl
            }, (response) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (response && response.error) {
                reject(new Error(response.error));
              } else {
                resolve(response || {});
              }
            });
          });
          
          // 从OCR结果中提取结构化信息
          let ocrData = {
            title: null,
            firstAuthor: null,
            allAuthors: [],
            date: null,
            dates: null,
            isCoFirst: false
          };
          
          // 如果OCR结果包含structured字段（二段式OCR结果）
          if (ocrResult.structured && typeof ocrResult.structured === 'object') {
            const structured = ocrResult.structured;
            ocrData.title = structured.title && structured.title !== 'Not mentioned' ? structured.title : null;
            ocrData.firstAuthor = structured.first_author && structured.first_author !== 'Not mentioned' 
              ? structured.first_author 
              : (structured.authors && structured.authors !== 'Not mentioned' 
                  ? String(structured.authors).split(/[,;]/)[0].trim() 
                  : null);
            if (structured.authors && structured.authors !== 'Not mentioned') {
              ocrData.allAuthors = String(structured.authors).split(/[,;]/).map(a => a.trim()).filter(a => a.length > 0);
            }
            ocrData.isCoFirst = structured.is_co_first === true;
            if (structured.dates && typeof structured.dates === 'object') {
              ocrData.dates = {
                received: structured.dates.received && structured.dates.received !== 'Not mentioned' ? structured.dates.received : null,
                revised: structured.dates.received_in_revised && structured.dates.received_in_revised !== 'Not mentioned' 
                  ? structured.dates.received_in_revised 
                  : (structured.dates.revised && structured.dates.revised !== 'Not mentioned' ? structured.dates.revised : null),
                accepted: structured.dates.accepted && structured.dates.accepted !== 'Not mentioned' ? structured.dates.accepted : null,
                availableOnline: structured.dates.available_online && structured.dates.available_online !== 'Not mentioned' 
                  ? structured.dates.available_online 
                  : null,
                published: null
              };
              // 设置date字段（优先使用received，然后是accepted）
              ocrData.date = ocrData.dates.received || ocrData.dates.accepted || ocrData.dates.availableOnline || null;
            }
          } else {
            // 如果没有structured字段，使用旧的格式（向后兼容）
            ocrData = {
              title: ocrResult.title || null,
              firstAuthor: ocrResult.firstAuthor || null,
              allAuthors: ocrResult.allAuthors || [],
              date: ocrResult.date || null,
              dates: ocrResult.dates || null,
              isCoFirst: ocrResult.isCoFirst || false
            };
          }
          
          // 保存完整的OCR结果（包括原始文本和结构化结果）
          ocrData.text = ocrResult.text || '';
          ocrData.structured = ocrResult.structured || null;
          ocrData.llmRawText = ocrResult.llmRawText || '';
          ocrData.llmParseError = ocrResult.llmParseError || null;
          ocrData.llmTruncatedInput = ocrResult.llmTruncatedInput || false;
          
          verificationResult.ocrData = ocrData;
          console.log('[验证模块] OCR识别完成:', verificationResult.ocrData);
        } catch (error) {
          console.error('[验证模块] OCR识别失败:', error);
          verificationResult.ocrData = {
            title: null,
            firstAuthor: null,
            allAuthors: [],
            date: null,
            dates: null,
            error: error.message
          };
        }
      } else {
        console.warn('[验证模块] 未找到可用的标签页执行OCR');
        verificationResult.ocrData = {
          title: null,
          firstAuthor: null,
          allAuthors: [],
          date: null,
          dates: null,
          error: '未找到可用的标签页'
        };
      }
    }
    
    // 3. 执行匹配验证
    // 从webMetadata提取日期（如果有dates对象）
    let webDate = webMetadata?.date || '';
    if (webMetadata?.dates) {
      const dates = webMetadata.dates;
      webDate = dates.received || dates.accepted || dates.published || webDate;
    }
    
    verificationResult.matchResult = matchVerification(
      {
        firstAuthor: webMetadata?.firstAuthor || '',
        allAuthors: webMetadata?.allAuthors || [],
        date: webDate,
        dates: webMetadata?.dates || null,
        title: webMetadata?.title || ''
      },
      verificationResult.pdfTextData || { firstAuthor: '', allAuthors: [], date: '', dates: null, title: '' },
      verificationResult.ocrData || { firstAuthor: '', allAuthors: [], date: '', dates: null, title: '' }
    );
    
    console.log('[验证模块] 验证完成:', verificationResult.matchResult);
    
    // 保存验证结果
    chrome.storage.local.get(['verificationResults'], (result) => {
      const results = result.verificationResults || [];
      results.push(verificationResult);
      chrome.storage.local.set({ verificationResults: results });
    });
    
    // 生成固定文件名的JSON文件，供Python软件读取
    await generateVerificationJsonFile(verificationResult, fileInfo);
    
    return verificationResult;
    
  } catch (error) {
    console.error('[验证模块] 验证过程失败:', error);
    throw error;
  }
}

// 日期标准化函数：将不同格式的日期统一为 YYYY-MM-DD 格式
function normalizeDate(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }
  
  try {
    // 尝试直接解析为Date对象
    let date = new Date(dateString);
    
    // 如果解析失败，尝试手动解析常见格式
    if (isNaN(date.getTime())) {
      // 格式1: "Wed, 24 Dec 2025 15:15:18 UTC"
      let match = dateString.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
      if (match) {
        const day = match[1];
        const monthName = match[2];
        const year = match[3];
        date = new Date(`${monthName} ${day}, ${year}`);
      } else {
        // 格式2: "2025年12月24日" 或 "2025 年 12 月 24 日"
        match = dateString.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
        if (match) {
          const year = match[1];
          const month = match[2];
          const day = match[3];
          date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
        } else {
          // 格式3: "YYYY-MM-DD"
          match = dateString.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (match) {
            date = new Date(dateString);
          } else {
            // 格式4: "24 Dec 2025"
            match = dateString.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
            if (match) {
              date = new Date(dateString);
            }
          }
        }
      }
    }
    
    // 如果仍然无法解析，返回null
    if (isNaN(date.getTime())) {
      return null;
    }
    
    // 格式化为 YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    console.warn('[日期标准化] 解析失败:', dateString, e);
    return null;
  }
}

// 匹配验证函数
function matchVerification(webData, pdfTextData, ocrData) {
  // 标准化网页日期 - 优先使用dates对象中的received日期（提交日期）
  let webDate = webData.date || '';
  if (webData.dates && webData.dates.received) {
    webDate = webData.dates.received;
  } else if (webData.dates && webData.dates.published) {
    webDate = webData.dates.published;
  }
  const webDateNormalized = normalizeDate(webDate);
  
  // 收集PDF中的所有日期（包括Received, Revised, Accepted, Published, 其他）
  // 按优先级排序：Received > Revised > Accepted > Published > Other
  const pdfDates = [];
  if (pdfTextData.dates) {
    if (pdfTextData.dates.received) pdfDates.push({ type: 'Received', date: pdfTextData.dates.received, priority: 1 });
    if (pdfTextData.dates.revised) pdfDates.push({ type: 'Revised', date: pdfTextData.dates.revised, priority: 2 });
    if (pdfTextData.dates.accepted) pdfDates.push({ type: 'Accepted', date: pdfTextData.dates.accepted, priority: 3 });
    if (pdfTextData.dates.published) pdfDates.push({ type: 'Published', date: pdfTextData.dates.published, priority: 4 });
    if (pdfTextData.dates.availableOnline) pdfDates.push({ type: 'Available online', date: pdfTextData.dates.availableOnline, priority: 4 });
    if (pdfTextData.dates.other && pdfTextData.dates.other.length > 0) {
      // 过滤无效日期（如1900、1990、1997等明显错误的年份）
      const invalidYears = [1900, 1990, 1997];
      pdfTextData.dates.other.forEach(d => {
        const yearMatch = String(d).match(/(\d{4})/);
        if (yearMatch) {
          const year = parseInt(yearMatch[1]);
          // 只添加2000年以后的日期，且不在无效年份列表中
          if (year >= 2000 && year <= 2100 && !invalidYears.includes(year)) {
            pdfDates.push({ type: 'Other', date: d, priority: 5 });
          }
        }
      });
    }
  }
  // 只有当pdfTextData.date确实在extractedDates中出现过时才添加为General日期
  // 避免使用PDF元数据中的CreationDate/ModDate（这些可能不是论文的实际日期）
  if (pdfTextData.date && !pdfDates.find(d => d.date === pdfTextData.date)) {
    // 检查这个日期是否在extractedDates中出现过（说明是从文本中提取的）
    const dateInExtracted = pdfTextData.dates && (
      pdfTextData.dates.received === pdfTextData.date ||
      pdfTextData.dates.revised === pdfTextData.date ||
      pdfTextData.dates.accepted === pdfTextData.date ||
      pdfTextData.dates.published === pdfTextData.date ||
      pdfTextData.dates.availableOnline === pdfTextData.date ||
      (pdfTextData.dates.other && pdfTextData.dates.other.includes(pdfTextData.date))
    );
    // 只有当日期确实在extractedDates中出现过时才添加
    if (dateInExtracted) {
      pdfDates.push({ type: 'General', date: pdfTextData.date, priority: 4 });
    }
  }
  
  // 收集OCR中的所有日期
  const ocrDates = [];
  if (ocrData.dates) {
    if (ocrData.dates.received) ocrDates.push({ type: 'Received', date: ocrData.dates.received, priority: 1 });
    // 优先使用received_in_revised字段（如果存在），否则使用revised
    if (ocrData.dates.received_in_revised) {
      ocrDates.push({ type: 'Revised', date: ocrData.dates.received_in_revised, priority: 2 });
    } else if (ocrData.dates.revised) {
      ocrDates.push({ type: 'Revised', date: ocrData.dates.revised, priority: 2 });
    }
    if (ocrData.dates.accepted) ocrDates.push({ type: 'Accepted', date: ocrData.dates.accepted, priority: 3 });
    if (ocrData.dates.availableOnline) ocrDates.push({ type: 'Available online', date: ocrData.dates.availableOnline, priority: 4 });
    if (ocrData.dates.published) ocrDates.push({ type: 'Published', date: ocrData.dates.published, priority: 5 });
    if (ocrData.dates.other && ocrData.dates.other.length > 0) {
      // 过滤无效日期（如1900、1990、1997等明显错误的年份）
      const invalidYears = [1900, 1990, 1997];
      ocrData.dates.other.forEach(d => {
        const yearMatch = String(d).match(/(\d{4})/);
        if (yearMatch) {
          const year = parseInt(yearMatch[1]);
          // 只添加2000年以后的日期，且不在无效年份列表中
          if (year >= 2000 && year <= 2100 && !invalidYears.includes(year)) {
            ocrDates.push({ type: 'Other', date: d, priority: 6 });
          }
        }
      });
    }
  }
  // 只有当ocrData.date确实在ocrData.dates中出现过时才添加为General日期
  if (ocrData.date && !ocrDates.find(d => d.date === ocrData.date)) {
    const dateInOcrDates = ocrData.dates && (
      ocrData.dates.received === ocrData.date ||
      ocrData.dates.revised === ocrData.date ||
      ocrData.dates.accepted === ocrData.date ||
      ocrData.dates.published === ocrData.date ||
      (ocrData.dates.other && ocrData.dates.other.includes(ocrData.date))
    );
    // 只有当日期确实在OCR dates中出现过时才添加
    if (dateInOcrDates) {
      ocrDates.push({ type: 'General', date: ocrData.date, priority: 4 });
    }
  }
  
  // 标准化所有PDF日期
  const pdfDatesNormalized = pdfDates.map(d => ({
    ...d,
    normalized: normalizeDate(d.date)
  })).filter(d => d.normalized);
  
  // 标准化所有OCR日期
  const ocrDatesNormalized = ocrDates.map(d => ({
    ...d,
    normalized: normalizeDate(d.date)
  })).filter(d => d.normalized);
  
  // 查找匹配的日期 - 优先匹配Received日期，如果没有再匹配Published
  let pdfDateMatch = null;
  let ocrDateMatch = null;
  
  if (webDateNormalized) {
    // 在PDF日期中查找匹配 - 优先匹配Received，然后Published，最后其他
    const sortedPdfDates = pdfDatesNormalized.sort((a, b) => a.priority - b.priority);
    pdfDateMatch = sortedPdfDates.find(d => d.normalized === webDateNormalized);
    
    // 在OCR日期中查找匹配 - 优先匹配Received，然后Published，最后其他
    const sortedOcrDates = ocrDatesNormalized.sort((a, b) => a.priority - b.priority);
    ocrDateMatch = sortedOcrDates.find(d => d.normalized === webDateNormalized);
  }
  
  // 判断日期是否匹配（只要有一个匹配就算成功）
  const dateMatch = !!(pdfDateMatch || ocrDateMatch);
  
  // 标题匹配（模糊匹配）
  let titleMatch = false;
  let titleMatchType = null; // 'pdf' 或 'ocr'
  const webTitle = (webData.title || '').trim().toLowerCase();
  const pdfTitle = (pdfTextData.title || '').trim().toLowerCase();
  const ocrTitle = (ocrData.title || '').trim().toLowerCase();
  
  if (webTitle && (pdfTitle || ocrTitle)) {
    // 简单的相似度检查：去除标点符号和空格后比较
    const normalizeTitle = (title) => title.replace(/[^\w\u4e00-\u9fa5]/g, '').toLowerCase();
    const webTitleNorm = normalizeTitle(webTitle);
    
    // 计算相似度的辅助函数
    const calculateSimilarity = (str1, str2) => {
      const longer = str1.length > str2.length ? str1 : str2;
      const shorter = str1.length > str2.length ? str2 : str1;
      if (longer.length === 0) return 1.0;
      
      // 检查包含关系
      if (longer.includes(shorter)) {
        return shorter.length / longer.length;
      }
      
      // 检查前N个字符匹配（支持部分匹配）
      const minLength = Math.min(str1.length, str2.length);
      let matchCount = 0;
      for (let i = 0; i < minLength; i++) {
        if (str1[i] === str2[i]) {
          matchCount++;
        } else {
          break;
        }
      }
      return matchCount / longer.length;
    };
    
    // 检查标题是否匹配的辅助函数
    const checkTitleMatch = (webTitleNorm, pdfTitleNorm) => {
      if (!webTitleNorm || !pdfTitleNorm) {
        console.log('[验证] 标题为空，不匹配');
        return false;
      }
      
      // 如果标题太短，不匹配
      if (webTitleNorm.length < 10 || pdfTitleNorm.length < 10) {
        console.log('[验证] 标题太短，不匹配:', { webLength: webTitleNorm.length, pdfLength: pdfTitleNorm.length });
        return false;
      }
      
      // 完全匹配
      if (webTitleNorm === pdfTitleNorm) return true;
      
      // 包含关系（一个包含另一个）- 更严格的条件
      if (webTitleNorm.includes(pdfTitleNorm) || pdfTitleNorm.includes(webTitleNorm)) {
        // 如果较短的标题长度 >= 较长标题的60%，且较短标题至少30个字符，认为是匹配
        const shorter = webTitleNorm.length < pdfTitleNorm.length ? webTitleNorm : pdfTitleNorm;
        const longer = webTitleNorm.length >= pdfTitleNorm.length ? webTitleNorm : pdfTitleNorm;
        const ratio = shorter.length / longer.length;
        if (shorter.length >= 30 && ratio >= 0.6) {
          console.log('[验证] 标题包含匹配:', { shorter: shorter.substring(0, 50), longer: longer.substring(0, 50), ratio: ratio.toFixed(2) });
          return true;
        } else {
          console.log('[验证] 标题包含但比例不足:', { shorter: shorter.substring(0, 50), longer: longer.substring(0, 50), ratio: ratio.toFixed(2), minLength: shorter.length });
        }
      }
      
      // 相似度检查 - 更严格的条件
      const similarity = calculateSimilarity(webTitleNorm, pdfTitleNorm);
      if (similarity > 0.75 && webTitleNorm.length >= 20 && pdfTitleNorm.length >= 20) {
        console.log('[验证] 标题相似度匹配:', { similarity: similarity.toFixed(2), webLength: webTitleNorm.length, pdfLength: pdfTitleNorm.length });
        return true;
      } else if (similarity > 0.7) {
        console.log('[验证] 标题相似度不足或长度不够:', { similarity: similarity.toFixed(2), webLength: webTitleNorm.length, pdfLength: pdfTitleNorm.length });
      }
      
      // 前70%字符匹配（对于较长的标题，至少30个字符）
      if (webTitleNorm.length >= 30 && pdfTitleNorm.length >= 30) {
        const webPrefix = webTitleNorm.substring(0, Math.floor(webTitleNorm.length * 0.7));
        const pdfPrefix = pdfTitleNorm.substring(0, Math.floor(pdfTitleNorm.length * 0.7));
        if (webPrefix === pdfPrefix && webPrefix.length >= 30) {
          console.log('[验证] 标题前缀匹配（70%，至少30字符）');
          return true;
        }
      }
      
      // 对于OCR标题，如果OCR标题是网页标题的前缀（至少50个字符，且相似度>0.8），也认为匹配
      if (pdfTitleNorm.length >= 50 && webTitleNorm.length >= 50) {
        const prefixLength = Math.min(50, pdfTitleNorm.length);
        const webPrefix = webTitleNorm.substring(0, prefixLength);
        const pdfPrefix = pdfTitleNorm.substring(0, prefixLength);
        const prefixSimilarity = calculateSimilarity(webPrefix, pdfPrefix);
        if (prefixSimilarity > 0.8) {
          console.log('[验证] OCR标题前缀匹配（50字符，相似度>0.8）');
        return true;
      }
      }
      
      // 如果网页标题是OCR标题的前缀（至少50个字符，且相似度>0.8），也认为匹配
      if (webTitleNorm.length >= 50 && pdfTitleNorm.length >= 50) {
        const prefixLength = Math.min(50, webTitleNorm.length);
        const webPrefix = webTitleNorm.substring(0, prefixLength);
        const pdfPrefix = pdfTitleNorm.substring(0, prefixLength);
        const prefixSimilarity = calculateSimilarity(webPrefix, pdfPrefix);
        if (prefixSimilarity > 0.8) {
          console.log('[验证] 网页标题前缀匹配（50字符，相似度>0.8）');
        return true;
        }
      }
      
      console.log('[验证] 标题不匹配，所有条件都不满足');
      return false;
    };
    
    // 优先检查OCR标题（因为OCR通常更准确，特别是当PDF元数据是文件名时）
    if (ocrTitle && ocrTitle.trim().length > 10) {
      const ocrTitleNorm = normalizeTitle(ocrTitle);
      console.log('[验证] 检查OCR标题匹配:', { webTitleNorm, ocrTitleNorm });
      if (checkTitleMatch(webTitleNorm, ocrTitleNorm)) {
        titleMatch = true;
        titleMatchType = 'ocr';
        console.log('[验证] ✓ OCR标题匹配成功');
      } else {
        console.log('[验证] ✗ OCR标题不匹配');
      }
    }
    
    // 如果OCR没匹配，再检查PDF标题
    if (!titleMatch && pdfTitle && pdfTitle.trim().length > 5) {
      const pdfTitleNorm = normalizeTitle(pdfTitle);
      console.log('[验证] 检查PDF标题匹配:', { webTitleNorm, pdfTitleNorm });
      
      // 如果PDF标题看起来像文件名（如"View Letter"、"accept"等），跳过
      const filenamePatterns = [/^view\s*(letter|pdf|file)$/i, /^accept/i, /^download/i, /^file/i, /^document/i];
      const isLikelyFilename = filenamePatterns.some(pattern => pattern.test(pdfTitle));
      
      if (!isLikelyFilename && checkTitleMatch(webTitleNorm, pdfTitleNorm)) {
        titleMatch = true;
        titleMatchType = 'pdf';
        console.log('[验证] ✓ PDF标题匹配成功');
      } else if (isLikelyFilename) {
        console.log('[验证] PDF标题看起来像文件名，跳过匹配:', pdfTitle);
      } else {
        console.log('[验证] ✗ PDF标题不匹配');
      }
    }
  }
  
  // 作者匹配（详细匹配，包括第一作者和共一作者）
  let authorMatch = false;
  let authorMatchType = null; // 'first' 或 'equal'
  let authorMatchSource = null; // 'pdf' 或 'ocr'
  let equalContributionStatement = null; // 共一作者的描述语句
  
  const webAuthor = (webData.firstAuthor || '').trim();
  const pdfAuthor = (pdfTextData.firstAuthor || '').trim();
  const ocrAuthor = (ocrData.firstAuthor || '').trim();
  
  // 辅助函数：转换中文为拼音（简化版，用于background.js）
  function convertChineseToPinyinSimple(chinese) {
    if (!chinese || typeof chinese !== 'string') return '';
    if (!/[\u4e00-\u9fa5]/.test(chinese)) return chinese;
    
    const pinyinMap = {
      '邓': 'Deng', '广': 'Guang', '川': 'Chuan', '何': 'He', '李': 'Li', '王': 'Wang',
      '张': 'Zhang', '刘': 'Liu', '陈': 'Chen', '杨': 'Yang', '赵': 'Zhao', '黄': 'Huang',
      '周': 'Zhou', '吴': 'Wu', '徐': 'Xu', '孙': 'Sun', '胡': 'Hu', '朱': 'Zhu',
      '高': 'Gao', '林': 'Lin', '郭': 'Guo', '马': 'Ma', '罗': 'Luo', '梁': 'Liang',
      '宋': 'Song', '郑': 'Zheng', '谢': 'Xie', '韩': 'Han', '唐': 'Tang', '冯': 'Feng',
      '于': 'Yu', '董': 'Dong', '萧': 'Xiao', '程': 'Cheng', '曹': 'Cao', '袁': 'Yuan',
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
      '轩': 'Xuan', '简': 'Jian', '伟': 'Wei', '肇': 'Zhao', '优': 'You', '卫': 'Wei',
      '佳': 'Jia', '俊': 'Jun', '飞': 'Fei', '立': 'Li', '炜': 'Wei',
      '广': 'Guang', '川': 'Chuan', '学': 'Xue', '伟': 'Wei',
      '萌': 'Meng', '史': 'Shi'
    };
    
    let pinyin = '';
    for (const char of chinese) {
      if (pinyinMap[char]) {
        pinyin += pinyinMap[char].charAt(0).toUpperCase() + pinyinMap[char].slice(1) + ' ';
      } else if (/[\u4e00-\u9fa5]/.test(char)) {
        // 如果是中文但不在映射表中，尝试保留
        pinyin += char;
      } else {
        pinyin += char;
      }
    }
    let result = pinyin.replace(/\s+/g, ' ').trim();
    
    // 处理连续重复的名字部分（如"Wang Meng Meng" -> "Wang Mengmeng"）
    // 与Python脚本逻辑完全一致
    const words = result.split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
      // 扩展常见姓氏列表（与Python脚本一致）
      const commonSurnames = ['wang', 'zhang', 'li', 'liu', 'chen', 'yang', 'zhao', 'huang',
                            'zhou', 'wu', 'xu', 'sun', 'hu', 'zhu', 'gao', 'lin', 'guo', 'deng', 'he', 'shi',
                            'tian', 'deng', 'ma', 'luo', 'liang', 'song', 'zheng', 'xie', 'han', 'tang', 'feng',
                            'yu', 'dong', 'xiao', 'cheng', 'cao', 'yuan', 'xu', 'fu', 'shen', 'zeng', 'peng',
                            'lv', 'su', 'lu', 'jiang', 'cai', 'jia', 'ding', 'wei', 'xue', 'ye', 'yan', 'pan',
                            'ji', 'ji'];
      const firstWord = words[0].toLowerCase();
      
      if (commonSurnames.includes(firstWord)) {
        // 姓在前：合并后面的词作为名（如"Tian Ji Chen" -> "Tian Jichen"）
        const surname = words[0];
        const givenName = words.slice(1).join('');
        result = surname + ' ' + givenName;
      } else {
        // 检查是否是名在前，姓在后
        const lastWord = words[words.length - 1].toLowerCase();
        if (commonSurnames.includes(lastWord)) {
          // 名在前，姓在后：合并前面的词作为名（如"Ji Chen Tian" -> "Tian Jichen"）
          const givenName = words.slice(0, -1).join('');
          const surname = words[words.length - 1];
          result = surname + ' ' + givenName;
        } else {
          // 尝试合并连续相同的词
          const merged = [];
          for (let i = 0; i < words.length; i++) {
            if (i > 0 && words[i].toLowerCase() === words[i-1].toLowerCase()) {
              continue;
            }
            merged.push(words[i]);
          }
          result = merged.join(' ');
        }
      }
    }
    
    console.log('[验证] 拼音转换结果:', chinese, '->', result);
    return result;
  }
  
  // 转换中文作者为拼音
  let webAuthorForMatch = webAuthor;
  let webAuthorVariants = [webAuthor]; // 存储所有可能的变体（包括原始和转换后的）
  
  if (webAuthor && /[\u4e00-\u9fa5]/.test(webAuthor)) {
    // 优先使用 pinyin-pro（如果可用）
    if (typeof convertChineseToPinyin === 'function') {
      try {
        // 使用同步方式：如果 pinyin-pro 已加载，直接使用；否则使用 fallback
        // 注意：在 background script 中，pinyin-pro 的加载是异步的，但转换可以是同步的
        // 如果库已加载，尝试同步调用；否则使用 fallback
        const pinyinLib = (typeof self !== 'undefined' && self.pinyinPro) || 
                         (typeof globalThis !== 'undefined' && globalThis.pinyinPro);
        if (pinyinLib && typeof pinyinLib.pinyin === 'function') {
          // pinyin-pro 已加载，同步调用
          const result = pinyinLib.pinyin(webAuthor, {
            toneType: 'none',
            type: 'all',
            v: true
          });
          const words = result.split(/\s+/).filter(w => w.length > 0);
          if (words.length > 0) {
            const capitalized = words.map(w => w.charAt(0).toUpperCase() + w.slice(1));
            webAuthorForMatch = capitalized.join(' ');
            console.log('[验证] 中文作者转拼音（pinyin-pro）:', webAuthor, '->', webAuthorForMatch);
          } else {
            webAuthorForMatch = convertChineseToPinyinSimple(webAuthor);
            console.log('[验证] 中文作者转拼音（pinyin-pro 结果为空，使用 fallback）:', webAuthor, '->', webAuthorForMatch);
          }
        } else {
          // pinyin-pro 未加载，使用 fallback
          webAuthorForMatch = convertChineseToPinyinSimple(webAuthor);
          console.log('[验证] 中文作者转拼音（pinyin-pro 未加载，使用 fallback）:', webAuthor, '->', webAuthorForMatch);
        }
      } catch (error) {
        console.warn('[验证] pinyin-pro 转换失败，使用 fallback:', error);
        webAuthorForMatch = convertChineseToPinyinSimple(webAuthor);
        console.log('[验证] 中文作者转拼音（fallback）:', webAuthor, '->', webAuthorForMatch);
      }
    } else {
      // 如果 pinyin-pro 未加载，使用 fallback
      webAuthorForMatch = convertChineseToPinyinSimple(webAuthor);
      console.log('[验证] 中文作者转拼音（fallback）:', webAuthor, '->', webAuthorForMatch);
    }
    
    // 生成所有可能的变体：姓在前和名在前
    const words = webAuthorForMatch.split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
      // 变体1：姓在前（如"Wang Mengmeng"）
      webAuthorVariants.push(words[0] + ' ' + words.slice(1).join(''));
      // 变体2：名在前（如"Mengmeng Wang"）
      webAuthorVariants.push(words.slice(1).join('') + ' ' + words[0]);
    } else {
      webAuthorVariants.push(webAuthorForMatch);
    }
    console.log('[验证] 作者名变体:', webAuthorVariants);
  } else {
    // 即使不是中文，也生成变体（姓在前和名在前）
    const words = (webAuthor || '').split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
      webAuthorVariants.push(words[0] + ' ' + words.slice(1).join(' '));
      webAuthorVariants.push(words.slice(1).join(' ') + ' ' + words[0]);
    }
  }
  
  // 辅助函数：检查两个作者名是否匹配（与Python脚本逻辑完全一致）
  function checkAuthorMatch(webAuthorName, pdfAuthorName) {
    if (!webAuthorName || !pdfAuthorName) {
      console.log('[验证] checkAuthorMatch: 缺少参数', { webAuthorName, pdfAuthorName });
      return false;
    }
    
    // 标准化：转小写，移除标点，保留空格，去除首尾空格
    const webNorm = (webAuthorName || '').toString().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    const pdfNorm = (pdfAuthorName || '').toString().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    
    console.log('[验证] checkAuthorMatch: 标准化后', { webNorm, pdfNorm });
    
    if (!webNorm || !pdfNorm || webNorm.length === 0 || pdfNorm.length === 0) {
      console.log('[验证] checkAuthorMatch: 标准化后为空');
      return false;
    }
    
    const webWords = webNorm.split(/\s+/).filter(w => w.length > 0);
    const pdfWords = pdfNorm.split(/\s+/).filter(w => w.length > 0);
    
    console.log('[验证] checkAuthorMatch: 分词后', { webWords, pdfWords });
    
    // 必须至少有两个词（姓和名）
    if (webWords.length < 2 || pdfWords.length < 2) {
      // 如果只有一个词，直接比较
      const result = webNorm === pdfNorm;
      console.log('[验证] checkAuthorMatch: 单词比较', result);
      return result;
    }
    
    // 方法1：完全匹配（顺序相同）
    if (webNorm === pdfNorm) {
      console.log('[验证] checkAuthorMatch: ✓ 完全匹配成功');
      return true;
    }
    
    // 方法2：顺序无关匹配（所有词都匹配）
    const allWebInPdf = webWords.every(w => pdfWords.includes(w));
    const allPdfInWeb = pdfWords.every(w => webWords.includes(w));
    
    if (allWebInPdf && allPdfInWeb) {
      // 如果词数相同，完全匹配
      if (webWords.length === pdfWords.length) {
        console.log('[验证] checkAuthorMatch: ✓ 顺序互换匹配成功（词数相同）');
        return true;
      }
      // 如果词数不同，但所有词都匹配，也认为匹配（例如："tian ji chen" vs "jichen tian"）
      if (webWords.length >= 2 && pdfWords.length >= 2) {
        const matchedCount = webWords.filter(w => pdfWords.includes(w)).length;
        console.log('[验证] checkAuthorMatch: 词数不同但匹配检查', { matchedCount, webWords, pdfWords });
        if (matchedCount >= 2) {
          console.log('[验证] checkAuthorMatch: ✓ 顺序互换匹配成功（词数不同但所有词匹配）');
          return true;
        }
      }
    }
    
    // 方法3：姓和名部分匹配（支持包含关系，如"jichen" in "jichena"）
    if (webWords.length >= 2 && pdfWords.length >= 2) {
      const webSurname = webWords[0];
      const webGiven = webWords.slice(1).join(''); // 合并名部分
      
      // PDF可能是姓在前或名在前
      const pdfSurnameFirst = pdfWords[0];
      const pdfGivenFirst = pdfWords.slice(1).join('');
      const pdfSurnameLast = pdfWords[pdfWords.length - 1];
      const pdfGivenLast = pdfWords.slice(0, -1).join('');
      
      // 检查：姓匹配 + 名匹配（支持包含关系）
      const surnameMatchFirst = (webSurname === pdfSurnameFirst || 
                                 webSurname.includes(pdfSurnameFirst) || 
                                 pdfSurnameFirst.includes(webSurname));
      const givenMatchFirst = (webGiven === pdfGivenFirst || 
                              webGiven.includes(pdfGivenFirst) || 
                              pdfGivenFirst.includes(webGiven));
      
      const surnameMatchLast = (webSurname === pdfSurnameLast || 
                               webSurname.includes(pdfSurnameLast) || 
                               pdfSurnameLast.includes(webSurname));
      const givenMatchLast = (webGiven === pdfGivenLast || 
                             webGiven.includes(pdfGivenLast) || 
                             pdfGivenLast.includes(webGiven));
      
      // 情况1：姓在前，姓在前（顺序相同）
      if (surnameMatchFirst && givenMatchFirst) {
        console.log('[验证] checkAuthorMatch: ✓ 匹配成功（姓在前，姓在前，顺序相同）');
        return true;
      }
      
      // 情况2：姓在前，名在前（顺序相反）
      if (surnameMatchLast && givenMatchLast) {
        console.log('[验证] checkAuthorMatch: ✓ 匹配成功（姓在前，名在前，顺序相反）');
        return true;
      }
    }
    
    // 方法4：包含匹配（双向）
    if (pdfNorm.includes(webNorm) || webNorm.includes(pdfNorm)) {
      console.log('[验证] checkAuthorMatch: ✓ 包含匹配成功');
      return true;
    }
    
    console.log('[验证] checkAuthorMatch: ✗ 所有匹配方法都失败');
    return false;
  }
  
  // 检查是否为第一作者匹配（只匹配webAuthor和pdfAuthor/ocrAuthor，不匹配pdfAuthor和ocrAuthor之间）
  if (webAuthorVariants && webAuthorVariants.length > 0) {
    // 匹配PDF作者 - 尝试所有变体
    if (pdfAuthor && pdfAuthor.trim()) {
      console.log('[验证] 开始匹配作者（PDF）:', {
        webAuthor: webAuthor,
        webAuthorVariants: webAuthorVariants,
        pdfAuthor: pdfAuthor
      });
      
      for (const variant of webAuthorVariants) {
        if (!variant || !variant.trim()) continue;
        const matched = checkAuthorMatch(variant, pdfAuthor);
        if (matched) {
          authorMatch = true;
          authorMatchType = 'first';
          authorMatchSource = 'pdf';
          console.log('[验证] ✓ 作者匹配成功（PDF）:', webAuthor, '->', variant, '<->', pdfAuthor);
          break;
        }
      }
      
      if (!authorMatch) {
        console.log('[验证] ✗ 作者不匹配（PDF）: 所有变体都未匹配', {
          webAuthor: webAuthor,
          variants: webAuthorVariants,
          pdfAuthor: pdfAuthor
        });
      }
    } else {
      console.log('[验证] PDF作者为空，跳过匹配');
    }
    
    // 如果PDF没匹配，尝试OCR作者 - 尝试所有变体
    if (!authorMatch && ocrAuthor && ocrAuthor.trim()) {
      for (const variant of webAuthorVariants) {
        if (!variant || !variant.trim()) continue;
        const matched = checkAuthorMatch(variant, ocrAuthor);
        if (matched) {
          authorMatch = true;
          authorMatchType = 'first';
          authorMatchSource = 'ocr';
          console.log('[验证] ✓ 作者匹配成功（OCR）:', webAuthor, '->', variant, '<->', ocrAuthor);
          break;
        }
      }
      
      if (!authorMatch) {
        console.log('[验证] ✗ 作者不匹配（OCR）: 所有变体都未匹配', {
          webAuthor: webAuthor,
          variants: webAuthorVariants,
          ocrAuthor: ocrAuthor
        });
      }
    }
  }
  
  // 检查是否为共一作者匹配
  if (!authorMatch && webAuthorForMatch && webAuthorForMatch.trim()) {
    // 检查PDF中的共一作者信息
    if (pdfTextData.hasEqualContribution && pdfTextData.equalContributionAuthors && pdfTextData.equalContributionAuthors.length > 0) {
      for (const ecAuthor of pdfTextData.equalContributionAuthors) {
        if (!ecAuthor || !ecAuthor.trim()) continue;
        
        const matched = checkAuthorMatch(webAuthorForMatch, ecAuthor);
        if (matched) {
          authorMatch = true;
          authorMatchType = 'equal';
          authorMatchSource = 'pdf';
          // 提取共一作者的描述语句
          if (pdfTextData.text) {
            const equalPatterns = [
              /contributed equally[^.]*/i,
              /equal contribution[^.]*/i,
              /equally contributed[^.]*/i,
              /These authors contributed equally[^.]*/i
            ];
            for (const pattern of equalPatterns) {
              const match = pdfTextData.text.match(pattern);
              if (match) {
                equalContributionStatement = match[0].trim();
                break;
              }
            }
          }
          break;
        }
      }
    }
    
    // 检查OCR中的共一作者信息
    if (!authorMatch && ocrData.hasEqualContribution && ocrData.equalContributionAuthors && ocrData.equalContributionAuthors.length > 0) {
      for (const ecAuthor of ocrData.equalContributionAuthors) {
        if (!ecAuthor || !ecAuthor.trim()) continue;
        
        const matched = checkAuthorMatch(webAuthorForMatch, ecAuthor);
        if (matched) {
          authorMatch = true;
          authorMatchType = 'equal';
          authorMatchSource = 'ocr';
          // 提取共一作者的描述语句
          if (ocrData.text) {
            const equalPatterns = [
              /contributed equally[^.]*/i,
              /equal contribution[^.]*/i,
              /equally contributed[^.]*/i,
              /These authors contributed equally[^.]*/i
            ];
            for (const pattern of equalPatterns) {
              const match = ocrData.text.match(pattern);
              if (match) {
                equalContributionStatement = match[0].trim();
                break;
              }
            }
          }
          break;
        }
      }
    }
  }
  
  const result = {
    authorMatch: authorMatch,
    authorMatchType: authorMatchType, // 'first' 或 'equal'
    authorMatchSource: authorMatchSource, // 'pdf' 或 'ocr'
    equalContributionStatement: equalContributionStatement,
    dateMatch: dateMatch,
    titleMatch: titleMatch,
    titleMatchType: titleMatchType, // 'pdf' 或 'ocr'
    dateMatchDetails: {
      webDate: webData.date || '',
      webDateNormalized: webDateNormalized,
      pdfDateMatch: pdfDateMatch ? { type: pdfDateMatch.type, original: pdfDateMatch.date, normalized: pdfDateMatch.normalized } : null,
      ocrDateMatch: ocrDateMatch ? { type: ocrDateMatch.type, original: ocrDateMatch.date, normalized: ocrDateMatch.normalized } : null,
      allPdfDates: pdfDatesNormalized.map(d => ({ type: d.type, original: d.date, normalized: d.normalized })),
      allOcrDates: ocrDatesNormalized.map(d => ({ type: d.type, original: d.date, normalized: d.normalized }))
    },
    authorMatchDetails: {
      webAuthor: webAuthor,
      pdfFirstAuthor: pdfAuthor,
      ocrFirstAuthor: ocrAuthor,
      pdfEqualContributionAuthors: pdfTextData.equalContributionAuthors || [],
      ocrEqualContributionAuthors: ocrData.equalContributionAuthors || []
    },
    titleMatchDetails: {
      webTitle: webData.title || '',
      pdfTitle: pdfTextData.title || '',
      ocrTitle: ocrData.title || ''
    },
    details: {
      webAuthor: webData.firstAuthor || '',
      webAllAuthors: webData.allAuthors || [],
      pdfTextAuthor: pdfTextData.firstAuthor || '',
      pdfTextAllAuthors: pdfTextData.allAuthors || [],
      ocrAuthor: ocrData.firstAuthor || '',
      ocrAllAuthors: ocrData.allAuthors || [],
      webDate: webData.date || '',
      pdfTextDate: pdfTextData.date || '',
      ocrDate: ocrData.date || '',
      webTitle: webData.title || '',
      pdfTextTitle: pdfTextData.title || '',
      ocrTitle: ocrData.title || '',
      // 详细的日期信息
      webDates: webData.dates || null,
      pdfTextDates: pdfTextData.dates || null,
      ocrDates: ocrData.dates || null
    }
  };
  
  return result;
}

// 处理图像OCR识别
async function handleImageOcr(imageUrl, pageUrl, pageTitle) {
  try {
    console.log('[图像OCR] 开始识别图像:', imageUrl);
    
    // 通知content script执行OCR（需要在页面上下文中执行）
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });
    
    if (!tabs || !tabs[0]) {
      throw new Error('无法获取当前标签页');
    }
    
    // 发送消息到content script执行OCR
    const ocrResult = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'performImageOcr',
        imageUrl: imageUrl
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response.result);
        } else {
          reject(new Error(response?.error || 'OCR识别失败'));
        }
      });
    });
    
    console.log('[图像OCR] 识别完成:', ocrResult);
    
    // 从OCR结果中提取作者和日期
    const extracted = extractFromOcrText(ocrResult.text);
    
    const result = {
      imageUrl: imageUrl,
      pageUrl: pageUrl,
      pageTitle: pageTitle,
      ocrText: ocrResult.text,
      extractedAuthor: extracted.firstAuthor,
      extractedDate: extracted.date,
      timestamp: new Date().toISOString()
    };
    
    // 保存OCR结果
    chrome.storage.local.get(['ocrResults'], (storageResult) => {
      const results = storageResult.ocrResults || [];
      results.push(result);
      chrome.storage.local.set({ ocrResults: results });
    });
    
    // 显示通知
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '图像OCR识别完成',
        message: `作者: ${extracted.firstAuthor || '未识别'} | 日期: ${extracted.date || '未识别'}`
      });
    } catch (e) {
      console.log('[图像OCR] 通知创建失败（可能未授权）:', e);
    }
    
    return result;
    
  } catch (error) {
    console.error('[图像OCR] 识别失败:', error);
    throw error;
  }
}

// 从OCR文本中提取信息
function extractFromOcrText(ocrText) {
  const result = {
    firstAuthor: null,
    date: null
  };
  
  if (!ocrText) return result;
  
  // 提取作者（常见模式）
  const authorPatterns = [
    /^([A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+)/,  // First M. Last
    /^([A-Z][a-z]+, [A-Z]\.)/,              // Last, F.
    /Author[s]?:\s*([^\n]+)/i,
    /By:\s*([^\n]+)/i,
    /([A-Z][a-z]+ [A-Z][a-z]+)/            // 简单格式
  ];
  
  for (const pattern of authorPatterns) {
    const match = ocrText.match(pattern);
    if (match) {
      result.firstAuthor = match[1].trim();
      break;
    }
  }
  
  // 提取日期
  const datePatterns = [
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/g,  // YYYY-MM-DD
    /(\d{1,2}[-/]\d{1,2}[-/]\d{4})/g,  // MM-DD-YYYY
    /([A-Z][a-z]+ \d{1,2}, \d{4})/g,   // Month DD, YYYY
    /(\d{4})/g                          // YYYY
  ];
  
  for (const pattern of datePatterns) {
    const match = ocrText.match(pattern);
    if (match) {
      result.date = match[0];
      break;
    }
  }
  
  return result;
}

// 一键处理论文：自动执行所有步骤
async function handleQuickProcess(pdfUrl, pageUrl, pageTitle, pageMetadata) {
  try {
    console.log('[一键处理] 开始处理论文:', pageMetadata?.title || '未知');
    console.log('[一键处理] PDF URL:', pdfUrl);
    
    // 对于arXiv页面，优先使用页面元数据，立即开始下载
    let paperInfo = null;
    
    // 步骤1：使用页面元数据构建基础信息（立即可用）
    if (pageMetadata) {
      paperInfo = {
        title: pageMetadata.title || '待提取',
        author: pageMetadata.authors ? pageMetadata.authors.join(', ') : '待提取',
        keywords: [],
        extractedDate: pageMetadata.date || '待提取',
        firstAuthor: pageMetadata.firstAuthor || (pageMetadata.authors && pageMetadata.authors[0]) || '待提取',
        first500Chars: '',
        arxivId: pageMetadata.arxivId || ''
      };
      console.log('[一键处理] 使用页面元数据:', paperInfo);
    } else {
      paperInfo = {
        title: '待提取',
        author: '待提取',
        keywords: [],
        extractedDate: '待提取',
        firstAuthor: '待提取',
        first500Chars: ''
      };
    }
    
    // 步骤0：在开始处理前，先检查是否重复
    // 先从storage同步最新数据
    const storedPapers = await new Promise((resolve) => {
      chrome.storage.local.get(['papers'], (result) => {
        const papers = result.papers || [];
        // 同步到内存变量
        downloadedPapers = papers;
        console.log('[一键处理] 从storage同步数据，当前记录数:', downloadedPapers.length);
        resolve(papers);
      });
    });
    
    const duplicateCheck = checkPaperDuplicate(paperInfo, pdfUrl);
    if (duplicateCheck.duplicate) {
      console.log('[一键处理] 检测到重复论文，停止处理:', duplicateCheck.reason);
      const existingPaper = duplicateCheck.existingPaper;
      const duplicateMessage = `该论文已经下载过！\n\n` +
        `原因: ${duplicateCheck.reason}\n\n` +
        `已存在的论文信息:\n` +
        `标题: ${existingPaper.title || '未知'}\n` +
        `第一作者: ${existingPaper.firstAuthor || '未知'}\n` +
        `下载时间: ${existingPaper.downloadTime ? new Date(existingPaper.downloadTime).toLocaleString('zh-CN') : '未知'}\n` +
        `文件名: ${existingPaper.filename || '未知'}`;
      
      // 返回错误信息，让popup.js显示弹窗
      throw new Error(duplicateMessage);
    }
    
    // 步骤2：立即开始下载（不等待解析）
    const downloadPromise = downloadAndRename(pdfUrl, paperInfo, pageUrl, pageTitle);
    
    // 步骤3：异步进行PDF解析（不阻塞下载）
    const parsePromise = (async () => {
      try {
        await loadPdfJs();
        if (pdfjsLib) {
          const pdfInfo = await parsePdfFromUrl(pdfUrl);
          console.log('[一键处理] PDF解析完成:', pdfInfo);
          
          // 如果PDF解析成功，更新信息
          if (pdfInfo && pdfInfo.title && pdfInfo.title !== '待提取') {
            paperInfo.title = pdfInfo.title;
          }
          if (pdfInfo && pdfInfo.firstAuthor && pdfInfo.firstAuthor !== '待提取') {
            paperInfo.firstAuthor = pdfInfo.firstAuthor;
          }
          if (pdfInfo && pdfInfo.allAuthors && pdfInfo.allAuthors.length > 0) {
            paperInfo.allAuthors = pdfInfo.allAuthors;
          }
          if (pdfInfo && pdfInfo.hasEqualContribution !== undefined) {
            paperInfo.hasEqualContribution = pdfInfo.hasEqualContribution;
          }
          if (pdfInfo && pdfInfo.equalContributionAuthors && pdfInfo.equalContributionAuthors.length > 0) {
            paperInfo.equalContributionAuthors = pdfInfo.equalContributionAuthors;
          }
          if (pdfInfo && pdfInfo.firstAuthorHasEqual !== undefined) {
            paperInfo.firstAuthorHasEqual = pdfInfo.firstAuthorHasEqual;
          }
          if (pdfInfo && pdfInfo.dates) {
            // 合并日期信息（PDF解析的优先）
            if (pdfInfo.dates.received) paperInfo.dates.received = pdfInfo.dates.received;
            if (pdfInfo.dates.accepted) paperInfo.dates.accepted = pdfInfo.dates.accepted;
            if (pdfInfo.dates.published) paperInfo.dates.published = pdfInfo.dates.published;
            if (pdfInfo.dates.other && pdfInfo.dates.other.length > 0) {
              paperInfo.dates.other = pdfInfo.dates.other;
            }
            // 更新兼容字段
            paperInfo.extractedDate = pdfInfo.dates.received || pdfInfo.dates.accepted || pdfInfo.dates.published || paperInfo.extractedDate;
          } else if (pdfInfo && pdfInfo.extractedDate && pdfInfo.extractedDate !== '待提取') {
            paperInfo.extractedDate = pdfInfo.extractedDate;
          }
          
          return pdfInfo;
        }
      } catch (error) {
        console.log('[一键处理] PDF解析失败（不影响下载）:', error);
      }
      return null;
    })();
    
    // 步骤4：异步进行OCR识别（不阻塞下载）
    const ocrPromise = (async () => {
      try {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, resolve);
        });
        
        if (tabs && tabs[0]) {
          const ocrResult = await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'performOcr',
              pdfUrl: pdfUrl
            }, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            });
          });
          
          console.log('[一键处理] OCR识别完成');
          return ocrResult;
        }
      } catch (error) {
        console.log('[一键处理] OCR识别跳过（不影响下载）:', error);
      }
      return null;
    })();
    
    // 等待下载完成
    await downloadPromise;
    console.log('[一键处理] 下载完成');
    
    // 等待解析和OCR完成（可选）
    const [pdfInfo, ocrData] = await Promise.allSettled([parsePromise, ocrPromise]);
    
    // 步骤5：执行匹配验证（可选）
    let matchResult = null;
    if (pageMetadata) {
      const finalPdfInfo = pdfInfo.status === 'fulfilled' ? pdfInfo.value : null;
      const finalOcrData = ocrData.status === 'fulfilled' ? ocrData.value : null;
      
      matchResult = matchVerification(
        {
          firstAuthor: pageMetadata.firstAuthor || '',
          date: pageMetadata.date || ''
        },
        finalPdfInfo ? { firstAuthor: finalPdfInfo.firstAuthor, date: finalPdfInfo.extractedDate } : { firstAuthor: '', date: '' },
        finalOcrData ? { firstAuthor: finalOcrData.firstAuthor, date: finalOcrData.date } : { firstAuthor: '', date: '' }
      );
      console.log('[一键处理] 匹配验证完成:', matchResult);
    }
    
    return {
      paperInfo: paperInfo,
      ocrData: ocrData.status === 'fulfilled' ? ocrData.value : null,
      matchResult: matchResult,
      success: true
    };
    
  } catch (error) {
    console.error('[一键处理] 处理失败:', error);
    throw error;
  }
}

// 验证下载的文件
async function verifyDownloadedFile(download, fileInfo, webMetadata) {
  try {
    console.log('[下载验证] 开始验证文件:', download.filename);
    
    const filePath = download.filename;
    const isPdf = fileInfo.isPdf || filePath.toLowerCase().endsWith('.pdf');
    const isImage = fileInfo.isImage || /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(filePath);
    
    let extractedData = null;
    
    if (isPdf) {
      // PDF文件：使用PDF解析
      console.log('[下载验证] 使用PDF解析验证');
      try {
        // 将文件路径转换为file:// URL
        const fileUrl = 'file://' + filePath.replace(/\\/g, '/');
        
        // 发送到content script解析PDF
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, resolve);
        });
        
        if (tabs && tabs[0]) {
          const pdfResult = await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'parsePdf',
              pdfUrl: fileUrl
            }, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            });
          });
          
          if (pdfResult && pdfResult.success) {
            extractedData = {
              title: pdfResult.title || '',
              firstAuthor: pdfResult.author || '',
              authors: pdfResult.author ? pdfResult.author.split(/[;,&]/).map(a => a.trim()) : [],
              date: pdfResult.creationDate || pdfResult.modDate || ''
            };
          }
        }
      } catch (error) {
        console.error('[下载验证] PDF解析失败:', error);
      }
    } else if (isImage) {
      // 图片文件：使用OCR识别
      console.log('[下载验证] 使用OCR识别验证');
      try {
        // 将文件路径转换为file:// URL
        const fileUrl = 'file://' + filePath.replace(/\\/g, '/');
        
        // 发送OCR请求
        const ocrResult = await handleImageOcr(fileUrl, '', '验证文件');
        if (ocrResult && ocrResult.success) {
          extractedData = {
            title: ocrResult.title || '',
            firstAuthor: ocrResult.firstAuthor || '',
            authors: ocrResult.authors || [],
            date: ocrResult.date || ''
          };
        }
      } catch (error) {
        console.error('[下载验证] OCR识别失败:', error);
      }
    }
    
    // 对比验证结果
    if (extractedData && webMetadata) {
      const verificationResult = {
        fileType: isPdf ? 'PDF' : (isImage ? 'Image' : 'Unknown'),
        fileName: fileInfo.name || download.filename,
        webMetadata: webMetadata,
        extractedData: extractedData,
        matches: {
          title: false,
          author: false,
          date: false
        }
      };
      
      // 对比标题
      if (webMetadata.title && extractedData.title) {
        const titleSimilarity = calculateSimilarity(
          webMetadata.title.toLowerCase(),
          extractedData.title.toLowerCase()
        );
        verificationResult.matches.title = titleSimilarity > 0.7;
      }
      
      // 对比作者
      if (webMetadata.firstAuthor && extractedData.firstAuthor) {
        const webAuthor = webMetadata.firstAuthor.toLowerCase();
        const extractedAuthor = extractedData.firstAuthor.toLowerCase();
        verificationResult.matches.author = 
          webAuthor.includes(extractedAuthor) || 
          extractedAuthor.includes(webAuthor) ||
          calculateSimilarity(webAuthor, extractedAuthor) > 0.7;
      }
      
      // 对比日期
      if (webMetadata.date && extractedData.date) {
        const webDate = webMetadata.date.replace(/[^\d-]/g, '');
        const extractedDate = extractedData.date.replace(/[^\d-]/g, '');
        verificationResult.matches.date = webDate === extractedDate || 
          webDate.substring(0, 7) === extractedDate.substring(0, 7); // 至少年月相同
      }
      
      console.log('[下载验证] 验证结果:', verificationResult);
      
      // 显示验证结果通知
      const allMatch = verificationResult.matches.title && 
                      verificationResult.matches.author && 
                      verificationResult.matches.date;
      
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: allMatch ? '验证通过' : '验证部分通过',
        message: `文件: ${fileInfo.name}\n标题: ${verificationResult.matches.title ? '✓' : '✗'}\n作者: ${verificationResult.matches.author ? '✓' : '✗'}\n日期: ${verificationResult.matches.date ? '✓' : '✗'}`
      });
      
      return verificationResult;
    } else {
      console.warn('[下载验证] 无法提取文件信息或缺少网页元数据');
      return null;
    }
    
  } catch (error) {
    console.error('[下载验证] 验证过程出错:', error);
    return null;
  }
}
