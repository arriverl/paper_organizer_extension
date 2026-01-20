// OCR API模块：使用大模型OCR API识别图片
'use strict';

// OCR API配置（从storage读取）
let ocrConfig = {
  baseUrl: 'https://api.tokenpony.cn/v1',
  apiKey: 'sk-148b93a7942b4c2b826a88dd6d5e00ad',
  model: 'deepseek-ocr'
};

// 从storage加载OCR配置
chrome.storage.local.get(['ocrConfig'], (result) => {
  if (result.ocrConfig) {
    ocrConfig = { ...ocrConfig, ...result.ocrConfig };
    console.log('[OCR] OCR配置已加载:', { baseUrl: ocrConfig.baseUrl, model: ocrConfig.model, hasApiKey: !!ocrConfig.apiKey });
  }
});

/**
 * 将图片文件编码为base64
 * @param {File|Blob} imageFile - 图片文件
 * @returns {Promise<string>} base64编码的图片
 */
async function encodeImageToBase64(imageFile) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // 移除data:image/...;base64,前缀，只保留base64数据
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(imageFile);
  });
}

/**
 * 将Blob转换为File对象
 * @param {Blob} blob - Blob对象
 * @param {string} filename - 文件名
 * @returns {File} File对象
 */
function blobToFile(blob, filename) {
  return new File([blob], filename, { type: blob.type });
}

/**
 * 使用OCR API识别图片
 * @param {File|Blob|string} imageInput - 图片文件、Blob或base64字符串
 * @param {string} prompt - OCR提示词，默认为'<image>\nFree OCR.'
 * @returns {Promise<string>} 识别出的文本
 */
