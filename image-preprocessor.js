// 图像预处理：灰度化、二值化、去噪（优化版本，避免阻塞主线程）
'use strict';

/**
 * 图像预处理：提高OCR识别率（优化版本，使用分批处理避免阻塞）
 * @param {string} imageDataUrl - 原始图像数据URL
 * @param {Object} options - 预处理选项
 * @returns {Promise<string>} 处理后的图像数据URL
 */
async function preprocessImageForOCR(imageDataUrl, options = {}) {
  const {
    grayscale = true,      // 灰度化
    binarize = true,       // 二值化
    denoise = false,       // 去噪（默认关闭，因为耗时）
    enhanceContrast = true // 增强对比度
  } = options;
  
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = img.width;
          canvas.height = img.height;
          
          // 绘制原始图像
          ctx.drawImage(img, 0, 0);
          
          // 获取图像数据
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          
          // 1. 灰度化（分批处理，避免阻塞）
          if (grayscale) {
            await processInBatches(data, (pixelData, i) => {
              const r = pixelData[i];
              const g = pixelData[i + 1];
              const b = pixelData[i + 2];
              const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
              pixelData[i] = gray;
              pixelData[i + 1] = gray;
              pixelData[i + 2] = gray;
            }, 4, 10000); // 每批处理10000个像素
          }
          
          // 2. 增强对比度（简化版本，使用采样）
          if (enhanceContrast) {
            // 采样找最小最大值（每10个像素采样一次）
            let minBrightness = 255;
            let maxBrightness = 0;
            for (let i = 0; i < data.length; i += 40) {
              const gray = data[i];
              if (gray < minBrightness) minBrightness = gray;
              if (gray > maxBrightness) maxBrightness = gray;
            }
            
            // 线性拉伸对比度
            const range = maxBrightness - minBrightness;
            if (range > 10) {
              await processInBatches(data, (pixelData, i) => {
                const gray = pixelData[i];
                const stretched = Math.round(((gray - minBrightness) / range) * 255);
                const clamped = Math.max(0, Math.min(255, stretched));
                pixelData[i] = clamped;
                pixelData[i + 1] = clamped;
                pixelData[i + 2] = clamped;
              }, 4, 10000);
            }
          }
          
          // 3. 二值化（Otsu算法，简化版本）
          if (binarize) {
            const threshold = calculateOtsuThresholdSimple(data);
            await processInBatches(data, (pixelData, i) => {
              const gray = pixelData[i];
              const binary = gray > threshold ? 255 : 0;
              pixelData[i] = binary;
              pixelData[i + 1] = binary;
              pixelData[i + 2] = binary;
            }, 4, 10000);
          }
          
          // 4. 去噪（中值滤波）- 可选，默认关闭
          if (denoise && canvas.width * canvas.height < 2000000) {
            const denoisedData = new Uint8ClampedArray(data);
            const width = canvas.width;
            const height = canvas.height;
            
            // 按行分批处理
            for (let y = 1; y < height - 1; y++) {
              for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                const neighbors = [];
                
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) {
                    const nIdx = ((y + dy) * width + (x + dx)) * 4;
                    neighbors.push(data[nIdx]);
                  }
                }
                
                neighbors.sort((a, b) => a - b);
                const median = neighbors[4];
                
                denoisedData[idx] = median;
                denoisedData[idx + 1] = median;
                denoisedData[idx + 2] = median;
              }
              
              // 每处理10行让出控制权
              if (y % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
              }
            }
            
            // 复制回原始数组
            for (let i = 0; i < data.length; i++) {
              data[i] = denoisedData[i];
            }
          }
          
          // 将处理后的数据写回canvas
          ctx.putImageData(imageData, 0, 0);
          
          // 转换为数据URL
          const processedDataUrl = canvas.toDataURL('image/png');
          console.log('[图像预处理] 预处理完成，图像尺寸:', canvas.width, 'x', canvas.height);
          resolve(processedDataUrl);
        } catch (error) {
          console.error('[图像预处理] 处理失败:', error);
          // 如果预处理失败，返回原始图像
          resolve(imageDataUrl);
        }
      };
      
      img.onerror = (error) => {
        console.error('[图像预处理] 图像加载失败:', error);
        reject(new Error('图像加载失败'));
      };
      
      img.src = imageDataUrl;
    } catch (error) {
      console.error('[图像预处理] 预处理出错:', error);
      reject(error);
    }
  });
}

