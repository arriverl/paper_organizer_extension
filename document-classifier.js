// 文档分类器：识别文件类型并采用不同的提取策略
'use strict';

/**
 * 文档类型枚举
 */
const DocumentType = {
  ACADEMIC_PAPER: 'academic_paper',      // 学术论文
  ACCEPTANCE_EMAIL: 'acceptance_email',   // 录用邮件
  PROOF_DOCUMENT: 'proof_document',       // 证明材料
  UNKNOWN: 'unknown'                      // 未知类型
};

/**
 * 文档分类器：根据文本特征识别文档类型
 * @param {string} text - 文档文本内容
 * @param {Object} metadata - PDF元数据
 * @returns {Object} { type, confidence, features }
 */
function classifyDocument(text, metadata = {}) {
  const features = {
    hasDoi: false,
    hasIssn: false,
    hasAbstract: false,
    hasEmailKeywords: false,
    hasProofKeywords: false,
    hasAcademicKeywords: false,
    emailScore: 0,
    proofScore: 0,
    academicScore: 0
  };
  
  const lowerText = (text || '').toLowerCase();
  const title = (metadata.title || '').toLowerCase();
  const author = (metadata.author || '').toLowerCase();
  const combinedText = lowerText + ' ' + title + ' ' + author;
  
  // 学术论文特征
  const academicKeywords = [
    'doi:', 'doi.org', 'issn', 'abstract', 'introduction', 'methodology',
    'conclusion', 'references', 'acknowledgment', 'keywords',
    'corresponding author', 'affiliation', 'university', 'institute'
  ];
  
  academicKeywords.forEach(keyword => {
    if (combinedText.includes(keyword)) {
      features.hasAcademicKeywords = true;
      features.academicScore += 1;
    }
  });
  
  // DOI检测
  if (/\bdoi\s*[:=]\s*10\.\d+/.test(combinedText) || /doi\.org/.test(combinedText)) {
    features.hasDoi = true;
    features.academicScore += 3;
  }
  
  // ISSN检测
  if (/\bissn\s*[:=]\s*\d{4}[- ]?\d{3}[\dxX]/.test(combinedText)) {
    features.hasIssn = true;
    features.academicScore += 2;
  }
  
  // Abstract检测
  if (/\babstract\b/i.test(combinedText)) {
    features.hasAbstract = true;
    features.academicScore += 2;
  }
  
  // 录用邮件特征
  const emailKeywords = [
    'subject:', 'dear author', 'dear dr.', 'dear professor',
    'congratulations', 'we are pleased', 'we are delighted',
    'acceptance', 'accepted', 'decision', 'editorial decision',
    'your manuscript', 'your paper', 'your submission',
    'has been accepted', 'has been published', 'will be published',
    'editorial manager', 'editorial office', 'editorial system',
    'best regards', 'sincerely', 'yours sincerely'
  ];
  
  emailKeywords.forEach(keyword => {
    if (combinedText.includes(keyword)) {
      features.hasEmailKeywords = true;
      features.emailScore += 1;
    }
  });
  
  // 邮件格式特征
  if (/^subject\s*:/im.test(text) || /^from\s*:/im.test(text) || /^to\s*:/im.test(text)) {
    features.emailScore += 2;
  }
  
  // 证明材料特征
  const proofKeywords = [
    '证明', '特此', '兹证明', '证明书', '证明文件',
    '公章', '印章', '签字', '签名', '日期',
    '单位', '机构', '学校', '大学', '学院',
    'certificate', 'certification', 'proof', 'attestation',
    'official seal', 'stamp', 'signature'
  ];
  
  proofKeywords.forEach(keyword => {
    if (combinedText.includes(keyword)) {
      features.hasProofKeywords = true;
      features.proofScore += 1;
    }
  });
  
  // 判断文档类型
  let documentType = DocumentType.UNKNOWN;
  let confidence = 0;
  
  if (features.academicScore >= 3) {
    documentType = DocumentType.ACADEMIC_PAPER;
    confidence = Math.min(0.9, 0.5 + features.academicScore * 0.1);
  } else if (features.emailScore >= 3) {
    documentType = DocumentType.ACCEPTANCE_EMAIL;
    confidence = Math.min(0.9, 0.5 + features.emailScore * 0.1);
  } else if (features.proofScore >= 2) {
    documentType = DocumentType.PROOF_DOCUMENT;
    confidence = Math.min(0.9, 0.5 + features.proofScore * 0.1);
  }
  
  // 如果特征不明显，但文本长度足够，可能是学术论文
  if (documentType === DocumentType.UNKNOWN && text && text.length > 500) {
    documentType = DocumentType.ACADEMIC_PAPER;
    confidence = 0.3;
  }
  
  console.log('[文档分类器] 分类结果:', {
    type: documentType,
    confidence: confidence.toFixed(2),
    features: features
  });
  
  return {
    type: documentType,
    confidence: confidence,
    features: features
  };
}