async function ocrImage(imageInput, prompt = '<image>\nFree OCR.') {
  try {
    if (!ocrConfig.apiKey) {
      throw new Error('OCR API Key未配置，请在设置中配置API Key');
    }

    console.log('[OCR] 开始OCR识别...');
    
    let imageBase64;
    let imageMimeType = 'image/jpeg';
    
    // 处理不同类型的输入
    if (typeof imageInput === 'string') {
      // 如果是base64字符串
      if (imageInput.startsWith('data:')) {
        const match = imageInput.match(/data:([^;]+);base64,(.+)/);
        if (match) {
          imageMimeType = match[1];
          imageBase64 = match[2];
        } else {
          imageBase64 = imageInput;
        }
      } else {
        imageBase64 = imageInput;
      }
    } else if (imageInput instanceof File || imageInput instanceof Blob) {
      // 如果是File或Blob对象
      imageMimeType = imageInput.type || 'image/jpeg';
      imageBase64 = await encodeImageToBase64(imageInput);
    } else {
      throw new Error('不支持的图片输入类型');
    }

    // 构建API请求
    const apiUrl = `${ocrConfig.baseUrl}/chat/completions`;
    const requestBody = {
      model: ocrConfig.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${imageMimeType};base64,${imageBase64}`
              }
            }
          ]
        }
      ],
      temperature: 0,
      max_tokens: 4096, // 增加token数量以支持长文本
      stream: false
    };

    console.log('[OCR] 发送OCR请求到:', apiUrl);
    
    // 发送API请求
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ocrConfig.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OCR API请求失败: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    // 提取识别结果
    if (data.choices && data.choices.length > 0) {
      const content = data.choices[0].message.content;
      console.log('[OCR] ✓ OCR识别完成，文本长度:', content.length);
      return content;
    } else {
      throw new Error('OCR API返回结果为空');
    }
  } catch (error) {
    console.error('[OCR] OCR识别失败:', error);
    throw error;
  }
}

/**
 * 检测PDF是否是扫描件（图片类型）
 * @param {Object} pdf - pdf.js的PDF对象
 * @returns {Promise<boolean>} 是否是扫描件
 */
async function isScannedPDF(pdf) {
  try {
    // 检查前3页，如果文本很少，可能是扫描件
    const maxPagesToCheck = Math.min(3, pdf.numPages);
    let totalTextLength = 0;
    
    for (let i = 1; i <= maxPagesToCheck; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        totalTextLength += pageText.length;
      } catch (e) {
        console.warn(`[OCR] 读取第${i}页失败:`, e);
      }
    }
    
    // 如果前3页文本少于100字符，认为是扫描件
    const isScanned = totalTextLength < 100;
    console.log(`[OCR] PDF文本检测: 前${maxPagesToCheck}页共${totalTextLength}字符，${isScanned ? '可能是扫描件' : '有文本内容'}`);
    return isScanned;
  } catch (error) {
    console.error('[OCR] 检测PDF类型失败:', error);
    // 出错时默认认为是扫描件，使用OCR
    return true;
  }
}

/**
 * 将PDF页面转换为图片
 * @param {Object} page - pdf.js的Page对象
 * @param {number} scale - 缩放比例，默认2
 * @returns {Promise<Blob>} 图片Blob
 */
async function pdfPageToImage(page, scale = 2) {
  try {
    const viewport = page.getViewport({ scale: scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const context = canvas.getContext('2d');
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;
    
    // 将canvas转换为Blob
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas转Blob失败'));
        }
      }, 'image/jpeg', 0.95);
    });
  } catch (error) {
    console.error('[OCR] PDF页面转图片失败:', error);
    throw error;
  }
}

/**
 * 对PDF进行OCR识别（如果是扫描件）
 * @param {Object} pdf - pdf.js的PDF对象
 * @param {number} maxPages - 最大识别页数，默认5
 * @returns {Promise<string>} 识别出的文本
 */
async function ocrPDF(pdf, maxPages = 5) {
  try {
    console.log('[OCR] 开始对PDF进行OCR识别...');
    
    // 检测是否是扫描件
    const scanned = await isScannedPDF(pdf);
    if (!scanned) {
      console.log('[OCR] PDF包含文本内容，跳过OCR');
      return '';
    }
    
    console.log('[OCR] 检测到扫描件，开始OCR识别...');
    
    const ocrTexts = [];
    const pagesToProcess = Math.min(maxPages, pdf.numPages);
    
    // OCR提示词：专门用于提取论文信息（改进版，支持结构化输出）
    const ocrPrompt = `Role: 你是一个精通学术流程的文档解析专家。你的任务是从用户提供的图片（可能是论文首页、录用通知、邮件回复等）中提取关键的学术元数据。

Task: 请分析图片内容，提取以下字段。如果同一信息有多个表述方式，请按以下逻辑匹配：

Title (论文标题): 提取论文全名。若在邮件中，请从标题行或"Title:"后提取。

Authors (作者姓名): 提取所有作者。若在邮件中仅提及通讯作者，请注明该作者。

Critical Dates (关键日期):
- Received: 投稿日期。
- Revised: 这里的"修订"包括"Revised"、"R1/R2/R3"或"Resubmitted"日期。
- Accepted: 录用日期。注意：如果是录用邮件，邮件的发送日期通常即为 Accepted 日期。
- Available: 在线发表、Early Access 或出版日期。

Reasoning Logic (逻辑判断):
1. 场景识别: 首先判断图片类型（论文正文、录用函、邮件截图、网页后台）。
2. 语意映射:
   - 邮件中提到 "We are pleased to inform you that your manuscript has been accepted on [Date]"，则该日期计入 accepted。
   - 录用通知抬头日期若无特殊说明，通常视为 accepted 日期。
3. 日期清洗: 忽略星期（如 Monday），统一转化为 YYYY-MM-DD 格式。

Constraints:
- 若某项信息完全缺失，请填写 "Not mentioned"。
- 保持学术专有名词的准确性。

Output format: 请严格按照以下JSON格式输出，不要添加任何额外的解释文字：
\`\`\`json
{
  "document_type": "[论文首页/录用通知/邮件/其他]",
  "title": "",
  "authors": "",
  "dates": {
    "received": "",
    "revised": "",
    "accepted": "",
    "available_online": ""
  },
  "confidence_note": "如有不确定的日期推断，请在此说明原因（例如：从邮件发件时间推断为录用日期）"
}
\`\`\`

如果无法提取结构化信息，请完整输出所有识别到的文本内容，保持原始格式和顺序。`;
    
    for (let i = 1; i <= pagesToProcess; i++) {
      try {
        console.log(`[OCR] 正在识别第${i}页...`);
        const page = await pdf.getPage(i);
        const imageBlob = await pdfPageToImage(page, 2);
        const pageText = await ocrImage(imageBlob, ocrPrompt);
        ocrTexts.push(pageText);
        console.log(`[OCR] 第${i}页识别完成，文本长度: ${pageText.length}`);
      } catch (error) {
        console.error(`[OCR] 第${i}页识别失败:`, error);
        // 继续处理下一页
      }
    }
    
    const fullText = ocrTexts.join('\n\n');
    console.log(`[OCR] ✓ PDF OCR识别完成，共${pagesToProcess}页，总文本长度: ${fullText.length}`);
    return fullText;
  } catch (error) {
    console.error('[OCR] PDF OCR识别失败:', error);
    throw error;
  }
}

// 导出函数（在background script中使用）
if (typeof self !== 'undefined') {
  self.ocrImage = ocrImage;
  self.ocrPDF = ocrPDF;
  self.isScannedPDF = isScannedPDF;
  self.pdfPageToImage = pdfPageToImage;
}

// 如果在content script中使用，通过消息传递
if (typeof window !== 'undefined') {
  window.ocrImage = ocrImage;
  window.ocrPDF = ocrPDF;
  window.isScannedPDF = isScannedPDF;
}