/**
 * 分批处理图像数据，避免阻塞主线程
 * @param {Uint8ClampedArray} data - 图像数据
 * @param {Function} processor - 处理函数 (data, index) => void
 * @param {number} step - 步长（通常为4，因为RGBA）
 * @param {number} batchSize - 每批处理的像素数
 */
function processInBatches(data, processor, step, batchSize) {
  return new Promise((resolve) => {
    let processed = 0;
    const total = data.length;
    
    const processBatch = () => {
      const end = Math.min(processed + batchSize * step, total);
      for (let i = processed; i < end; i += step) {
        processor(data, i);
      }
      processed = end;
      
      if (processed < total) {
        // 使用 setTimeout 让出控制权
        setTimeout(processBatch, 0);
      } else {
        resolve();
      }
    };
    
    processBatch();
  });
}

/**
 * 计算Otsu阈值（用于二值化）- 简化版本，使用采样减少计算量
 * @param {Uint8ClampedArray} data - 图像数据
 * @returns {number} 阈值
 */
function calculateOtsuThresholdSimple(data) {
  // 使用采样方式计算直方图（每4个像素采样一次）
  const histogram = new Array(256).fill(0);
  let totalPixels = 0;
  
  for (let i = 0; i < data.length; i += 16) { // 每4个像素采样一次
    histogram[data[i]]++;
    totalPixels++;
  }
  
  // 如果采样像素太少，使用完整计算
  if (totalPixels < 100) {
    histogram.fill(0);
    totalPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      histogram[data[i]]++;
      totalPixels++;
    }
  }
  
  // 归一化直方图
  for (let i = 0; i < 256; i++) {
    histogram[i] /= totalPixels;
  }
  
  // 计算Otsu阈值（简化：只检查部分阈值）
  let bestThreshold = 128;
  let maxVariance = 0;
  
  // 粗搜索：每10个检查一次
  for (let t = 10; t < 246; t += 10) {
    let w0 = 0, w1 = 0, u0 = 0, u1 = 0;
    
    for (let i = 0; i <= t; i++) {
      w0 += histogram[i];
      u0 += i * histogram[i];
    }
    
    for (let i = t + 1; i < 256; i++) {
      w1 += histogram[i];
      u1 += i * histogram[i];
    }
    
    if (w0 > 0 && w1 > 0) {
      u0 /= w0;
      u1 /= w1;
      const variance = w0 * w1 * Math.pow(u0 - u1, 2);
      
      if (variance > maxVariance) {
        maxVariance = variance;
        bestThreshold = t;
      }
    }
  }
  
  // 精细搜索：在最佳阈值附近
  for (let t = Math.max(0, bestThreshold - 10); t <= Math.min(255, bestThreshold + 10); t++) {
    let w0 = 0, w1 = 0, u0 = 0, u1 = 0;
    
    for (let i = 0; i <= t; i++) {
      w0 += histogram[i];
      u0 += i * histogram[i];
    }
    
    for (let i = t + 1; i < 256; i++) {
      w1 += histogram[i];
      u1 += i * histogram[i];
    }
    
    if (w0 > 0 && w1 > 0) {
      u0 /= w0;
      u1 /= w1;
      const variance = w0 * w1 * Math.pow(u0 - u1, 2);
      
      if (variance > maxVariance) {
        maxVariance = variance;
        bestThreshold = t;
      }
    }
  }
  
  return bestThreshold;
}

// 导出
if (typeof window !== 'undefined') {
  window.preprocessImageForOCR = preprocessImageForOCR;
}
