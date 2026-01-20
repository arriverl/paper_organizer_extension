// pinyin-pro 加载器：在 background script 中加载和使用 pinyin-pro
'use strict';

let pinyinProLoaded = false;
let pinyinProLoadPromise = null;

/**
 * 加载 pinyin-pro 库（通过 CDN）
 * @returns {Promise<boolean>} 是否加载成功
 */
async function loadPinyinPro() {
  if (pinyinProLoaded) {
    return true;
  }
  
  if (pinyinProLoadPromise) {
    return pinyinProLoadPromise;
  }
  
  pinyinProLoadPromise = (async () => {
    try {
      console.log('[拼音库] 开始加载 pinyin-pro...');
      
      // 在 background script 中使用 importScripts 加载 pinyin-pro
      // 注意：pinyin-pro 可能不支持直接通过 importScripts 加载
      // 我们需要使用 fetch + eval 的方式
      try {
        console.log('[拼音库] 通过 fetch 加载 pinyin-pro...');
        const response = await fetch('https://unpkg.com/pinyin-pro@3.12.0/dist/index.js');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const scriptText = await response.text();
        
        // 在 background script 的全局作用域中执行
        // 使用 Function 构造函数在全局作用域执行
        const executeScript = new Function(scriptText);
        executeScript();
        
        // 检查是否加载成功
        // pinyin-pro 可能暴露为不同的全局变量
        let pinyinLib = null;
        if (typeof self !== 'undefined') {
          pinyinLib = self.pinyinPro || self.pinyin || self.PinyinPro;
        }
        if (typeof globalThis !== 'undefined' && !pinyinLib) {
          pinyinLib = globalThis.pinyinPro || globalThis.pinyin || globalThis.PinyinPro;
        }
        
        if (pinyinLib && typeof pinyinLib.pinyin === 'function') {
          // 确保在 self 上也有引用
          if (typeof self !== 'undefined') {
            self.pinyinPro = pinyinLib;
          }
          pinyinProLoaded = true;
          console.log('[拼音库] pinyin-pro 加载成功');
          return true;
        } else {
          throw new Error('pinyin-pro 加载后未找到有效的 API');
        }
      } catch (error) {
        console.error('[拼音库] 加载 pinyin-pro 失败:', error);
        // 尝试备用方案：使用简化的内联实现
        console.warn('[拼音库] 将使用 fallback 拼音转换');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('[拼音库] 加载 pinyin-pro 出错:', error);
      pinyinProLoaded = false;
      return false;
    }
  })();
  
  return pinyinProLoadPromise;
}

/**
 * 使用 pinyin-pro 转换中文为拼音
 * @param {string} chinese - 中文字符串
 * @param {Object} options - 选项
 * @returns {Promise<string>} 拼音字符串
 */
async function convertChineseToPinyin(chinese, options = {}) {
  if (!chinese || typeof chinese !== 'string') {
    return '';
  }
  
  // 如果不是中文，直接返回
  if (!/[\u4e00-\u9fa5]/.test(chinese)) {
    return chinese;
  }
  
  try {
    // 尝试加载 pinyin-pro
    const loaded = await loadPinyinPro();
    
    if (loaded) {
      // 获取 pinyin-pro 实例
      const pinyinLib = (typeof window !== 'undefined' && window.pinyinPro) || 
                       (typeof self !== 'undefined' && self.pinyinPro);
      
      if (pinyinLib && typeof pinyinLib.pinyin === 'function') {
        // 使用 pinyin-pro 的 pinyin 函数
        // 参数：toneType: 'none' 表示不带声调，type: 'all' 表示返回所有拼音
        const result = pinyinLib.pinyin(chinese, {
          toneType: 'none',  // 不带声调
          type: 'all',        // 返回所有拼音（处理多音字）
          v: true             // 使用 v 表示 ü
        });
        
        // pinyin-pro 返回的是带空格的字符串，如 "wei jia jun"
        // 转换为首字母大写的格式，如 "Wei Jiajun"
        const words = result.split(/\s+/).filter(w => w.length > 0);
        if (words.length > 0) {
          const capitalized = words.map(w => {
            return w.charAt(0).toUpperCase() + w.slice(1);
          });
          const finalResult = capitalized.join(' ');
          
          console.log('[拼音库] pinyin-pro 转换成功:', chinese, '->', finalResult);
          return finalResult;
        }
        
        return result;
      } else {
        console.warn('[拼音库] pinyin-pro 已加载但 API 不可用');
      }
    }
  } catch (error) {
    console.warn('[拼音库] 使用 pinyin-pro 转换失败:', error);
  }
  
  // 如果 pinyin-pro 不可用，返回原始字符串（或使用 fallback）
  console.warn('[拼音库] 使用 fallback，返回原始字符串');
  return chinese;
}

// 导出（如果在模块环境中）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadPinyinPro,
    convertChineseToPinyin
  };
}

// 在 background script 中，直接暴露到全局
if (typeof self !== 'undefined') {
  self.loadPinyinPro = loadPinyinPro;
  self.convertChineseToPinyin = convertChineseToPinyin;
}