/**
 * 根据文档类型获取提取策略
 * @param {string} documentType - 文档类型
 * @returns {Object} 提取策略配置
 */
function getExtractionStrategy(documentType) {
  const strategies = {
    [DocumentType.ACADEMIC_PAPER]: {
      titlePriority: ['metadata', 'text', 'ocr'],
      authorPriority: ['metadata', 'text', 'ocr'],
      datePriority: ['received', 'accepted', 'published', 'availableOnline'],
      dateKeywords: {
        received: ['Received', 'Received date', 'Submitted'],
        accepted: ['Accepted', 'Acceptance date'],
        published: ['Published', 'Available online', 'Published online']
      },
      focusAreas: ['top', 'middle'], // 关注页面顶部和中部
      ocrPages: 2 // 最多OCR前2页
    },
    
    [DocumentType.ACCEPTANCE_EMAIL]: {
      titlePriority: ['text', 'ocr', 'metadata'],
      authorPriority: ['text', 'ocr', 'metadata'],
      datePriority: ['accepted', 'published', 'received'], // 邮件中Accepted日期最重要
      dateKeywords: {
        received: ['Received', 'Submitted'],
        accepted: ['Accepted', 'Decision', 'Congratulations', 'has been accepted'],
        published: ['Published', 'will be published', 'has been published'],
        mailDate: ['Date:', 'Date of mail', 'Sent:', 'Date sent'] // 邮件特有
      },
      focusAreas: ['top'], // 邮件通常信息在顶部
      ocrPages: 1 // 邮件通常只有1页
    },
    
    [DocumentType.PROOF_DOCUMENT]: {
      titlePriority: ['ocr', 'text', 'metadata'],
      authorPriority: ['ocr', 'text', 'metadata'],
      datePriority: ['published', 'accepted', 'received'], // 证明材料中Published日期最重要
      dateKeywords: {
        received: ['收到', '接收', 'Received'],
        accepted: ['录用', '接受', 'Accepted'],
        published: ['发表', '出版', 'Published', '发表日期', '出版日期']
      },
      focusAreas: ['all'], // 证明材料需要全页扫描
      ocrPages: 1 // 证明材料通常只有1页
    },
    
    [DocumentType.UNKNOWN]: {
      titlePriority: ['metadata', 'text', 'ocr'],
      authorPriority: ['metadata', 'text', 'ocr'],
      datePriority: ['received', 'accepted', 'published'],
      dateKeywords: {
        received: ['Received', 'Received date'],
        accepted: ['Accepted', 'Acceptance date'],
        published: ['Published', 'Available online']
      },
      focusAreas: ['top', 'middle'],
      ocrPages: 2
    }
  };
  
  return strategies[documentType] || strategies[DocumentType.UNKNOWN];
}

// 导出（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DocumentType,
    classifyDocument,
    getExtractionStrategy
  };
}

