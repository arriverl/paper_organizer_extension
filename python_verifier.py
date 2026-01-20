#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import sys
import re
import logging
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import threading
from datetime import datetime

# 配置日志系统
def setup_logging(log_file=None):
    """设置日志系统，输出到文件和控制台"""
    if log_file is None:
        # 默认日志文件：当前目录下的verifier.log
        log_dir = os.path.dirname(os.path.abspath(__file__))
        log_file = os.path.join(log_dir, 'verifier.log')
    
    # 创建日志格式
    log_format = '%(asctime)s [%(levelname)s] %(name)s: %(message)s'
    date_format = '%Y-%m-%d %H:%M:%S'
    
    # 配置日志
    logging.basicConfig(
        level=logging.DEBUG,
        format=log_format,
        datefmt=date_format,
        handlers=[
            logging.FileHandler(log_file, encoding='utf-8', mode='a'), 
            logging.StreamHandler(sys.stdout)  # 同时输出到控制台
        ]
    )
    
    logger = logging.getLogger('PDFVerifier')
    logger.info(f"日志系统已初始化，日志文件: {log_file}")
    return logger

# 初始化日志
logger = setup_logging()

# PDF处理库
try:
    import PyPDF2
    HAS_PYPDF2 = True
except ImportError:
    HAS_PYPDF2 = False
    print("警告: PyPDF2未安装，将使用备用方法")

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False
    print("警告: pdfplumber未安装，将使用备用方法")

# OCR库（按优先级尝试）
HAS_OCR = False
OCR_METHOD = None
OCR_READER = None  # 全局OCR读取器（避免重复初始化）

# 方法1: PaddleOCR（推荐，中文识别准确率高）
try:
    from paddleocr import PaddleOCR
    HAS_OCR = True
    OCR_METHOD = 'paddleocr'
    print("✓ 已加载 PaddleOCR")
    # 延迟初始化，避免启动时加载模型
except ImportError:
    pass

# 方法2: EasyOCR（支持多语言，准确率高）
if not HAS_OCR:
    try:
        import easyocr
        HAS_OCR = True
        OCR_METHOD = 'easyocr'
        print("已加载 EasyOCR")
        # 延迟初始化，避免启动时加载模型
    except ImportError:
        pass

# 方法3: pytesseract（需要安装Tesseract引擎）
if not HAS_OCR:
    try:
        from PIL import Image
        import pytesseract
        HAS_OCR = True
        OCR_METHOD = 'pytesseract'
        print("已加载 pytesseract（需要Tesseract引擎）")
    except ImportError:
        print("警告: 未找到OCR库，建议安装 PaddleOCR 或 EasyOCR")

# 拼音转换库
try:
    from pypinyin import lazy_pinyin, Style
    HAS_PINYIN = True
except ImportError:
    HAS_PINYIN = False
    print("警告: pypinyin未安装，中文作者匹配可能不准确")

# 日期解析
try:
    from dateutil import parser as date_parser
    HAS_DATEUTIL = True
except ImportError:
    HAS_DATEUTIL = False
    print("警告: python-dateutil未安装，日期解析可能不准确")


class PDFVerifier:
    
    def __init__(self):
        self.results = []
        self.logger = logging.getLogger('PDFVerifier')
    
    def normalize_date(self, date_string: str) -> Optional[str]:
        """标准化日期格式为 YYYY-MM-DD（与扩展逻辑一致）"""
        if not date_string or not isinstance(date_string, str):
            return None
        
        try:
            # 尝试直接解析为Date对象
            if HAS_DATEUTIL:
                try:
                    dt = date_parser.parse(date_string)
                    return dt.strftime('%Y-%m-%d')
                except:
                    pass
            
            # 格式1: "DD Month YYYY" 或 "Wed, 24 Dec 2025 15:15:18 UTC"
            match = re.search(r'(\d{1,2})\s+(\w+)\s+(\d{4})', date_string)
            if match:
                day, month_name, year = match.groups()
                month_map = {
                    'january': '01', 'february': '02', 'march': '03', 'april': '04',
                    'may': '05', 'june': '06', 'july': '07', 'august': '08',
                    'september': '09', 'october': '10', 'november': '11', 'december': '12',
                    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
                    'jun': '06', 'jul': '07', 'aug': '08', 'sep': '09',
                    'oct': '10', 'nov': '11', 'dec': '12'
                }
                month = month_map.get(month_name.lower(), '01')
                return f"{year}-{month}-{day.zfill(2)}"
            
            # 格式2: "2025年12月24日" 或 "2025 年 12 月 24 日"
            match = re.search(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', date_string)
            if match:
                year, month, day = match.groups()
                return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
            
            # 格式3: "YYYY-MM-DD"
            match = re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', date_string)
            if match:
                year, month, day = match.groups()
                return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
            
            # 格式4: "YYYY/MM/DD"
            match = re.search(r'(\d{4})/(\d{1,2})/(\d{1,2})', date_string)
            if match:
                year, month, day = match.groups()
                return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
            
        except Exception as e:
            print(f"日期标准化失败: {date_string}, {e}")
        
        return None
    
    def extract_pdf_text(self, pdf_path: str, max_pages: int = 5) -> str:
        """提取PDF文本"""
        self.logger.info(f"[PDF文本提取] 开始提取: {pdf_path}, 最大页数: {max_pages}")
        try:
            if HAS_PDFPLUMBER:
                self.logger.debug("[PDF文本提取] 使用 pdfplumber")
                text = self._extract_with_pdfplumber(pdf_path, max_pages)
                self.logger.info(f"[PDF文本提取] 提取完成，文本长度: {len(text)}")
                return text
            elif HAS_PYPDF2:
                self.logger.debug("[PDF文本提取] 使用 PyPDF2")
                text = self._extract_with_pypdf2(pdf_path, max_pages)
                self.logger.info(f"[PDF文本提取] 提取完成，文本长度: {len(text)}")
                return text
            else:
                self.logger.warning("[PDF文本提取] 未找到PDF处理库")
                return ""
        except Exception as e:
            self.logger.error(f"[PDF文本提取] 提取失败: {e}", exc_info=True)
            return ""
    
    def _extract_with_pdfplumber(self, pdf_path: str, max_pages: int) -> str:
        """使用pdfplumber提取文本"""
        text = ""
        try:
            with pdfplumber.open(pdf_path) as pdf:
                self.logger.debug(f"[PDF文本提取] pdfplumber打开成功，总页数: {len(pdf.pages)}")
                for i, page in enumerate(pdf.pages[:max_pages]):
                    try:
                        page_text = page.extract_text()
                        if page_text:
                            text += page_text + "\n"
                            self.logger.debug(f"[PDF文本提取] 第{i+1}页提取成功，文本长度: {len(page_text)}")
                        else:
                            self.logger.debug(f"[PDF文本提取] 第{i+1}页文本为空（可能是扫描件）")
                    except Exception as e:
                        self.logger.warning(f"[PDF文本提取] 第{i+1}页提取失败: {e}")
                        continue
        except Exception as e:
            self.logger.error(f"[PDF文本提取] pdfplumber打开失败: {e}", exc_info=True)
        self.logger.info(f"[PDF文本提取] pdfplumber提取完成，总文本长度: {len(text)}")
        return text
    
    def _extract_with_pypdf2(self, pdf_path: str, max_pages: int) -> str:
        """使用PyPDF2提取文本"""
        text = ""
        try:
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                self.logger.debug(f"[PDF文本提取] PyPDF2打开成功，总页数: {len(pdf_reader.pages)}")
                for i, page in enumerate(pdf_reader.pages[:max_pages]):
                    try:
                        page_text = page.extract_text()
                        if page_text:
                            text += page_text + "\n"
                            self.logger.debug(f"[PDF文本提取] 第{i+1}页提取成功，文本长度: {len(page_text)}")
                        else:
                            self.logger.debug(f"[PDF文本提取] 第{i+1}页文本为空（可能是扫描件）")
                    except Exception as e:
                        self.logger.warning(f"[PDF文本提取] 第{i+1}页提取失败: {e}")
                        continue
        except Exception as e:
            self.logger.error(f"[PDF文本提取] PyPDF2打开失败: {e}", exc_info=True)
        self.logger.info(f"[PDF文本提取] PyPDF2提取完成，总文本长度: {len(text)}")
        return text
    
    def extract_pdf_metadata(self, pdf_path: str) -> Dict:
        """提取PDF元数据（使用多种方法，提高兼容性）"""
        self.logger.info(f"[PDF元数据] 开始提取: {pdf_path}")
        metadata = {
            'title': '',
            'author': '',
            'date': '',
            'firstAuthor': ''
        }
        
        # 方法1：尝试使用PyPDF2
        if HAS_PYPDF2:
            try:
                with open(pdf_path, 'rb') as file:
                    pdf_reader = PyPDF2.PdfReader(file)
                    if pdf_reader.metadata:
                        try:
                            metadata['title'] = pdf_reader.metadata.get('/Title', '') or ''
                            raw_author = pdf_reader.metadata.get('/Author', '') or ''
                            
                            # 验证并清理作者名（过滤无效名称）
                            if raw_author:
                                author_lower = raw_author.lower()
                                invalid_names = [
                                    'direct journals', 'expert systems', 'fields', 'open access',
                                    'international journal', 'elsevier', 'science direct',
                                    'compaq', 'hp', 'dell', 'lenovo', 'computer', 'system',
                                    'creative commons', 'the author', 'this article'
                                ]
                                is_invalid = any(inv in author_lower for inv in invalid_names)
                                if not is_invalid and len(raw_author) >= 5 and len(raw_author) <= 200:
                                    metadata['author'] = raw_author
                                    # 提取第一作者（如果有多个作者，取第一个）
                                    authors = [a.strip() for a in raw_author.split(',')]
                                    if authors:
                                        metadata['firstAuthor'] = authors[0]
                            
                            # 提取日期
                            if '/CreationDate' in pdf_reader.metadata:
                                try:
                                    date_str = pdf_reader.metadata['/CreationDate']
                                    metadata['date'] = self._parse_pdf_date(date_str)
                                except:
                                    pass
                        except Exception as e:
                            # 如果读取元数据失败，继续尝试其他方法
                            pass
            except Exception as e:
                # PyPDF2读取失败，尝试使用pdfplumber
                pass
        
        # 方法2：如果PyPDF2失败，尝试使用pdfplumber
        if (not metadata.get('title') or not metadata.get('firstAuthor')) and HAS_PDFPLUMBER:
            try:
                self.logger.debug("[PDF元数据] 尝试使用 pdfplumber")
                with pdfplumber.open(pdf_path) as pdf:
                    if pdf.metadata:
                        if not metadata.get('title'):
                            metadata['title'] = pdf.metadata.get('Title', '') or ''
                        if not metadata.get('author'):
                            raw_author = pdf.metadata.get('Author', '') or ''
                            self.logger.debug(f"[PDF元数据] pdfplumber提取 - 标题: {metadata['title'][:50] if metadata['title'] else '(空)'}, 作者: {raw_author[:50] if raw_author else '(空)'}")
                            if raw_author:
                                author_lower = raw_author.lower()
                                invalid_names = [
                                    'direct journals', 'expert systems', 'fields', 'open access',
                                    'international journal', 'elsevier', 'science direct',
                                    'compaq', 'hp', 'dell', 'lenovo', 'computer', 'system',
                                    'creative commons', 'the author', 'this article'
                                ]
                                is_invalid = any(inv in author_lower for inv in invalid_names)
                                if not is_invalid and len(raw_author) >= 5 and len(raw_author) <= 200:
                                    metadata['author'] = raw_author
                                    authors = [a.strip() for a in raw_author.split(',')]
                                    if authors:
                                        metadata['firstAuthor'] = authors[0]
                            else:
                                # 如果没有作者，authors变量未定义，需要初始化
                                authors = []
            except Exception as e:
                # pdfplumber也失败，继续
                self.logger.warning(f"[PDF元数据] pdfplumber提取失败: {e}")
        
        self.logger.info(f"[PDF元数据] 提取完成 - 标题: {metadata['title'][:50] if metadata['title'] else '(空)'}, 第一作者: {metadata['firstAuthor'][:50] if metadata['firstAuthor'] else '(空)'}")
        return metadata
    
    def _parse_pdf_date(self, date_str: str) -> str:
        """解析PDF日期格式"""
        try:
            if date_str.startswith('D:'):
                date_str = date_str[2:]
            if len(date_str) >= 8:
                year = date_str[0:4]
                month = date_str[4:6]
                day = date_str[6:8]
                return f"{year}-{month}-{day}"
        except:
            pass
        return date_str
    
    def ocr_image(self, pdf_path: str, page_num: int = 0) -> str:
        global OCR_READER
        
        self.logger.info(f"[OCR] 开始识别: {pdf_path}, 页码: {page_num}")
        
        if not HAS_OCR:
            self.logger.warning("[OCR] OCR库未安装")
            return ""
        
        try:
            # 将PDF第一页转换为图像
            try:
                from pdf2image import convert_from_path
                self.logger.debug("[OCR] 正在将PDF转换为图像...")
                images = convert_from_path(pdf_path, first_page=page_num+1, last_page=page_num+1)
                if not images:
                    self.logger.warning("[OCR] PDF转图像失败，未生成图像")
                    return ""
                
                image = images[0]
                self.logger.debug(f"[OCR] PDF转图像成功，图像尺寸: {image.size}")
                
                try:
                    import numpy as np
                    image_array = np.array(image)
                except ImportError:
                    self.logger.warning("[OCR] numpy未安装，无法转换图像格式")
                    image_array = image
                
                # 根据可用的OCR库选择方法
                if OCR_METHOD == 'paddleocr':
                    # 使用PaddleOCR（推荐，中文识别准确率高）
                    try:
                        # 延迟初始化（首次使用时才加载模型）
                        if OCR_READER is None:
                            import time
                            import sys
                            start_time = time.time()
                            self.logger.info("[OCR] 正在初始化 PaddleOCR（首次运行会下载模型，请稍候）...")
                            self.logger.info("[OCR] 提示：PaddleOCR首次初始化可能需要几分钟时间，请耐心等待...")
                            print(f"[OCR] 开始初始化 PaddleOCR (时间: {time.strftime('%H:%M:%S')})...", flush=True)
                            sys.stdout.flush()  # 确保输出立即显示
                            try:
                                # 新版本API
                                self.logger.debug("[OCR] 尝试使用新版本API (use_textline_orientation=True)...")
                                OCR_READER = PaddleOCR(use_textline_orientation=True, lang='ch')  # 中文+英文
                                self.logger.debug("[OCR] 新版本API初始化成功")
                            except TypeError:
                                # 旧版本API兼容
                                self.logger.debug("[OCR] 新版本API失败，尝试旧版本API (use_angle_cls=True)...")
                                try:
                                    OCR_READER = PaddleOCR(use_angle_cls=True, lang='ch')
                                    self.logger.debug("[OCR] 旧版本API (use_angle_cls) 初始化成功")
                                except:
                                    self.logger.debug("[OCR] 旧版本API (use_angle_cls) 失败，尝试基础API...")
                                    OCR_READER = PaddleOCR(lang='ch')
                                    self.logger.debug("[OCR] 基础API初始化成功")
                            elapsed_time = time.time() - start_time
                            self.logger.info(f"[OCR] PaddleOCR 初始化完成（耗时: {elapsed_time:.1f}秒），开始识别...")
                            print(f"[OCR] PaddleOCR 初始化完成（耗时: {elapsed_time:.1f}秒）(时间: {time.strftime('%H:%M:%S')})", flush=True)
                            sys.stdout.flush()  # 确保输出立即显示
                        
                        self.logger.info("[OCR] 开始PaddleOCR识别（这可能需要几秒钟）...")
                        import sys
                        sys.stdout.flush() 
                        result = None
                        try:
                            # 尝试新版本API (predict方法)
                            try:
                                result = OCR_READER.predict(image_array)
                                self.logger.debug(f"[OCR] 使用predict方法，result类型: {type(result)}")
                            except (AttributeError, TypeError, ValueError) as e:
                                self.logger.debug(f"[OCR] predict方法失败: {e}，尝试ocr方法")
                                try:
                                    result = OCR_READER.ocr(image_array, cls=True)
                                    self.logger.debug(f"[OCR] 使用ocr方法(cls=True)，result类型: {type(result)}")
                                except (TypeError, ValueError) as e2:
                                    self.logger.debug(f"[OCR] ocr方法(cls=True)失败: {e2}，尝试ocr方法(无cls)")
                                    result = OCR_READER.ocr(image_array)
                                    self.logger.debug(f"[OCR] 使用ocr方法，result类型: {type(result)}")
                        except Exception as e:
                            self.logger.warning(f"[OCR] PaddleOCR调用失败，尝试使用PIL Image: {e}")
                            try:
                                result = OCR_READER.ocr(image, cls=True)
                            except:
                                result = OCR_READER.ocr(image)
                        
                        if result:
                            text_lines = []
                            
                            if hasattr(result, 'json'):
                                self.logger.debug("[OCR] 检测到 PaddleX 结果对象，使用 .json 属性")
                                try:
                                    res_data = result.json
                                    if isinstance(res_data, dict):
                                        if 'ocr_text' in res_data:
                                            text = res_data['ocr_text']
                                            self.logger.info(f"[OCR] PaddleOCR识别完成，文本长度: {len(text)}")
                                            self.logger.debug(f"[OCR] 识别文本预览: {text[:200]}")
                                            return text
                                        # 处理 'res' 字段
                                        if 'res' in res_data:
                                            for item in res_data['res']:
                                                if isinstance(item, dict) and 'text' in item:
                                                    text_lines.append(str(item['text']))
                                                elif isinstance(item, str):
                                                    text_lines.append(item)
                                except Exception as e:
                                    self.logger.warning(f"[OCR] 解析 PaddleX .json 失败: {e}")
                            
                            if isinstance(result, dict):
                                if 'ocr_text' in result:
                                    text = result['ocr_text']
                                    self.logger.info(f"[OCR] PaddleOCR识别完成，文本长度: {len(text)}")
                                    self.logger.debug(f"[OCR] 识别文本预览: {text[:200]}")
                                    return text
                                # 处理 'res' 字段
                                if 'res' in result:
                                    for item in result['res']:
                                        if isinstance(item, dict) and 'text' in item:
                                            text_lines.append(str(item['text']))
                                        elif isinstance(item, str):
                                            text_lines.append(item)
                                for key in ['text', 'result', 'content', 'data']:
                                    if key in result:
                                        value = result[key]
                                        if isinstance(value, str):
                                            text_lines.append(value)
                                        elif isinstance(value, list):
                                            for item in value:
                                                if isinstance(item, str):
                                                    text_lines.append(item)
                                                elif isinstance(item, dict) and 'text' in item:
                                                    text_lines.append(str(item['text']))
                            
                            if isinstance(result, list) and len(result) > 0:
                                self.logger.info(f"[OCR] 处理列表格式，列表长度: {len(result)}, 第一个元素类型: {type(result[0])}")
                                self.logger.info(f"[OCR] result完整结构预览（前1000字符）: {str(result)[:1000]}")
                                # 遍历每一页的结果
                                for page_idx, page in enumerate(result):
                                    self.logger.info(f"[OCR] 处理第{page_idx}页，类型: {type(page)}, 长度: {len(page) if isinstance(page, (list, tuple)) else 'N/A'}, 内容预览: {str(page)[:300]}")
                                    if isinstance(page, list):
                                        # 标准格式：[bbox, (text, confidence)] 或 [bbox, text]
                                        for item_idx, item in enumerate(page):
                                            try:
                                                self.logger.info(f"[OCR] 处理第{page_idx}页第{item_idx}项，类型: {type(item)}, 长度: {len(item) if isinstance(item, (list, tuple)) else 'N/A'}, 内容: {str(item)[:200]}")
                                                if isinstance(item, list) and len(item) >= 2:
                                                    # 标准格式：[[x1,y1,x2,y2], (text, confidence)] 或 [[x1,y1,x2,y2], text]
                                                    text_info = item[1]
                                                    if isinstance(text_info, tuple):
                                                        text = text_info[0] if len(text_info) > 0 else ''
                                                    elif isinstance(text_info, str):
                                                        text = text_info
                                                    elif isinstance(text_info, dict):
                                                        # 可能是字典格式，尝试提取text字段
                                                        text = text_info.get('text', '') or text_info.get('content', '') or text_info.get('ocr_text', '')
                                                    else:
                                                        text = str(text_info) if text_info else ''
                                                    if text and text.strip():
                                                        text_lines.append(str(text).strip())
                                                        self.logger.info(f"[OCR] ✓ 从列表项提取文本: {text[:100]}")
                                                elif isinstance(item, dict):
                                                    # 字典格式，尝试提取text字段
                                                    text = item.get('text', '') or item.get('content', '') or item.get('ocr_text', '')
                                                    if text and text.strip():
                                                        text_lines.append(str(text).strip())
                                                        self.logger.info(f"[OCR] ✓ 从字典项提取文本: {text[:100]}")
                                                elif isinstance(item, str):
                                                    # 直接是文本
                                                    if item.strip():
                                                        text_lines.append(item.strip())
                                                        self.logger.info(f"[OCR] ✓ 从字符串项提取文本: {item[:100]}")
                                                elif isinstance(item, tuple):
                                                    # 元组格式，尝试提取第一个元素
                                                    if len(item) > 0:
                                                        text = str(item[0]).strip()
                                                        if text:
                                                            text_lines.append(text)
                                                            self.logger.info(f"[OCR] ✓ 从元组项提取文本: {text[:100]}")
                                                else:
                                                    # 其他类型，尝试转换为字符串
                                                    text = str(item).strip()
                                                    if text and len(text) > 3:  # 过滤太短的文本
                                                        text_lines.append(text)
                                                        self.logger.info(f"[OCR] ✓ 从其他类型项提取文本: {text[:100]}")
                                            except Exception as e:
                                                self.logger.warning(f"[OCR] 处理第{page_idx}页第{item_idx}项时出错: {e}", exc_info=True)
                                                continue
                                    elif isinstance(page, (str, tuple)):
                                        # 直接是文本或元组
                                        if isinstance(page, tuple):
                                            text = str(page[0]).strip() if len(page) > 0 else ''
                                        else:
                                            text = str(page).strip()
                                        if text:
                                            text_lines.append(text)
                                            self.logger.info(f"[OCR] ✓ 从页面直接提取文本: {text[:100]}")
                                    elif isinstance(page, dict):
                                        # 字典格式，尝试提取文本
                                        self.logger.info(f"[OCR] 检测到字典格式，字典键: {list(page.keys())[:10]}")  # 显示前10个键
                                        
                                        # 首先检查 rec_res 字段（PaddleOCR 新版本格式）
                                        if 'rec_res' in page:
                                            rec_res = page['rec_res']
                                            self.logger.info(f"[OCR] 检测到 rec_res 字段，类型: {type(rec_res)}, 长度: {len(rec_res) if isinstance(rec_res, (list, tuple)) else 'N/A'}")
                                            if isinstance(rec_res, list):
                                                for rec_idx, rec_item in enumerate(rec_res):
                                                    try:
                                                        self.logger.info(f"[OCR] 处理 rec_res[{rec_idx}], 类型: {type(rec_item)}, 内容预览: {str(rec_item)[:200]}")
                                                        if isinstance(rec_item, (list, tuple)) and len(rec_item) >= 1:
                                                            # 格式可能是 (text, confidence) 或 [text, confidence]
                                                            text = str(rec_item[0]).strip() if len(rec_item) > 0 else ''
                                                            if text:
                                                                text_lines.append(text)
                                                                self.logger.info(f"[OCR] ✓ 从 rec_res[{rec_idx}] 提取文本: {text[:100]}")
                                                        elif isinstance(rec_item, dict):
                                                            text = rec_item.get('text', '') or rec_item.get('content', '') or rec_item.get('ocr_text', '') or rec_item.get('result', '')
                                                            if text and text.strip():
                                                                text_lines.append(str(text).strip())
                                                                self.logger.info(f"[OCR] ✓ 从 rec_res[{rec_idx}] 字典提取文本: {text[:100]}")
                                                        elif isinstance(rec_item, str):
                                                            if rec_item.strip():
                                                                text_lines.append(rec_item.strip())
                                                                self.logger.info(f"[OCR] ✓ 从 rec_res[{rec_idx}] 字符串提取文本: {rec_item[:100]}")
                                                    except Exception as e:
                                                        self.logger.warning(f"[OCR] 处理 rec_res[{rec_idx}] 时出错: {e}")
                                                        continue
                                            elif isinstance(rec_res, str):
                                                if rec_res.strip():
                                                    text_lines.append(rec_res.strip())
                                                    self.logger.info(f"[OCR] ✓ 从 rec_res 字符串提取文本: {rec_res[:100]}")
                                            elif isinstance(rec_res, dict):
                                                # rec_res 可能是字典格式
                                                text = rec_res.get('text', '') or rec_res.get('content', '') or rec_res.get('ocr_text', '')
                                                if text and text.strip():
                                                    text_lines.append(str(text).strip())
                                                    self.logger.info(f"[OCR] ✓ 从 rec_res 字典提取文本: {text[:100]}")
                                        
                                        # 检查其他可能的字段
                                        for key in ['rec_text', 'ocr_result', 'result', 'text', 'content', 'ocr_text', 'rec']:
                                            if key in page:
                                                value = page[key]
                                                self.logger.info(f"[OCR] 检测到字段 '{key}', 类型: {type(value)}")
                                                if isinstance(value, str) and value.strip():
                                                    text_lines.append(value.strip())
                                                    self.logger.info(f"[OCR] ✓ 从字段 '{key}' 提取文本: {value[:100]}")
                                                elif isinstance(value, list):
                                                    for item in value:
                                                        if isinstance(item, str) and item.strip():
                                                            text_lines.append(item.strip())
                                                            self.logger.info(f"[OCR] ✓ 从字段 '{key}' 列表提取文本: {item[:100]}")
                                                        elif isinstance(item, (list, tuple)) and len(item) > 0:
                                                            text = str(item[0]).strip()
                                                            if text:
                                                                text_lines.append(text)
                                                                self.logger.info(f"[OCR] ✓ 从字段 '{key}' 列表项提取文本: {text[:100]}")
                                        
                                        # 最后检查其他常见字段
                                        text = page.get('text', '') or page.get('content', '') or page.get('ocr_text', '')
                                        if text and text.strip():
                                            text_lines.append(str(text).strip())
                                            self.logger.info(f"[OCR] ✓ 从页面字典提取文本: {text[:100]}")
                                        
                                        # 如果还没有提取到文本，尝试递归提取
                                        if not text_lines:
                                            self.logger.info("[OCR] 常规方法未找到文本，尝试递归提取...")
                                            try:
                                                def extract_text_recursive(obj, depth=0):
                                                    if depth > 5:
                                                        return []
                                                    texts = []
                                                    if isinstance(obj, str):
                                                        if obj.strip() and len(obj.strip()) > 1:
                                                            texts.append(obj.strip())
                                                    elif isinstance(obj, (list, tuple)):
                                                        for item in obj:
                                                            texts.extend(extract_text_recursive(item, depth+1))
                                                    elif isinstance(obj, dict):
                                                        text_keys = ['text', 'content', 'ocr_text', 'result', 'rec_res', 'rec_text', 
                                                                    'ocr_result', 'rec', 'text_content', 'recognized_text']
                                                        for key in text_keys:
                                                            if key in obj:
                                                                value = obj[key]
                                                                extracted = extract_text_recursive(value, depth+1)
                                                                if extracted:
                                                                    texts.extend(extracted)
                                                        for key, value in obj.items():
                                                            if key not in text_keys and key not in ['input_img', 'rot_img', 'output_img', 
                                                                                                    'dt_polys', 'doc_preprocessor_res', 
                                                                                                    'model_settings', 'input_path', 'page_index']:
                                                                texts.extend(extract_text_recursive(value, depth+1))
                                                    return texts
                                                
                                                extracted_texts = extract_text_recursive(page)
                                                if extracted_texts:
                                                    text_lines.extend(extracted_texts)
                                                    self.logger.info(f"[OCR] ✓ 通过递归提取获得 {len(extracted_texts)} 条文本")
                                            except Exception as e:
                                                self.logger.warning(f"[OCR] 递归提取失败: {e}")
                                    else:
                                        # 其他类型，尝试转换为字符串
                                        text = str(page).strip()
                                        if text and len(text) > 3:
                                            text_lines.append(text)
                                            self.logger.info(f"[OCR] ✓ 从页面其他类型提取文本: {text[:100]}")
                                self.logger.info(f"[OCR] 列表格式解析完成，提取到{len(text_lines)}行文本")
                                if text_lines:
                                    self.logger.info(f"[OCR] 提取的文本行示例（前5行）: {text_lines[:5]}")
                            
                            # 方法4：处理对象属性（尝试获取常见属性）
                            if not text_lines and hasattr(result, '__dict__'):
                                self.logger.debug("[OCR] 尝试从对象属性提取文本")
                                for attr in ['text', 'ocr_text', 'result', 'content', 'data']:
                                    if hasattr(result, attr):
                                        value = getattr(result, attr)
                                        if isinstance(value, str):
                                            text_lines.append(value)
                                        elif isinstance(value, list):
                                            for item in value:
                                                if isinstance(item, str):
                                                    text_lines.append(item)
                            
                            if text_lines:
                                text = '\n'.join(text_lines)
                                self.logger.info(f"[OCR] PaddleOCR识别完成，文本长度: {len(text)}")
                                self.logger.info(f"[OCR] 识别文本预览（前1000字符）: {text[:1000]}")
                                # 如果文本长度超过1000，也显示后500字符
                                if len(text) > 1000:
                                    self.logger.debug(f"[OCR] 识别文本后500字符: {text[-500:]}")
                                return text
                            
                            # 如果所有方法都失败，记录详细信息并尝试最后的手段
                            self.logger.warning(f"[OCR] PaddleOCR识别结果格式异常，result类型: {type(result)}")
                            self.logger.warning(f"[OCR] result内容（前1000字符）: {str(result)[:1000]}")
                            
                            # 最后尝试：如果是列表，尝试直接转换为字符串
                            if isinstance(result, list):
                                self.logger.debug("[OCR] 尝试最后手段：将列表直接转换为文本")
                                try:
                                    # 尝试递归提取所有可能的文本
                                    def extract_text_recursive(obj, depth=0):
                                        if depth > 5:  # 增加深度限制，防止无限递归
                                            return []
                                        texts = []
                                        if isinstance(obj, str):
                                            if obj.strip() and len(obj.strip()) > 1:  # 过滤太短的字符串
                                                texts.append(obj.strip())
                                        elif isinstance(obj, (list, tuple)):
                                            for item in obj:
                                                texts.extend(extract_text_recursive(item, depth+1))
                                        elif isinstance(obj, dict):
                                            # 优先检查包含文本的字段
                                            text_keys = ['text', 'content', 'ocr_text', 'result', 'rec_res', 'rec_text', 
                                                        'ocr_result', 'rec', 'text_content', 'recognized_text']
                                            for key in text_keys:
                                                if key in obj:
                                                    value = obj[key]
                                                    extracted = extract_text_recursive(value, depth+1)
                                                    if extracted:
                                                        texts.extend(extracted)
                                            # 然后递归检查其他字段（但跳过图像数组等）
                                            for key, value in obj.items():
                                                if key not in text_keys and key not in ['input_img', 'rot_img', 'output_img', 
                                                                                        'dt_polys', 'doc_preprocessor_res', 
                                                                                        'model_settings', 'input_path', 'page_index']:
                                                    texts.extend(extract_text_recursive(value, depth+1))
                                        return texts
                                    
                                    all_texts = extract_text_recursive(result)
                                    if all_texts:
                                        text = '\n'.join(all_texts)
                                        self.logger.info(f"[OCR] 通过递归提取获得文本，长度: {len(text)}")
                                        return text
                                except Exception as e:
                                    self.logger.warning(f"[OCR] 递归提取失败: {e}")
                            
                            return ""
                        else:
                            self.logger.warning("[OCR] PaddleOCR识别结果为空")
                            return ""
                    except Exception as e:
                        self.logger.error(f"[OCR] PaddleOCR识别失败: {e}", exc_info=True)
                        return ""
                
                elif OCR_METHOD == 'easyocr':
                    # 使用EasyOCR（支持多语言）
                    try:
                        # 延迟初始化（首次使用时才加载模型）
                        if OCR_READER is None:
                            self.logger.info("[OCR] 正在初始化 EasyOCR（首次运行会下载模型，请稍候）...")
                            OCR_READER = easyocr.Reader(['ch_sim', 'en'], gpu=False)  # 中文简体+英文
                            self.logger.info("[OCR] EasyOCR 初始化完成")
                        
                        self.logger.debug("[OCR] 开始EasyOCR识别...")
                        result = OCR_READER.readtext(image)
                        if result:
                            # 提取所有文本
                            text_lines = [item[1] for item in result]  # item[1] 是识别的文本
                            text = '\n'.join(text_lines)
                            self.logger.info(f"[OCR] EasyOCR识别完成，文本长度: {len(text)}")
                            self.logger.debug(f"[OCR] 识别文本预览: {text[:200]}")
                            return text
                        else:
                            self.logger.warning("[OCR] EasyOCR识别结果为空")
                            return ""
                    except Exception as e:
                        self.logger.error(f"[OCR] EasyOCR识别失败: {e}", exc_info=True)
                        return ""
                
                elif OCR_METHOD == 'pytesseract':
                    # 使用pytesseract（需要Tesseract引擎）
                    try:
                        self.logger.debug("[OCR] 开始pytesseract识别...")
                        text = pytesseract.image_to_string(image, lang='chi_sim+eng')
                        self.logger.info(f"[OCR] pytesseract识别完成，文本长度: {len(text)}")
                        self.logger.debug(f"[OCR] 识别文本预览: {text[:200]}")
                        return text
                    except Exception as e:
                        self.logger.error(f"[OCR] pytesseract识别失败: {e}", exc_info=True)
                        return ""
                
            except ImportError:
                self.logger.warning("[OCR] pdf2image未安装，OCR功能不可用")
        except Exception as e:
            self.logger.error(f"[OCR] OCR识别失败: {e}", exc_info=True)
        
        return ""
    
    def ocr_image_with_api(self, pdf_path: str, page_num: int = 0) -> Dict:
        """使用二段式OCR API识别PDF（与插件逻辑一致）"""
        try:
            # 导入OCR API模块
            from ocr_api_python import (
                perform_two_stage_ocr, 
                load_config_from_file,
                OCR_CONFIG
            )
            
            # 加载配置
            load_config_from_file()
            
            # 将PDF第一页转换为图像并转换为data URL
            try:
                from pdf2image import convert_from_path
                from PIL import Image
                import io
                import base64
                
                self.logger.info(f"[OCR API] 正在将PDF转换为图像: {pdf_path}, 页码: {page_num}")
                images = convert_from_path(pdf_path, first_page=page_num+1, last_page=page_num+1, dpi=300)
                if not images:
                    self.logger.warning("[OCR API] PDF转图像失败，未生成图像")
                    return {'text': '', 'structured': None}
                
                image = images[0]
                self.logger.info(f"[OCR API] PDF转图像成功，图像尺寸: {image.size}")
                
                # 将图像转换为JPEG格式的data URL（与插件一致：scale=4, quality=0.95）
                # 注意：pdf2image已经设置了高DPI，这里直接转换为JPEG
                buffer = io.BytesIO()
                image.save(buffer, format='JPEG', quality=95)
                image_bytes = buffer.getvalue()
                image_base64 = base64.b64encode(image_bytes).decode('utf-8')
                image_data_url = f'data:image/jpeg;base64,{image_base64}'
                
                self.logger.info(f"[OCR API] 图像已转换为data URL，长度: {len(image_data_url)}")
                
                # 执行二段式OCR
                self.logger.info("[OCR API] 开始二段式OCR识别...")
                result = perform_two_stage_ocr(image_data_url)
                
                self.logger.info(f"[OCR API] ✓ 二段式OCR完成，文本长度: {len(result.get('text', ''))}, 是否结构化: {result.get('isStructured', False)}")
                
                return {
                    'text': result.get('text', ''),
                    'structured': result.get('structured'),
                    'isStructured': result.get('isStructured', False),
                    'parseError': result.get('parseError'),
                    'truncatedInput': result.get('truncatedInput', False)
                }
                
            except ImportError as e:
                self.logger.error(f"[OCR API] 缺少必要的库: {e}")
                self.logger.error("[OCR API] 请安装: pip install pdf2image pillow")
                return {'text': '', 'structured': None}
            except Exception as e:
                self.logger.error(f"[OCR API] OCR识别失败: {e}", exc_info=True)
                return {'text': '', 'structured': None}
                
        except ImportError:
            self.logger.error("[OCR API] 无法导入ocr_api_python模块，请确保ocr_api_python.py在同一目录")
            return {'text': '', 'structured': None}
        except Exception as e:
            self.logger.error(f"[OCR API] OCR API调用失败: {e}", exc_info=True)
            return {'text': '', 'structured': None}
    
    def extract_dates_from_text(self, text: str) -> Dict:
        """从文本中提取日期（参考test_pdf_extraction.html的逻辑）"""
        dates = {
            'received': None,
            'accepted': None,
            'published': None,
            'revised': None,
            'availableOnline': None,
            'other': []
        }
        
        # 日期关键词（按优先级排序，长的在前）
        date_keywords = {
            'revised': [
                'Received in revised form',
                'in revised form',
                'revised form',
                'Revised',
                'Revised:'
            ],
            'received': [
                'Received',
                'Received date',
                'Received:',
                'Submitted',
                'Submitted on',
                'Submission date'
            ],
            'accepted': [
                'Accepted',
                'Accepted date',
                'Accepted:',
                'Acceptance date'
            ],
            'availableOnline': [
                'Available online',
                'Available online:',
                'Available Online',
                'Available Online:',
                'available online',
                'available online:',
                'Published online',
                'Published online:',
                'Online available',
                'Online available:'
            ],
            'published': [
                'Published',
                'Published date',
                'Published:',
                'Publication date',
                'Date of publication'
            ]
        }
        
        # 日期格式（按优先级排序，更具体的格式优先）
        date_patterns = [
            re.compile(r'(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4})'),    # DD(st/nd/rd/th) Month YYYY
            re.compile(r'(\d{1,2}\s+[A-Z][a-z]+\s+\d{4})'),                    # DD Month YYYY
            re.compile(r'([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})'),  # Month DD(st/nd/rd/th), YYYY
            re.compile(r'([A-Z][a-z]+\s+\d{1,2},\s+\d{4})'),                   # Month DD, YYYY
            re.compile(r'(\d{4}[-/]\d{1,2}[-/]\d{1,2})'),                      # YYYY-MM-DD
            re.compile(r'(\d{1,2}[-/]\d{1,2}[-/]\d{4})'),                      # MM-DD-YYYY
            re.compile(r'(\d{4})')                                              # YYYY
        ]
        
        # 先提取Revised日期（必须在Received之前，因为"Received in revised form"包含"Received"）
        for keyword in date_keywords['revised']:
            keyword_regex = re.compile(re.escape(keyword), re.IGNORECASE)
            keyword_match = keyword_regex.search(text)
            if keyword_match:
                keyword_index = keyword_match.start()
                context = text[keyword_index:keyword_index + 200]
                context_normalized = re.sub(r'\s+', ' ', context)
                self.logger.debug(f"[日期提取] 检查Revised日期，关键词: {keyword}, 上下文: {context_normalized[:100]}")
                for pattern in date_patterns:
                    match = pattern.search(context_normalized)
                if match:
                        dates['revised'] = match.group(1)
                        self.logger.info(f"[日期提取] 找到Revised日期: {match.group(1)}")
                        break
                if dates['revised']:
                    break
        
        # 提取Received日期（排除已经被Revised匹配的部分）
        for keyword in date_keywords['received']:
            keyword_regex = re.compile(re.escape(keyword), re.IGNORECASE)
            for match in keyword_regex.finditer(text):
                keyword_index = match.start()
                # 检查这个位置是否属于"Received in revised form"（如果是，跳过）
                check_text = text[keyword_index:keyword_index + 30].lower()
                if 'received in revised form' in check_text or 'in revised form' in check_text:
                    continue  # 跳过，因为这是Revised日期的一部分
                
                context = text[keyword_index:keyword_index + 200]
                context_normalized = re.sub(r'\s+', ' ', context)
                self.logger.debug(f"[日期提取] 检查Received日期，关键词: {keyword}, 上下文: {context_normalized[:100]}")
                for pattern in date_patterns:
                    date_match = pattern.search(context_normalized)
                    if date_match:
                        dates['received'] = date_match.group(1)
                        self.logger.info(f"[日期提取] 找到Received日期: {date_match.group(1)}")
                        break
                if dates['received']:
                    break
            if dates['received']:
                break
        
        # 提取Accepted日期
        for keyword in date_keywords['accepted']:
            keyword_regex = re.compile(re.escape(keyword), re.IGNORECASE)
            keyword_match = keyword_regex.search(text)
            if keyword_match:
                keyword_index = keyword_match.start()
                context = text[keyword_index:keyword_index + 200]
                context_normalized = re.sub(r'\s+', ' ', context)
                self.logger.debug(f"[日期提取] 检查Accepted日期，关键词: {keyword}, 上下文: {context_normalized[:100]}")
                for pattern in date_patterns:
                    match = pattern.search(context_normalized)
                    if match:
                        dates['accepted'] = match.group(1)
                        self.logger.info(f"[日期提取] 找到Accepted日期: {match.group(1)}")
                        break
                if dates['accepted']:
                    break
        
        # 提取Available online日期（参考test_pdf_extraction.html的详细逻辑）
        for keyword in date_keywords['availableOnline']:
            # 使用更宽松的匹配，允许关键词前后有空格、换行等
            keyword_pattern = r'\b' + re.escape(keyword).replace(r'\s+', r'\s+') + r'\b'
            keyword_regex = re.compile(keyword_pattern, re.IGNORECASE)
            keyword_match = keyword_regex.search(text)
            if keyword_match:
                keyword_index = keyword_match.start()
                keyword_length = len(keyword_match.group(0))
                # 增加上下文长度到300字符
                context = text[keyword_index:keyword_index + 300]
                self.logger.debug(f"[日期提取] 检查Available online日期，关键词: {keyword}, 匹配位置: {keyword_index}, 上下文: {context[:150]}")
                
                # 在"Available online"之后直接查找日期
                found_date = False
                for pattern in date_patterns:
                    # 在上下文中查找所有匹配的日期
                    for date_match in pattern.finditer(context):
                        date_str = date_match.group(1)
                        date_index = date_match.start()
                        # 确保日期在"Available online"之后（至少跳过关键词本身）
                        if date_index >= keyword_length:
                            # 检查日期是否紧跟在"Available online"之后（在80个字符内）
                            distance_from_keyword = date_index - keyword_length
                            if distance_from_keyword <= 80:
                                # 检查日期前是否有期刊信息
                                before_date = context[keyword_length:date_index]
                                before_date_normalized = re.sub(r'\s+', ' ', before_date)
                                has_journal_info = re.search(r'(Computers|Electronics|Agriculture|Journal|Volume|Vol\.|\(\d{4}\)|doi|\d{6})', before_date_normalized, re.IGNORECASE)
                                
                                # 如果日期前有期刊信息，但距离关键词较近（<50字符），可能是Available online的日期
                                # 如果日期前没有期刊信息，直接使用
                                if not has_journal_info or distance_from_keyword < 50:
                                    dates['availableOnline'] = date_str
                                    self.logger.info(f"[日期提取] 找到Available online日期: {date_str}, 距离关键词: {distance_from_keyword} 字符")
                                    found_date = True
                                    break
                        else:
                                    self.logger.debug(f"[日期提取] 跳过日期（期刊信息干扰）: {date_str}, 距离: {distance_from_keyword}")
                    if found_date:
                        break
                
                # 如果没找到，尝试更宽松的匹配（在"Available online"之后查找任何日期）
                if not found_date:
                    search_start = keyword_index + keyword_length
                    search_text = text[search_start:search_start + 100]  # 只搜索100字符
                    self.logger.debug(f"[日期提取] Available online后搜索区域（宽松匹配）: {search_text[:100]}")
                    for pattern in date_patterns:
                        match = pattern.search(search_text)
                        if match:
                            dates['availableOnline'] = match.group(1)
                            self.logger.info(f"[日期提取] 找到Available online日期（宽松匹配）: {match.group(1)}")
                            found_date = True
                            break
                
                if found_date:
                    break
        
        # 提取Published日期（如果Available online没找到）
        if not dates['availableOnline']:
            for keyword in date_keywords['published']:
                keyword_regex = re.compile(re.escape(keyword), re.IGNORECASE)
                keyword_match = keyword_regex.search(text)
                if keyword_match:
                    keyword_index = keyword_match.start()
                    context = text[keyword_index:keyword_index + 200]
                    context_normalized = re.sub(r'\s+', ' ', context)
                    self.logger.debug(f"[日期提取] 检查Published日期，关键词: {keyword}, 上下文: {context_normalized[:100]}")
                    for pattern in date_patterns:
                        match = pattern.search(context_normalized)
                        if match:
                            dates['published'] = match.group(1)
                            self.logger.info(f"[日期提取] 找到Published日期: {match.group(1)}")
                            break
                    if dates['published']:
                        break
        
        # 标准化所有日期
        for key in ['received', 'revised', 'accepted', 'published', 'availableOnline']:
            if dates[key]:
                normalized = self.normalize_date(dates[key])
                if normalized:
                    dates[key] = normalized
        
        return dates
    
    def convert_chinese_to_pinyin(self, chinese: str) -> str:
        """转换中文为拼音（与扩展逻辑一致）"""
        if not HAS_PINYIN or not chinese:
            self.logger.debug(f"[拼音转换] 跳过转换（无拼音库或输入为空）: {chinese}")
            return chinese
        
        try:
            # 使用pypinyin转换
            pinyin_list = lazy_pinyin(chinese, style=Style.NORMAL)
            # 首字母大写
            pinyin = ' '.join([p.capitalize() for p in pinyin_list])
            self.logger.debug(f"[拼音转换] 初始转换结果: {chinese} -> {pinyin}")
            
            # 处理连续重复的名字部分（如"Wang Meng Meng" -> "Wang Mengmeng"）
            words = pinyin.split()
            if len(words) >= 2:
                # 扩展常见姓氏列表
                common_surnames = ['wang', 'zhang', 'li', 'liu', 'chen', 'yang', 'zhao', 'huang',
                                 'zhou', 'wu', 'xu', 'sun', 'hu', 'zhu', 'gao', 'lin', 'guo', 'deng', 'he', 'shi',
                                 'tian', 'deng', 'ma', 'luo', 'liang', 'song', 'zheng', 'xie', 'han', 'tang', 'feng',
                                 'yu', 'dong', 'xiao', 'cheng', 'cao', 'yuan', 'xu', 'fu', 'shen', 'zeng', 'peng',
                                 'lv', 'su', 'lu', 'jiang', 'cai', 'jia', 'ding', 'wei', 'xue', 'ye', 'yan', 'pan',
                                 'ji', 'ji'] 
                first_word = words[0].lower()
                
                if first_word in common_surnames:
                    surname = words[0]
                    given_name = ''.join(words[1:]) 
                    result = f"{surname} {given_name}"
                    self.logger.debug(f"[拼音转换] 姓在前，合并名部分: {pinyin} -> {result}")
                    return result
                else:
                    last_word = words[-1].lower()
                    if last_word in common_surnames:
                        given_name = ''.join(words[:-1])
                        surname = words[-1]
                        result = f"{surname} {given_name}"
                        self.logger.debug(f"[拼音转换] 名在前，姓在后，合并名部分: {pinyin} -> {result}")
                        return result
                    else:
                        # 尝试合并连续相同的词
                        merged = []
                        for i, word in enumerate(words):
                            if i > 0 and word.lower() == words[i-1].lower():
                                continue
                            merged.append(word)
                        result = ' '.join(merged)
                        self.logger.debug(f"[拼音转换] 合并重复词: {pinyin} -> {result}")
                        return result
            
            self.logger.debug(f"[拼音转换] 最终结果（单词）: {pinyin}")
            return pinyin
        except Exception as e:
            self.logger.warning(f"[拼音转换] 转换失败: {e}")
            return chinese
    
    def check_author_match(self, web_author: str, pdf_author: str) -> bool:
        """检查作者匹配（与扩展逻辑完全一致，支持姓在前或名在前）"""
        self.logger.debug(f"[作者匹配] 开始匹配 - 网页作者: {web_author}, PDF作者: {pdf_author}")
        if not web_author or not pdf_author:
            self.logger.debug("[作者匹配] 作者名为空，匹配失败")
            return False
        
        if any('\u4e00' <= char <= '\u9fff' for char in web_author):
            self.logger.debug("[作者匹配] 检测到中文作者，转换为拼音")
            web_pinyin = self.convert_chinese_to_pinyin(web_author).lower()
            web_pinyin_norm = re.sub(r'[^a-z\s]', '', web_pinyin).strip()
            web_pinyin_words = web_pinyin_norm.split()
            self.logger.debug(f"[作者匹配] 拼音转换结果: {web_pinyin} -> {web_pinyin_norm}, 分词: {web_pinyin_words}")
            
            # 对PDF作者进行标准化
            pdf_norm = re.sub(r'[^a-z\s]', '', pdf_author.lower()).strip()
            pdf_words = pdf_norm.split()
            self.logger.debug(f"[作者匹配] PDF标准化后 - pdf_norm: {pdf_norm}, pdf_words: {pdf_words}")
            
            if not pdf_norm:
                self.logger.debug("[作者匹配] PDF作者标准化后为空，匹配失败")
                return False
            
            # 检查拼音是否匹配
            if len(web_pinyin_words) >= 2:
                # 方法1：检查完全匹配（顺序相同）
                if web_pinyin_norm == pdf_norm:
                    self.logger.info(f"[作者匹配] ✓ 完全匹配成功: {web_pinyin_norm} == {pdf_norm}")
                    return True
                
                # 检查：所有web_pinyin_words是否都在pdf_words中（顺序无关，支持部分匹配）
                all_web_in_pdf = all(w in pdf_words for w in web_pinyin_words)
                all_pdf_in_web = all(w in web_pinyin_words for w in pdf_words)
                self.logger.info(f"[作者匹配] 顺序互换检查: all_web_in_pdf={all_web_in_pdf}, all_pdf_in_web={all_pdf_in_web}, "
                                f"web_words={web_pinyin_words}, pdf_words={pdf_words}, "
                                f"web_pinyin_norm={web_pinyin_norm}, pdf_norm={pdf_norm}")
                
                if all_web_in_pdf and all_pdf_in_web:
                    # 如果词数相同，完全匹配
                    if len(web_pinyin_words) == len(pdf_words):
                        self.logger.info(f"[作者匹配] ✓ 顺序互换匹配成功（词数相同）: {web_pinyin_norm} <-> {pdf_norm}")
                        return True
                    # 如果词数不同，但所有词都匹配，也认为匹配（例如："tian ji chen" vs "jichen tian"）
                    if len(web_pinyin_words) >= 2 and len(pdf_words) >= 2:
                        matched_count = sum(1 for w in web_pinyin_words if w in pdf_words)
                        self.logger.info(f"[作者匹配] 词数不同但匹配检查: 匹配词数={matched_count}, web_words={web_pinyin_words}, pdf_words={pdf_words}")
                        if matched_count >= 2:
                            self.logger.info(f"[作者匹配] ✓ 顺序互换匹配成功（词数不同但所有词匹配）: {web_pinyin_norm} <-> {pdf_norm}")
                            return True
                
                # 方法2.1：即使不是完全匹配，如果主要词匹配也认为匹配（支持拼写错误，如"jichen tiana"）
                # 检查：至少姓和名的主要部分都匹配
                if len(web_pinyin_words) >= 2 and len(pdf_words) >= 2:
                    # 尝试匹配姓和名（支持顺序互换）
                    web_surname = web_pinyin_words[0]
                    web_given = ''.join(web_pinyin_words[1:])  # 合并名部分
                    
                    # PDF可能是姓在前或名在前
                    pdf_surname_first = pdf_words[0]
                    pdf_given_first = ''.join(pdf_words[1:])
                    pdf_surname_last = pdf_words[-1]
                    pdf_given_last = ''.join(pdf_words[:-1])
                    
                    # 检查：姓匹配 + 名匹配（支持包含关系，如"jichen" in "jichena"）
                    surname_match_first = (web_surname == pdf_surname_first or 
                                         web_surname in pdf_surname_first or 
                                         pdf_surname_first in web_surname)
                    given_match_first = (web_given == pdf_given_first or 
                                       web_given in pdf_given_first or 
                                       pdf_given_first in web_given)
                    
                    surname_match_last = (web_surname == pdf_surname_last or 
                                         web_surname in pdf_surname_last or 
                                         pdf_surname_last in web_surname)
                    given_match_last = (web_given == pdf_given_last or 
                                      web_given in pdf_given_last or 
                                      pdf_given_last in web_given)
                    
                    self.logger.debug(f"[作者匹配] 主要词匹配检查: web_surname={web_surname}, web_given={web_given}, "
                                    f"pdf_first={pdf_surname_first}/{pdf_given_first}, pdf_last={pdf_surname_last}/{pdf_given_last}, "
                                    f"match_first={surname_match_first}/{given_match_first}, match_last={surname_match_last}/{given_match_last}")
                    
                    if (surname_match_first and given_match_first) or (surname_match_last and given_match_last):
                        self.logger.info(f"[作者匹配] ✓ 主要词匹配成功: {web_pinyin_norm} <-> {pdf_norm}")
                        return True
                
                # 方法2.5：即使不是所有词都匹配，如果主要词（姓和名）都匹配也认为匹配
                # 例如："tian jichen" vs "jichen tiana"（有拼写错误但主要部分匹配）
                if len(web_pinyin_words) >= 2 and len(pdf_words) >= 2:
                    # 检查姓和名是否都匹配（允许顺序互换和部分匹配）
                    web_surname = web_pinyin_words[0]
                    web_given = ''.join(web_pinyin_words[1:])  # 名可能被合并
                    pdf_surname = pdf_words[-1]  # 如果名在前，姓在最后
                    pdf_given = ''.join(pdf_words[:-1])  # 名在前的部分
                    pdf_surname_first = pdf_words[0]  # 如果姓在前
                    pdf_given_first = ''.join(pdf_words[1:])  # 姓在前的名部分
                    
                    self.logger.debug(f"[作者匹配] 姓/名分别匹配检查: web_surname={web_surname}, web_given={web_given}, "
                                    f"pdf_surname_last={pdf_surname}, pdf_given_last={pdf_given}, "
                                    f"pdf_surname_first={pdf_surname_first}, pdf_given_first={pdf_given_first}")
                    
                    # 检查：web姓匹配pdf姓，web名匹配pdf名（支持顺序互换和包含关系）
                    surname_match_last = (web_surname == pdf_surname or 
                                         web_surname in pdf_surname or 
                                         pdf_surname in web_surname)
                    given_match_last = (web_given == pdf_given or 
                                      web_given in pdf_given or 
                                      pdf_given in web_given)
                    
                    surname_match_first = (web_surname == pdf_surname_first or 
                                          web_surname in pdf_surname_first or 
                                          pdf_surname_first in web_surname)
                    given_match_first = (web_given == pdf_given_first or 
                                       web_given in pdf_given_first or 
                                       pdf_given_first in web_given)
                    
                    self.logger.debug(f"[作者匹配] 姓/名匹配结果: surname_last={surname_match_last}, given_last={given_match_last}, "
                                    f"surname_first={surname_match_first}, given_first={given_match_first}")
                    
                    if (surname_match_last and given_match_last) or (surname_match_first and given_match_first):
                        self.logger.info(f"[作者匹配] ✓ 姓/名分别匹配成功: {web_pinyin_norm} <-> {pdf_norm}")
                        return True
                
                # 方法3：检查部分匹配（姓匹配 + 名匹配，顺序无关）
                web_surname = web_pinyin_words[0]  # 假设第一个是姓
                web_given_name_parts = web_pinyin_words[1:]  # 其余是名
                web_given_name_combined = ''.join(web_given_name_parts)
                
                # PDF可能是姓在前或名在前
                # 尝试：PDF姓在最后（名在前格式，如 "Jichen Tian"）
                pdf_surname_last = pdf_words[-1]
                pdf_given_name_parts_last = pdf_words[:-1]
                pdf_given_name_combined_last = ''.join(pdf_given_name_parts_last)
                
                # 尝试：PDF姓在最前（姓在前格式，如 "Tian Jichen"）
                pdf_surname_first = pdf_words[0]
                pdf_given_name_parts_first = pdf_words[1:]
                pdf_given_name_combined_first = ''.join(pdf_given_name_parts_first)
                
                self.logger.info(f"[作者匹配] 方法3-姓/名分别匹配检查: web_surname={web_surname}, web_given={web_given_name_combined}, "
                                f"pdf_surname_last={pdf_surname_last}, pdf_given_last={pdf_given_name_combined_last}, "
                                f"pdf_surname_first={pdf_surname_first}, pdf_given_first={pdf_given_name_combined_first}")
                
                # 检查匹配：姓匹配 + 名匹配（支持顺序互换和包含关系）
                # 情况1：PDF名在前（"Jichen Tian"）- web姓匹配PDF姓，web名匹配PDF名
                surname_match_last = (web_surname == pdf_surname_last or 
                                     web_surname in pdf_surname_last or 
                                     pdf_surname_last in web_surname)
                given_name_match_last = (web_given_name_combined == pdf_given_name_combined_last or
                                        web_given_name_combined in pdf_given_name_combined_last or
                                        pdf_given_name_combined_last in web_given_name_combined)
                
                # 情况2：PDF姓在前（"Tian Jichen"）- web姓匹配PDF姓，web名匹配PDF名
                surname_match_first = (web_surname == pdf_surname_first or 
                                      web_surname in pdf_surname_first or 
                                      pdf_surname_first in web_surname)
                given_name_match_first = (web_given_name_combined == pdf_given_name_combined_first or
                                         web_given_name_combined in pdf_given_name_combined_first or
                                         pdf_given_name_combined_first in web_given_name_combined)
                
                # 情况3：顺序完全互换（web姓匹配PDF名，web名匹配PDF姓）
                surname_match_reversed = (web_surname == pdf_given_name_combined_last or
                                         web_surname in pdf_given_name_combined_last or
                                         pdf_given_name_combined_last in web_surname)
                given_name_match_reversed = (web_given_name_combined == pdf_surname_last or
                                            web_given_name_combined in pdf_surname_last or
                                            pdf_surname_last in web_given_name_combined)
                
                self.logger.info(f"[作者匹配] 方法3-姓/名匹配结果: surname_last={surname_match_last}, given_last={given_name_match_last}, "
                                f"surname_first={surname_match_first}, given_first={given_name_match_first}, "
                                f"surname_rev={surname_match_reversed}, given_rev={given_name_match_reversed}")
                
                if (surname_match_last and given_name_match_last) or \
                   (surname_match_first and given_name_match_first) or \
                   (surname_match_reversed and given_name_match_reversed):
                    self.logger.info(f"[作者匹配] ✓ 方法3-姓/名分别匹配成功: {web_pinyin_norm} <-> {pdf_norm}")
                    return True
        
        # 英文名字匹配（支持顺序互换）
        # 标准化：转小写，移除标点，保留空格
        web_norm = re.sub(r'[^a-z\s]', '', web_author.lower()).strip()
        pdf_norm = re.sub(r'[^a-z\s]', '', pdf_author.lower()).strip()
        
        self.logger.debug(f"[作者匹配] 英文标准化后 - web_norm: {web_norm}, pdf_norm: {pdf_norm}")
        
        if not web_norm or not pdf_norm:
            self.logger.debug("[作者匹配] 标准化后为空，匹配失败")
            return False
        
        web_words = web_norm.split()
        pdf_words = pdf_norm.split()
        
        self.logger.debug(f"[作者匹配] 英文分词后 - web_words: {web_words}, pdf_words: {pdf_words}")
        
        # 如果只有一个词，直接比较
        if len(web_words) < 2 or len(pdf_words) < 2:
            return web_norm == pdf_norm
        
        # 方法1：完全匹配
        if web_norm == pdf_norm:
            self.logger.info(f"[作者匹配] ✓ 完全匹配成功: {web_norm} == {pdf_norm}")
            return True
        
        # 方法2：检查所有词是否都匹配（顺序无关）
        # 例如："Wang Mengmeng" vs "Mengmeng Wang"
        all_web_in_pdf = all(w in pdf_words for w in web_words)
        all_pdf_in_web = all(w in web_words for w in pdf_words)
        if all_web_in_pdf and all_pdf_in_web:
            self.logger.info(f"[作者匹配] ✓ 顺序互换匹配成功: {web_norm} <-> {pdf_norm}")
            return True
        
        # 方法3：检查姓和名分别匹配（支持顺序互换）
        web_first = web_words[0]
        web_last = web_words[-1]
        pdf_first = pdf_words[0]
        pdf_last = pdf_words[-1]
        
        # 相同顺序：姓匹配 + 名匹配
        same_order = ((web_first == pdf_first or web_first in pdf_first or pdf_first in web_first) and
                     (web_last == pdf_last or web_last in pdf_last or pdf_last in web_last))
        
        # 顺序互换：web的姓匹配pdf的名，web的名匹配pdf的姓
        reversed_order = ((web_first == pdf_last or web_first in pdf_last or pdf_last in web_first) and
                         (web_last == pdf_first or web_last in pdf_first or pdf_first in web_last))
        
        if same_order or reversed_order:
            self.logger.info(f"[作者匹配] ✓ 姓/名分别匹配成功: {web_norm} <-> {pdf_norm}")
            return True
        
        # 方法4：检查包含关系
        if web_norm in pdf_norm or pdf_norm in web_norm:
            self.logger.info(f"[作者匹配] ✓ 包含关系匹配成功: {web_norm} <-> {pdf_norm}")
            return True
        
        self.logger.debug(f"[作者匹配] ✗ 所有匹配方法都失败: {web_norm} vs {pdf_norm}")
        return False
    
    def check_date_match(self, web_date: str, pdf_dates: Dict) -> bool:
        """检查日期匹配（与扩展逻辑一致，支持多种日期类型和优先级）"""
        if not web_date:
            return False
        
        web_normalized = self.normalize_date(web_date)
        if not web_normalized:
            return False
        
        # 按优先级检查：Received > Revised > Accepted > Published > Available online > Other
        priority_order = ['received', 'revised', 'accepted', 'published', 'availableOnline', 'other']
        
        for date_type in priority_order:
            if date_type == 'other':
                if pdf_dates.get('other'):
                    for date in pdf_dates['other']:
                        normalized = self.normalize_date(date)
                        if normalized == web_normalized:
                            return True
            else:
                pdf_date = pdf_dates.get(date_type)
                if pdf_date:
                    normalized = self.normalize_date(pdf_date)
                    if normalized == web_normalized:
                        return True
        
        # 检查general日期
        general_date = pdf_dates.get('general')
        if general_date:
            normalized = self.normalize_date(general_date)
            if normalized == web_normalized:
                return True
        
        return False
    
    def normalize_title(self, title: str) -> str:
        """标准化标题（去除标点符号和空格）"""
        return re.sub(r'[^\w\u4e00-\u9fa5]', '', title.lower())
    
    def calculate_similarity(self, str1: str, str2: str) -> float:
        """计算字符串相似度（与扩展逻辑一致）"""
        longer = str1 if len(str1) > len(str2) else str2
        shorter = str2 if len(str1) > len(str2) else str1
        
        if len(longer) == 0:
            return 1.0
        
        # 检查包含关系
        if shorter in longer:
            return len(shorter) / len(longer)
        
        # 检查前N个字符匹配
        min_length = min(len(str1), len(str2))
        match_count = 0
        for i in range(min_length):
            if str1[i] == str2[i]:
                match_count += 1
            else:
                break
        
        return match_count / len(longer)
    
    def check_title_match(self, web_title: str, pdf_title: str) -> bool:
        """检查标题匹配（与扩展逻辑完全一致）"""
        if not web_title or not pdf_title:
            self.logger.debug('[验证] 标题为空，不匹配')
            return False
        
        web_norm = self.normalize_title(web_title)
        pdf_norm = self.normalize_title(pdf_title)
        
        if not web_norm or not pdf_norm:
            self.logger.debug('[验证] 标准化后标题为空，不匹配')
            return False
        
        # 如果标题太短，不匹配（与插件逻辑一致）
        if len(web_norm) < 10 or len(pdf_norm) < 10:
            self.logger.debug(f'[验证] 标题太短，不匹配: web_length={len(web_norm)}, pdf_length={len(pdf_norm)}')
            return False
        
        # 完全匹配
        if web_norm == pdf_norm:
            return True
        
        # 包含关系（一个包含另一个）- 更严格的条件（与插件逻辑一致）
        if web_norm in pdf_norm or pdf_norm in web_norm:
            # 如果较短的标题长度 >= 较长标题的60%，且较短标题至少30个字符，认为是匹配
            shorter = web_norm if len(web_norm) < len(pdf_norm) else pdf_norm
            longer = pdf_norm if len(web_norm) < len(pdf_norm) else web_norm
            ratio = len(shorter) / len(longer)
            if len(shorter) >= 30 and ratio >= 0.6:
                self.logger.debug(f'[验证] 标题包含匹配: shorter={shorter[:50]}, longer={longer[:50]}, ratio={ratio:.2f}')
                return True
            else:
                self.logger.debug(f'[验证] 标题包含但比例不足: shorter={shorter[:50]}, longer={longer[:50]}, ratio={ratio:.2f}, minLength={len(shorter)}')
        
        # 相似度检查 - 更严格的条件（与插件逻辑一致）
        similarity = self.calculate_similarity(web_norm, pdf_norm)
        if similarity > 0.75 and len(web_norm) >= 20 and len(pdf_norm) >= 20:
            self.logger.debug(f'[验证] 标题相似度匹配: similarity={similarity:.2f}, web_length={len(web_norm)}, pdf_length={len(pdf_norm)}')
            return True
        elif similarity > 0.7:
            self.logger.debug(f'[验证] 标题相似度不足或长度不够: similarity={similarity:.2f}, web_length={len(web_norm)}, pdf_length={len(pdf_norm)}')
        
        # 前70%字符匹配（对于较长的标题，至少30个字符）（与插件逻辑一致）
        if len(web_norm) >= 30 and len(pdf_norm) >= 30:
            web_prefix = web_norm[:int(len(web_norm) * 0.7)]
            pdf_prefix = pdf_norm[:int(len(pdf_norm) * 0.7)]
            if web_prefix == pdf_prefix and len(web_prefix) >= 30:
                self.logger.debug('[验证] 标题前缀匹配（70%，至少30字符）')
                return True
        
        # 对于OCR标题，如果OCR标题是网页标题的前缀（至少50个字符，且相似度>0.8），也认为匹配
        if len(pdf_norm) >= 50 and len(web_norm) >= 50:
            prefix_length = min(50, len(pdf_norm))
            web_prefix = web_norm[:prefix_length]
            pdf_prefix = pdf_norm[:prefix_length]
            prefix_similarity = self.calculate_similarity(web_prefix, pdf_prefix)
            if prefix_similarity > 0.8:
                self.logger.debug('[验证] OCR标题前缀匹配（50字符，相似度>0.8）')
                return True
        
        # 如果网页标题是OCR标题的前缀（至少50个字符，且相似度>0.8），也认为匹配
        if len(web_norm) >= 50 and len(pdf_norm) >= 50:
            prefix_length = min(50, len(web_norm))
            web_prefix = web_norm[:prefix_length]
            pdf_prefix = pdf_norm[:prefix_length]
            prefix_similarity = self.calculate_similarity(web_prefix, pdf_prefix)
            if prefix_similarity > 0.8:
                self.logger.debug('[验证] 网页标题前缀匹配（50字符，相似度>0.8）')
                return True
        
        self.logger.debug('[验证] 标题不匹配，所有条件都不满足')
        return False
    
    def extract_title_from_text(self, text: str) -> str:
        """从文本中提取标题（智能识别，过滤页眉页脚等，支持多行标题）"""
        self.logger.debug("[标题提取] 开始从文本提取标题")
        if not text:
            self.logger.warning("[标题提取] 输入文本为空")
            return ''
        
        # 优先从前5000个字符中提取（标题通常在开头，可能需要多行）
        search_text = text[:5000]
        lines = search_text.split('\n')
        self.logger.debug(f"[标题提取] 检查前 {len(lines)} 行，文本长度: {len(search_text)}")
        
        # 无效标题模式（页眉、页脚、期刊信息等）
        invalid_patterns = [
            r'^\d+\.\.\d+',  # 如 "1..11 ++"
            r'^[A-Z0-9]{5,20}\s+\d+',  # 如 "D5NR03036F 1"
            r'^view\s+(article|journal|pdf)',  # "View Article Online"
            r'^published\s+on',  # "Published on ..."
            r'^downloaded\s+on',  # "Downloaded on ..."
            r'^doi:',  # "DOI: ..."
            r'^rsc\.li/',  # "rsc.li/..."
            r'^check\s+for\s+updates',  # "Check for updates"
            r'^cite\s+this:',  # "Cite this:"
            r'^received\s+\d+',  # "Received ..."
            r'^accepted\s+\d+',  # "Accepted ..."
            r'^nanoscale|^paper$',  # 期刊名
            r'^royal\s+society',  # "Royal Society"
        ]
        
        # 候选标题列表（按优先级排序）
        candidates = []
        
        # 方法1：尝试单行标题
        for i, line in enumerate(lines[:30]):  # 检查前30行
            line = line.strip()
            if not line:
                continue
            
            # 移除 "TITLE:" 等前缀
            line = re.sub(r'^(title|标题)[:\s]+', '', line, flags=re.IGNORECASE).strip()
            
            # 跳过明显无效的行
            is_invalid = False
            for pattern in invalid_patterns:
                if re.match(pattern, line, re.IGNORECASE):
                    is_invalid = True
                    break
            
            if is_invalid:
                continue
            
            # 跳过 "Introduction" 等章节标题
            if re.match(r'^(introduction|abstract|keywords|摘要|关键词)', line, re.IGNORECASE):
                continue
            
            if len(line) < 20 or len(line) > 500:  # 增加最大长度限制
                continue
            
            if 'http' in line or '@' in line or 'doi:' in line.lower():
                continue
            
            # 检查是否包含有效字符（小写字母或中文）
            has_lowercase = bool(re.search(r'[a-z]', line))
            has_chinese = bool(re.search(r'[\u4e00-\u9fa5]', line))
            
            if not (has_lowercase or has_chinese):
                continue
            
            # 检查是否全是大写（可能是页眉）
            if line.isupper() and len(line) > 15:
                continue
            
            # 检查是否包含常见标题关键词（提高优先级）
            title_keywords = [
                'computational', 'screening', 'analysis', 'study', 'investigation',
                'method', 'approach', 'framework', 'model', 'system',
                '基于', '研究', '方法', '分析', '系统'
            ]
            has_keyword = any(kw.lower() in line.lower() for kw in title_keywords)
            
            # 计算优先级（越靠前、越像标题的行优先级越高）
            priority = 100 - i  # 行号越小优先级越高
            if has_keyword:
                priority += 50  # 包含关键词的优先级更高
            
            candidates.append((priority, line))
        
        # 方法2：尝试多行标题（如果单行标题被截断）
        # 检查是否有以 "TITLE:" 开头的行，然后合并后续行
        for i, line in enumerate(lines[:20]):
            line = line.strip()
            if re.match(r'^(title|标题)[:\s]+', line, re.IGNORECASE):
                # 找到标题行，尝试合并后续行
                title_parts = [re.sub(r'^(title|标题)[:\s]+', '', line, flags=re.IGNORECASE).strip()]
                # 合并后续行（直到遇到空行或明显不是标题的内容）
                for j in range(i + 1, min(i + 5, len(lines))):
                    next_line = lines[j].strip()
                    if not next_line:
                        break
                    # 如果下一行看起来像标题的延续（长度适中，包含小写字母）
                    if (len(next_line) > 10 and 
                        (re.search(r'[a-z]', next_line) or re.search(r'[\u4e00-\u9fa5]', next_line)) and
                        not re.match(r'^(introduction|abstract|keywords|摘要|关键词|received|accepted)', next_line, re.IGNORECASE)):
                        title_parts.append(next_line)
                    else:
                        break
                
                if len(title_parts) > 1:
                    combined_title = ' '.join(title_parts)
                    if 20 <= len(combined_title) <= 500:  # 增加最大长度限制，支持长标题
                        priority = 150 - i  # 多行标题优先级更高
                        candidates.append((priority, combined_title))
        
        # 方法3：智能合并连续的长行（可能是被OCR分割的标题）
        # 如果前几行都是长行（>20字符），且包含小写字母，可能是标题
        title_parts_auto = []
        for i, line in enumerate(lines[:10]):  # 检查前10行
            line = line.strip()
            if not line:
                if title_parts_auto:  # 遇到空行，停止合并
                    break
                continue
            
            # 跳过明显无效的行
            is_invalid = False
            for pattern in invalid_patterns:
                if re.match(pattern, line, re.IGNORECASE):
                    is_invalid = True
                    break
            
            if is_invalid:
                if title_parts_auto:  # 遇到无效行，停止合并
                    break
                continue
            
            # 如果这一行看起来像标题的一部分（长度>20，包含小写字母，不是章节标题）
            if (len(line) > 20 and 
                (re.search(r'[a-z]', line) or re.search(r'[\u4e00-\u9fa5]', line)) and
                not re.match(r'^(introduction|abstract|keywords|摘要|关键词|received|accepted|published)', line, re.IGNORECASE) and
                not 'http' in line and not '@' in line):
                title_parts_auto.append(line)
            elif title_parts_auto:  # 如果已经开始收集标题，但这一行不符合，停止
                break
        
        # 如果收集到了多行，合并作为候选标题
        if len(title_parts_auto) >= 1:
            combined_title_auto = ' '.join(title_parts_auto)
            if 20 <= len(combined_title_auto) <= 500:  # 支持长标题
                # 检查是否包含标题关键词
                has_keyword = any(kw.lower() in combined_title_auto.lower() for kw in title_keywords)
                priority = 120 if has_keyword else 80  # 包含关键词的优先级更高
                candidates.append((priority, combined_title_auto))
                self.logger.debug(f"[标题提取] 自动合并多行标题: {combined_title_auto[:100]}")
        
        # 按优先级排序，返回最高优先级的候选
        if candidates:
            candidates.sort(reverse=True, key=lambda x: x[0])
            result = candidates[0][1]
            self.logger.info(f"[标题提取] ✓ 提取成功，找到 {len(candidates)} 个候选，选择: '{result[:100]}'")
            return result
        
        self.logger.warning("[标题提取] ✗ 未找到有效的标题")
        return ''
    
    def extract_author_from_text(self, text: str) -> str:
        """从文本中提取第一作者（智能识别，过滤无效内容）"""
        self.logger.info("[作者提取] ========== 开始从文本提取作者 ==========")
        if not text:
            self.logger.warning("[作者提取] 输入文本为空")
            return ''
        
        # 优先从前3000个字符中提取（作者通常在标题附近）
        search_text = text[:3000]
        lines = search_text.split('\n')
        self.logger.info(f"[作者提取] 检查前 {len(lines)} 行，文本长度: {len(search_text)}")
        self.logger.debug(f"[作者提取] 前20行内容: {lines[:20]}")
        
        # 无效作者名列表（品牌名、期刊名、系统名等）
        invalid_names = [
            'compaq', 'hp', 'dell', 'lenovo', 'acer', 'microsoft', 'apple', 'samsung',
            'huawei', 'xiaomi', 'computer', 'pc', 'desktop', 'laptop', 'server', 'system',
            'device', 'machine', 'fields', 'admin', 'user', 'asus', 'administrator', 'test',
            'open access', 'international journal', 'expert systems', 'direct journals',
            'elsevier', 'science direct', 'creative commons', 'the author', 'this article',
            'attribution', 'noderivatives', 'research', 'volume', 'vol.', 'int. j.',
            'introduction', 'abstract', 'keywords', 'received', 'accepted', 'published',
            'nanoscale', 'royal society', 'chemistry', 'view article', 'view journal',
            'check for updates', 'cite this', 'doi:', 'rsc.li', 'dear professor', 'dear dr',
            'manuscript number', 'engineering structures', 'engineering failure',
            'engineering failure analysis', 'failure analysis', 'analysis', 'engineering',
            'journal', 'article', 'paper', 'publication', 'publisher', 'editorial',
            'editor', 'reviewer', 'correspondence', 'corresponding author', 'author',
            'authors', 'affiliation', 'department', 'university', 'institute', 'college',
            'school', 'laboratory', 'lab', 'center', 'centre', 'organization', 'company'
        ]
        
        # 作者匹配模式（按优先级排序）
        author_patterns = [
            # 格式1: "Firstname Lastname, Firstname Lastname, ..." (多个作者，逗号分隔)
            # 匹配第一个作者（在逗号之前）
            r'^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[,;]',
            # 格式2: "Firstname Lastname a,b,c" (带标记，如 "Jiaxiang Wu a,b,c")
            r'^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+[a-z]\s*[,;]',
            # 格式3: "Firstname Lastname" 或 "Firstname Middle Lastname" (单个作者，行首)
            r'^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$',
            # 格式4: "Firstname M. Lastname"
            r'^([A-Z][a-z]+\s+[A-Z]\.\s+[A-Z][a-z]+)\s*$',
            # 格式5: "Lastname, Firstname" (需要转换为 "Firstname Lastname")
            r'^([A-Z][a-z]+),\s+([A-Z][a-z]+(?:\s+[A-Z]\.)?)\s*$',
            # 格式6: 中文作者名
            r'^([\u4e00-\u9fa5]{2,4}(?:\s+[\u4e00-\u9fa5]{2,4}){0,2})\s*$',
        ]
        
        # 候选作者列表
        candidates = []
        
        for i, line in enumerate(lines[:40]):  # 检查前40行
            line = line.strip()
            if not line:
                continue
            
            # 跳过明显无效的行
            line_lower = line.lower()
            is_invalid = False
            for invalid in invalid_names:
                if invalid in line_lower:
                    is_invalid = True
                    break
            
            if is_invalid:
                continue
            
            # 尝试匹配作者模式
            for pattern_idx, pattern in enumerate(author_patterns):
                match = re.search(pattern, line, re.MULTILINE)
                if match:
                    # 处理格式5的特殊情况（Lastname, Firstname）
                    if pattern_idx == 4 and len(match.groups()) >= 2:
                        # 转换为 "Firstname Lastname" 格式
                        author = f"{match.group(2)} {match.group(1)}".strip()
                    else:
                        author = match.group(1).strip()
                    
                    # 清理标记（上标、标记等）
                    author = re.sub(r'\(contributed equally\)', '', author, flags=re.IGNORECASE).strip()
                    author = re.sub(r'\(equal contribution\)', '', author, flags=re.IGNORECASE).strip()
                    author = re.sub(r'[†‡*]', '', author).strip()
                    # 移除标记如 "a,b,c" 或 "a b c"（在作者名后面）
                    author = re.sub(r'\s+[a-z]\s*[,;]\s*[a-z]', '', author).strip()
                    author = re.sub(r'\s*[a-z]\s*[,;]\s*[a-z]\s*$', '', author).strip()
                    
                    if not author:
                        continue
                    
                    # 验证作者名是否合理
                    author_lower = author.lower()
                    
                    # 检查是否是无效名称
                    is_invalid_author = False
                    for invalid in invalid_names:
                        if invalid in author_lower or author_lower == invalid:
                            is_invalid_author = True
                            break
                    
                    if is_invalid_author:
                        continue
                    
                    # 检查长度（作者名通常不会太长）
                    if len(author) < 5 or len(author) > 100:
                        continue
                    
                    # 检查是否包含数字（作者名通常不包含数字）
                    if re.search(r'\d', author):
                        continue
                    
                    # 检查是否包含无效关键词
                    invalid_keywords = [
                        r'Open\s+Access', r'Creative\s+Commons', r'©\s*The\s*Author',
                        r'This\s+article', r'Attribution', r'NoDerivatives', r'RESEARCH',
                        r'International\s+Journal', r'Int\.\s*J\.', r'Vol\.', r'Volume',
                        r'Expert\s+Systems', r'Direct\s+Journals', r'Science\s+Direct',
                        r'Introduction', r'Abstract', r'Keywords', r'Engineering\s+Failure',
                        r'Failure\s+Analysis', r'Engineering\s+Structures', r'Journal\s+of',
                        r'Article\s+in\s+Press', r'Available\s+online', r'Published\s+by',
                        r'Copyright', r'All\s+Rights\s+Reserved', r'Elsevier', r'Springer',
                        r'IEEE', r'ACM', r'Publisher', r'Editorial', r'Correspondence'
                    ]
                    for keyword in invalid_keywords:
                        if re.search(keyword, author, re.IGNORECASE):
                            is_invalid_author = True
                            break
                    
                    if is_invalid_author:
                        continue
                    
                    # 检查格式：应该是 "Firstname Lastname" 格式
                    # 至少包含两个词（姓和名）
                    words = author.split()
                    if len(words) < 2:
                        continue
                    
                    # 检查每个词是否以大写字母开头（英文名）
                    # 或者包含中文字符（中文名）
                    has_valid_format = False
                    if any('\u4e00' <= char <= '\u9fff' for char in author):
                        # 中文名
                        has_valid_format = True
                    else:
                        # 英文名：至少前两个词应该以大写字母开头
                        if len(words) >= 2:
                            if words[0][0].isupper() and words[1][0].isupper():
                                has_valid_format = True
                    
                    if has_valid_format:
                        # 计算优先级（越靠前优先级越高）
                        priority = 100 - i
                        candidates.append((priority, author))
                        self.logger.debug(f"[作者提取] 找到候选作者（行{i+1}）: '{author}', 优先级: {priority}")
                        break  # 找到一个匹配就跳出，继续下一行
        
        # 按优先级排序，返回最高优先级的候选
        if candidates:
            candidates.sort(reverse=True, key=lambda x: x[0])
            result = candidates[0][1]
            self.logger.info(f"[作者提取] ✓ 提取成功，找到 {len(candidates)} 个候选，选择: '{result}'")
            self.logger.info("[作者提取] ========== 作者提取完成 ==========")
            return result
        
        self.logger.warning("[作者提取] ✗ 未找到有效的作者名")
        self.logger.info("[作者提取] ========== 作者提取完成 ==========")
        return ''
    
    def verify_paper(self, metadata: Dict, json_file_path: str = None) -> Dict:
        """验证论文（支持多个文件，与扩展逻辑一致）"""
        title = metadata.get('title', 'N/A')
        first_author = metadata.get('firstAuthor', 'N/A')
        self.logger.info(f"="*60)
        self.logger.info(f"[验证开始] 论文: {title[:50]}")
        self.logger.info(f"[验证开始] 第一作者: {first_author}")
        self.logger.info(f"[验证开始] JSON文件: {json_file_path}")
        
        result = {
            'metadata': metadata,
            'files': [],
            'overall_matches': {
                'author': False,
                'date': False,
                'title': False
            },
            'errors': []
        }
        
        # 获取文件列表
        files = metadata.get('files', [])
        self.logger.info(f"[验证开始] 文件数量: {len(files)}")
        
        # 兼容旧格式
        if not files:
            pdf_path = metadata.get('pdfFilePath', '')
            if pdf_path:
                files = [{
                    'type': '论文全文',
                    'fileName': metadata.get('pdfFileName', ''),
                    'filePath': pdf_path
                }]
        
        if not files:
            result['errors'].append("JSON中未找到文件信息")
            return result
        
        # 验证每个文件
        for idx, file_info in enumerate(files, 1):
            file_name = file_info.get('fileName', '未知文件')
            file_type = file_info.get('type', '未知类型')
            self.logger.info(f"[验证文件 {idx}/{len(files)}] {file_type}: {file_name}")
            
            # 在验证前输出进度信息，确保用户知道程序正在运行
            import sys
            print(f"[{idx}/{len(files)}] 正在验证: {file_type} - {file_name}", flush=True)
            sys.stdout.flush()
            
            file_result = self._verify_single_file(file_info, metadata, json_file_path)
            result['files'].append(file_result)
            
            # 记录匹配结果
            matches = file_result['matches']
            self.logger.info(f"[验证文件 {idx}/{len(files)}] 匹配结果 - 作者: {matches['author']}, 日期: {matches['date']}, 标题: {matches['title']}")
            
            # 更新整体匹配结果（只要有一个文件匹配就认为匹配成功）
            if file_result['matches']['author']:
                result['overall_matches']['author'] = True
            if file_result['matches']['date']:
                result['overall_matches']['date'] = True
            if file_result['matches']['title']:
                result['overall_matches']['title'] = True
        
        overall = result['overall_matches']
        self.logger.info(f"[验证完成] 整体匹配结果 - 作者: {overall['author']}, 日期: {overall['date']}, 标题: {overall['title']}")
        self.logger.info(f"="*60)
        return result
    
    def _verify_single_file(self, file_info: Dict, metadata: Dict, json_file_path: str = None) -> Dict:
        """验证单个文件（与扩展逻辑一致）"""
        file_name = file_info.get('fileName', '未知文件')
        file_type = file_info.get('type', '未知类型')
        self.logger.info(f"[文件验证] 开始验证: {file_type} - {file_name}")
        
        file_result = {
            'file_info': file_info,
            'pdf_text': '',
            'pdf_metadata': {},
            'ocr_text': '',
            'extracted_dates': {},
            'matches': {
                'author': False,
                'date': False,
                'title': False
            },
            'errors': []
        }
        
        pdf_path = file_info.get('filePath', '')
        if not pdf_path:
            self.logger.error(f"[文件验证] 文件路径为空: {file_name}")
            file_result['errors'].append("文件路径为空")
            return file_result
        
        # 标准化路径
        pdf_path = os.path.normpath(pdf_path)
        
        # 如果路径不是绝对路径，尝试多种方式查找文件
        if not os.path.isabs(pdf_path):
            # 1. 尝试在JSON文件所在目录查找
            json_dir = os.path.dirname(json_file_path) if json_file_path else os.getcwd()
            abs_pdf_path = os.path.normpath(os.path.join(json_dir, pdf_path))
            if os.path.exists(abs_pdf_path):
                pdf_path = abs_pdf_path
            else:
                # 2. 尝试在当前工作目录查找
                abs_pdf_path = os.path.normpath(os.path.join(os.getcwd(), pdf_path))
                if os.path.exists(abs_pdf_path):
                    pdf_path = abs_pdf_path
                else:
                    # 3. 尝试在用户下载目录查找（Windows: Downloads, Linux/Mac: ~/Downloads）
                    downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
                    if os.path.exists(downloads_dir):
                        abs_pdf_path = os.path.normpath(os.path.join(downloads_dir, pdf_path))
                        if os.path.exists(abs_pdf_path):
                            pdf_path = abs_pdf_path
                    # 4. 如果还是找不到，尝试只使用文件名在JSON目录查找
                    if not os.path.exists(pdf_path):
                        file_name_only = os.path.basename(pdf_path)
                        abs_pdf_path = os.path.normpath(os.path.join(json_dir, file_name_only))
                        if os.path.exists(abs_pdf_path):
                            pdf_path = abs_pdf_path
        
        if not os.path.exists(pdf_path):
            file_result['errors'].append(f"PDF文件不存在: {pdf_path}")
            file_result['errors'].append(f"尝试查找的位置: {json_dir if json_file_path else os.getcwd()}")
            return file_result
        
        try:
            # 1. 提取PDF文本
            self.logger.info(f"[文件验证] 步骤1: 开始提取PDF文本...")
            file_result['pdf_text'] = self.extract_pdf_text(pdf_path, max_pages=5)
            self.logger.info(f"[文件验证] PDF文本提取完成，文本长度: {len(file_result['pdf_text'])}字符")
            if file_result['pdf_text']:
                self.logger.debug(f"[文件验证] PDF文本预览（前200字符）: {file_result['pdf_text'][:200]}")
            else:
                self.logger.warning(f"[文件验证] PDF文本为空，可能是扫描件或加密PDF")
            
            # 2. 提取PDF元数据
            self.logger.info(f"[文件验证] 步骤2: 开始提取PDF元数据...")
            file_result['pdf_metadata'] = self.extract_pdf_metadata(pdf_path)
            self.logger.info(f"[文件验证] PDF元数据提取完成 - 标题: {file_result['pdf_metadata'].get('title', '(空)')[:50]}, 第一作者: {file_result['pdf_metadata'].get('firstAuthor', '(空)')[:50]}")
            
            # 3. OCR识别（如果文本太少或元数据缺失）
            should_ocr = len(file_result['pdf_text']) < 100 or \
                        (not file_result['pdf_metadata'].get('title') and not file_result['pdf_metadata'].get('firstAuthor'))
            
            if should_ocr:
                if len(file_result['pdf_text']) < 100:
                    self.logger.info(f"[文件验证] PDF文本太少({len(file_result['pdf_text'])}字符)，尝试OCR识别")
                else:
                    self.logger.info(f"[文件验证] PDF元数据缺失（标题或作者为空），尝试OCR识别")
                self.logger.info("[文件验证] 步骤3: 开始二段式OCR识别（可能需要一些时间）...")
                import sys
                sys.stdout.flush()  # 确保输出立即显示
                
                # 使用二段式OCR API（与插件一致）
                ocr_result = self.ocr_image_with_api(pdf_path, page_num=0)
                file_result['ocr_text'] = ocr_result.get('text', '')
                file_result['ocr_structured'] = ocr_result.get('structured')
                file_result['ocr_is_structured'] = ocr_result.get('isStructured', False)
                
                self.logger.info(f"[文件验证] OCR识别完成，文本长度: {len(file_result['ocr_text'])}, 是否结构化: {file_result['ocr_is_structured']}")
                sys.stdout.flush()  # 确保输出立即显示
                
                # 关键：优先使用OCR结构化结果（与插件逻辑一致）
                if file_result['ocr_structured']:
                    structured = file_result['ocr_structured']
                    self.logger.info(f"[文件验证] ✓ 使用OCR结构化结果")
                    
                    # 从结构化结果中提取标题
                    if structured.get('title') and structured.get('title') != 'Not mentioned':
                        title = structured.get('title', '').strip()
                        if title and len(title) >= 5:
                            self.logger.info(f"[文件验证] ✓ 从OCR结构化结果提取标题: {title[:100]}")
                            file_result['pdf_metadata']['title'] = title
                    
                    # 从结构化结果中提取第一作者
                    if structured.get('first_author') and structured.get('first_author') != 'Not mentioned':
                        first_author = structured.get('first_author', '').strip()
                        if first_author:
                            self.logger.info(f"[文件验证] ✓ 从OCR结构化结果提取第一作者: {first_author}")
                            file_result['pdf_metadata']['firstAuthor'] = first_author
                            file_result['pdf_metadata']['author'] = first_author
                    
                    # 从结构化结果中提取所有作者
                    if structured.get('authors') and structured.get('authors') != 'Not mentioned':
                        authors_str = structured.get('authors', '').strip()
                        if authors_str:
                            # 解析作者列表（可能是逗号或分号分隔）
                            authors = [a.strip() for a in re.split(r'[,;]', authors_str) if a.strip()]
                            if authors:
                                file_result['pdf_metadata']['allAuthors'] = authors
                                self.logger.info(f"[文件验证] ✓ 从OCR结构化结果提取所有作者: {', '.join(authors)}")
                    
                    # 从结构化结果中提取日期
                    if structured.get('dates'):
                        dates = structured.get('dates', {})
                        if dates.get('received') and dates.get('received') != 'Not mentioned':
                            file_result['extracted_dates']['received'] = dates.get('received')
                        if dates.get('received_in_revised') and dates.get('received_in_revised') != 'Not mentioned':
                            file_result['extracted_dates']['revised'] = dates.get('received_in_revised')
                        elif dates.get('revised') and dates.get('revised') != 'Not mentioned':
                            file_result['extracted_dates']['revised'] = dates.get('revised')
                        if dates.get('accepted') and dates.get('accepted') != 'Not mentioned':
                            file_result['extracted_dates']['accepted'] = dates.get('accepted')
                        if dates.get('available_online') and dates.get('available_online') != 'Not mentioned':
                            file_result['extracted_dates']['availableOnline'] = dates.get('available_online')
                
                # 如果结构化失败或元数据仍缺失，从OCR文本中补全（降级方案）
                if file_result['ocr_text']:
                    ocr_text = file_result['ocr_text']
                    self.logger.info(f"[文件验证] OCR文本长度: {len(ocr_text)}, 预览（前500字符）: {ocr_text[:500]}")
                    
                    if not file_result['pdf_metadata'].get('title') or len(file_result['pdf_metadata'].get('title', '')) < 5:
                        self.logger.info("[文件验证] 标题为空或太短，尝试从OCR文本提取标题...")
                        extracted_title = self.extract_title_from_text(ocr_text)
                        if extracted_title:
                            self.logger.info(f"[文件验证] ✓ 从OCR文本补全标题: {extracted_title[:100]}")
                            file_result['pdf_metadata']['title'] = extracted_title
                        else:
                            self.logger.warning("[文件验证] ✗ 从OCR文本提取标题失败")
                    
                    if not file_result['pdf_metadata'].get('firstAuthor'):
                        self.logger.info("[文件验证] 作者为空，尝试从OCR文本提取作者...")
                        extracted_author = self.extract_author_from_text(ocr_text)
                        if extracted_author:
                            self.logger.info(f"[文件验证] ✓ 从OCR文本补全作者: {extracted_author}")
                            file_result['pdf_metadata']['firstAuthor'] = extracted_author
                            file_result['pdf_metadata']['author'] = extracted_author
                        else:
                            self.logger.warning("[文件验证] ✗ 从OCR文本提取作者失败")
                else:
                    self.logger.warning("[文件验证] OCR文本为空，无法补全标题和作者")
            else:
                self.logger.debug("[文件验证] PDF文本足够且元数据完整，跳过OCR")
            
            # 4. 提取日期（优先使用OCR结构化结果中的日期）
            self.logger.debug("[文件验证] 步骤4: 提取日期")
            file_result['extracted_dates'] = {
                'received': None,
                'accepted': None,
                'published': None,
                'revised': None,
                'availableOnline': None,
                'other': []
            }
            
            # 优先使用OCR结构化结果中的日期（与插件逻辑一致）
            if file_result.get('ocr_structured') and file_result['ocr_structured'].get('dates'):
                dates = file_result['ocr_structured']['dates']
                if dates.get('received') and dates.get('received') != 'Not mentioned':
                    file_result['extracted_dates']['received'] = dates.get('received')
                if dates.get('received_in_revised') and dates.get('received_in_revised') != 'Not mentioned':
                    file_result['extracted_dates']['revised'] = dates.get('received_in_revised')
                elif dates.get('revised') and dates.get('revised') != 'Not mentioned':
                    file_result['extracted_dates']['revised'] = dates.get('revised')
                if dates.get('accepted') and dates.get('accepted') != 'Not mentioned':
                    file_result['extracted_dates']['accepted'] = dates.get('accepted')
                if dates.get('available_online') and dates.get('available_online') != 'Not mentioned':
                    file_result['extracted_dates']['availableOnline'] = dates.get('available_online')
                self.logger.info(f"[文件验证] 从OCR结构化结果提取的日期: {file_result['extracted_dates']}")
            
            # 如果OCR结构化结果中缺少某些日期，从文本中补充（降级方案）
            # 检查是否所有日期都为空，或者某些关键日期缺失
            has_any_date = any(file_result['extracted_dates'].values())
            missing_key_dates = not file_result['extracted_dates'].get('received') and not file_result['extracted_dates'].get('availableOnline')
            
            if not has_any_date or missing_key_dates:
                full_text = file_result['pdf_text'] + file_result['ocr_text']
                extracted_dates = self.extract_dates_from_text(full_text)
                # 合并提取的日期（只填充空值，优先使用OCR结构化结果）
                for key in file_result['extracted_dates']:
                    if not file_result['extracted_dates'][key] and extracted_dates.get(key):
                        file_result['extracted_dates'][key] = extracted_dates[key]
                        self.logger.info(f"[文件验证] 从文本补充日期 {key}: {extracted_dates[key]}")
                self.logger.info(f"[文件验证] 最终提取的日期: {file_result['extracted_dates']}")
            
            # 5. 匹配验证（与扩展逻辑一致）
            self.logger.debug("[文件验证] 步骤5: 开始匹配验证")
            web_title = metadata.get('title', '')
            web_author = metadata.get('firstAuthor', '')
            web_date = metadata.get('date', '')
            web_dates = metadata.get('dates', {})
            self.logger.debug(f"[文件验证] 网页数据 - 标题: {web_title[:50]}, 作者: {web_author}, 日期: {web_date}")
            
            # 日期匹配（优先使用received日期）
            web_date_to_match = web_date
            if web_dates and web_dates.get('received'):
                web_date_to_match = web_dates['received']
            elif web_dates and web_dates.get('published'):
                web_date_to_match = web_dates['published']
            
            all_pdf_dates = {
                **file_result['extracted_dates'],
                'general': file_result['pdf_metadata'].get('date', '')
            }
            file_result['matches']['date'] = self.check_date_match(web_date_to_match, all_pdf_dates)
            
            # 作者匹配
            self.logger.info("[文件验证] ========== 开始作者匹配 ==========")
            pdf_author = file_result['pdf_metadata'].get('firstAuthor', '')
            self.logger.info(f"[文件验证] PDF元数据中的作者: '{pdf_author}'")
            
            if not pdf_author and file_result['pdf_text']:
                self.logger.info(f"[文件验证] 作者为空，从PDF文本提取（文本长度: {len(file_result['pdf_text'])})")
                pdf_author = self.extract_author_from_text(file_result['pdf_text'])
                self.logger.info(f"[文件验证] PDF文本提取的作者: '{pdf_author}'")
            
            # 优先使用OCR结构化结果中的作者（与扩展逻辑一致）
            ocr_author = ''
            if file_result.get('ocr_structured') and file_result['ocr_structured'].get('first_author'):
                ocr_author = file_result['ocr_structured']['first_author'].strip()
                if ocr_author and ocr_author != 'Not mentioned':
                    self.logger.info(f"[文件验证] 从OCR结构化结果提取作者: '{ocr_author}'")
            
            # 如果OCR结构化结果中没有作者，从OCR文本中提取（降级方案）
            if not ocr_author and file_result['ocr_text']:
                self.logger.info(f"[文件验证] OCR结构化结果中无作者，从OCR文本提取（OCR文本长度: {len(file_result['ocr_text'])})")
                ocr_author = self.extract_author_from_text(file_result['ocr_text'])
                self.logger.info(f"[文件验证] OCR文本提取的作者: '{ocr_author}'")
            
            if not ocr_author:
                self.logger.warning("[文件验证] OCR作者为空，无法从OCR提取作者")
            
            # 优先使用OCR作者（与扩展逻辑一致）
            final_pdf_author = ocr_author if ocr_author else pdf_author
            self.logger.info(f"[文件验证] 最终使用的PDF作者: '{final_pdf_author}'")
            self.logger.info(f"[文件验证] 网页作者: '{web_author}'")
            file_result['matches']['author'] = self.check_author_match(web_author, final_pdf_author)
            self.logger.info(f"[文件验证] 作者匹配结果: {file_result['matches']['author']}")
            self.logger.info("[文件验证] ========== 作者匹配完成 ==========")
            
            # 标题匹配
            self.logger.info("[文件验证] ========== 开始标题匹配 ==========")
            pdf_title = file_result['pdf_metadata'].get('title', '')
            self.logger.info(f"[文件验证] PDF元数据中的标题: '{pdf_title[:100] if pdf_title else '(空)'}'")
            
            if not pdf_title and file_result['pdf_text']:
                self.logger.info(f"[文件验证] 标题为空，从PDF文本提取（文本长度: {len(file_result['pdf_text'])})")
                pdf_title = self.extract_title_from_text(file_result['pdf_text'])
                self.logger.info(f"[文件验证] PDF文本提取的标题: '{pdf_title[:100] if pdf_title else '(空)'}'")
            
            # 优先使用OCR结构化结果中的标题（与扩展逻辑一致）
            ocr_title = ''
            if file_result.get('ocr_structured') and file_result['ocr_structured'].get('title'):
                ocr_title = file_result['ocr_structured']['title'].strip()
                if ocr_title and ocr_title != 'Not mentioned':
                    self.logger.info(f"[文件验证] 从OCR结构化结果提取标题: '{ocr_title[:100]}'")
            
            # 如果OCR结构化结果中没有标题，从OCR文本中提取（降级方案）
            if not ocr_title and file_result['ocr_text']:
                self.logger.info(f"[文件验证] OCR结构化结果中无标题，从OCR文本提取（OCR文本长度: {len(file_result['ocr_text'])})")
                self.logger.debug(f"[文件验证] OCR文本预览（前1000字符）: {file_result['ocr_text'][:1000]}")
                ocr_title = self.extract_title_from_text(file_result['ocr_text'])
                self.logger.info(f"[文件验证] OCR文本提取的标题: '{ocr_title[:100] if ocr_title else '(空)'}'")
            
            if not ocr_title:
                self.logger.warning("[文件验证] OCR标题为空，无法从OCR提取标题")
            
            # 优先使用OCR标题（与扩展逻辑一致）
            # 如果PDF标题看起来像文件名，跳过
            filename_patterns = [
                r'^view\s*(letter|pdf|file)$',
                r'^accept',
                r'^download',
                r'^file',
                r'^document'
            ]
            is_likely_filename = any(re.match(pattern, pdf_title, re.IGNORECASE) for pattern in filename_patterns)
            
            if ocr_title and len(ocr_title.strip()) > 10:
                # 优先检查OCR标题
                file_result['matches']['title'] = self.check_title_match(web_title, ocr_title)
            elif not is_likely_filename and pdf_title and len(pdf_title.strip()) > 5:
                # 再检查PDF标题
                file_result['matches']['title'] = self.check_title_match(web_title, pdf_title)
            
        except Exception as e:
            import traceback
            file_result['errors'].append(f"验证过程出错: {str(e)}\n{traceback.format_exc()}")
        
        return file_result


class PaperVerifierGUI:
    """论文验证GUI"""
    
    def __init__(self, root):
        self.root = root
        self.root.title("论文验证工具 - Python版（与扩展验证逻辑一致）")
        self.root.geometry("1000x700")
        
        self.verifier = PDFVerifier()
        self.current_results = []
        
        self.setup_ui()
    
    def setup_ui(self):
        """设置UI"""
        # 主框架
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # 拖拽区域
        drop_frame = ttk.LabelFrame(main_frame, text="拖拽JSON元数据文件到这里", padding="20")
        drop_frame.grid(row=0, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        self.drop_label = ttk.Label(drop_frame, text="拖拽文件或点击选择", 
                                     font=("Arial", 12), foreground="gray")
        self.drop_label.pack(expand=True, fill=tk.BOTH)
        
        # 绑定拖拽事件
        drop_frame.bind("<Button-1>", self.select_file)
        self.drop_label.bind("<Button-1>", self.select_file)
        
        # 文件列表
        list_frame = ttk.LabelFrame(main_frame, text="待验证文件", padding="10")
        list_frame.grid(row=1, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)
        
        # 列表和滚动条
        list_scroll = ttk.Scrollbar(list_frame)
        list_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.file_listbox = tk.Listbox(list_frame, yscrollcommand=list_scroll.set, height=8)
        self.file_listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        list_scroll.config(command=self.file_listbox.yview)
        
        # 按钮区域
        button_frame = ttk.Frame(main_frame)
        button_frame.grid(row=2, column=0, columnspan=2, pady=5)
        
        ttk.Button(button_frame, text="开始验证", command=self.start_verification).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="清空列表", command=self.clear_list).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="导出结果", command=self.export_results).pack(side=tk.LEFT, padx=5)
        
        # 进度条
        self.progress = ttk.Progressbar(main_frame, mode='indeterminate')
        self.progress.grid(row=3, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        # 结果显示
        result_frame = ttk.LabelFrame(main_frame, text="验证结果", padding="10")
        result_frame.grid(row=4, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)
        
        self.result_text = scrolledtext.ScrolledText(result_frame, height=15, wrap=tk.WORD)
        self.result_text.pack(fill=tk.BOTH, expand=True)
        
        # 配置网格权重
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(0, weight=1)
        main_frame.rowconfigure(4, weight=1)
    
    def select_file(self, event=None):
        """选择文件"""
        files = filedialog.askopenfilenames(
            title="选择JSON元数据文件",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        for file in files:
            self.add_file(file)
    
    def add_file(self, file_path: str):
        """添加文件到列表"""
        if file_path not in self.file_listbox.get(0, tk.END):
            self.file_listbox.insert(tk.END, file_path)
    
    def clear_list(self):
        """清空列表"""
        self.file_listbox.delete(0, tk.END)
        self.current_results = []
        self.result_text.delete(1.0, tk.END)
    
    def start_verification(self):
        """开始验证"""
        files = list(self.file_listbox.get(0, tk.END))
        if not files:
            messagebox.showwarning("警告", "请先添加JSON文件")
            return
        
        # 在新线程中执行验证
        thread = threading.Thread(target=self.verify_files, args=(files,))
        thread.daemon = True
        thread.start()
    
    def verify_files(self, files: List[str]):
        """验证文件列表"""
        self.progress.start()
        self.result_text.delete(1.0, tk.END)
        self.current_results = []
        
        total = len(files)
        for i, json_file in enumerate(files):
            try:
                # 更新进度
                json_basename = os.path.basename(json_file)
                self.root.after(0, lambda f=json_basename, idx=i+1, total=total: 
                               self.result_text.insert(tk.END, f"\n[{idx}/{total}] 处理: {f}\n"))
                
                # 读取JSON
                with open(json_file, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                
                # 如果PDF路径是相对路径，尝试相对于JSON文件解析
                files_list = metadata.get('files', [])
                if files_list:
                    json_dir = os.path.dirname(os.path.abspath(json_file))
                    for file_info in files_list:
                        pdf_path = file_info.get('filePath', '')
                        if pdf_path and not os.path.isabs(pdf_path):
                            abs_pdf_path = os.path.normpath(os.path.join(json_dir, pdf_path))
                            if os.path.exists(abs_pdf_path):
                                file_info['filePath'] = abs_pdf_path
                
                # 验证（传递JSON文件路径，用于解析相对路径）
                # 在验证前更新GUI，显示正在处理
                self.root.after(0, lambda: self.result_text.insert(tk.END, f"正在验证中，请稍候...\n"))
                self.root.after(0, lambda: self.result_text.see(tk.END))  # 滚动到底部
                
                result = self.verifier.verify_paper(metadata, json_file_path=os.path.abspath(json_file))
                self.current_results.append(result)
                
                # 显示结果
                self.root.after(0, lambda r=result: self.display_result(r))
                self.root.after(0, lambda: self.result_text.see(tk.END))  # 滚动到底部
                
            except Exception as e:
                import traceback
                error_msg = f"处理 {os.path.basename(json_file)} 时出错: {str(e)}\n"
                error_msg += f"详细错误: {traceback.format_exc()}\n"
                self.root.after(0, lambda msg=error_msg: self.result_text.insert(tk.END, msg))
        
        self.progress.stop()
        self.root.after(0, lambda: messagebox.showinfo("完成", f"验证完成！共处理 {total} 个文件"))
    
    def display_result(self, result: Dict):
        """显示单个结果（支持多文件）- 三个板块格式"""
        metadata = result['metadata']
        files = result.get('files', [])
        overall_matches = result.get('overall_matches', result.get('matches', {}))
        
        output = f"\n{'='*60}\n"
        output += f"标题: {metadata.get('title', 'N/A')}\n"
        output += f"第一作者: {metadata.get('firstAuthor', 'N/A')}\n"
        output += f"日期: {metadata.get('date', 'N/A')}\n"
        output += f"下载时间: {metadata.get('downloadTimeFormatted', metadata.get('downloadTime', 'N/A'))}\n"
        output += f"文件数量: {len(files)}\n"
        
        # 收集匹配信息（按类型分组）
        date_matches = [] 
        author_matches = []  
        title_matches = []  
        
        web_title = metadata.get('title', '')
        web_author = metadata.get('firstAuthor', '')
        web_date = metadata.get('date', '')
        web_dates = metadata.get('dates', {})
        
        # 优先使用received日期
        web_date_to_match = web_date
        if web_dates and web_dates.get('received'):
            web_date_to_match = web_dates['received']
        elif web_dates and web_dates.get('published'):
            web_date_to_match = web_dates['published']
        
        for file_result in files:
            file_info = file_result.get('file_info', {})
            file_matches = file_result.get('matches', {})
            file_name = file_info.get('fileName', '未知文件')
            file_type = file_info.get('type', '未知类型')
            
            # 收集日期匹配信息
            extracted_dates = file_result.get('extracted_dates', {})
            pdf_metadata = file_result.get('pdf_metadata', {})
            all_dates = []
            if extracted_dates.get('received'):
                all_dates.append(f"Received: {extracted_dates['received']}")
            if extracted_dates.get('accepted'):
                all_dates.append(f"Accepted: {extracted_dates['accepted']}")
            if extracted_dates.get('published'):
                all_dates.append(f"Published: {extracted_dates['published']}")
            if extracted_dates.get('revised'):
                all_dates.append(f"Revised: {extracted_dates['revised']}")
            if extracted_dates.get('other'):
                for d in extracted_dates['other']:
                    all_dates.append(f"Other: {d}")
            if pdf_metadata.get('date'):
                all_dates.append(f"General: {pdf_metadata['date']}")
            
            date_matches.append({
                'file_name': file_name,
                'file_type': file_type,
                'matched': file_matches.get('date', False),
                'web_date': web_date_to_match,
                'all_dates': all_dates
            })
            
            # 收集作者匹配信息（与验证逻辑一致）
            pdf_author = pdf_metadata.get('firstAuthor', '')
            
            # 验证PDF元数据中的作者是否有效
            if pdf_author:
                author_lower = pdf_author.lower()
                invalid_names = ['direct journals', 'expert systems', 'fields', 'open access',
                               'international journal', 'elsevier', 'science direct']
                is_invalid = any(inv in author_lower for inv in invalid_names)
                if is_invalid or len(pdf_author) < 5:
                    pdf_author = ''
            
            if not pdf_author and file_result.get('pdf_text'):
                pdf_author = self.verifier.extract_author_from_text(file_result['pdf_text'])
            ocr_author = ''
            if file_result.get('ocr_text'):
                ocr_author = self.verifier.extract_author_from_text(file_result['ocr_text'])
            final_pdf_author = ocr_author if ocr_author else pdf_author
            
            # 如果还是无效，尝试从全文提取
            if not final_pdf_author and file_result.get('pdf_text'):
                full_text_sample = file_result['pdf_text'][:5000]
                final_pdf_author = self.verifier.extract_author_from_text(full_text_sample)
            
            author_matches.append({
                'file_name': file_name,
                'file_type': file_type,
                'matched': file_matches.get('author', False),
                'web_author': web_author,
                'pdf_author': final_pdf_author
            })
            
            # 收集标题匹配信息
            pdf_title = pdf_metadata.get('title', '')
            if not pdf_title and file_result.get('pdf_text'):
                pdf_title = self.verifier.extract_title_from_text(file_result['pdf_text'])
            ocr_title = ''
            if file_result.get('ocr_text'):
                ocr_title = self.verifier.extract_title_from_text(file_result['ocr_text'])
            final_pdf_title = ocr_title if ocr_title else pdf_title
            
            title_matches.append({
                'file_name': file_name,
                'file_type': file_type,
                'matched': file_matches.get('title', False),
                'web_title': web_title,
                'pdf_title': final_pdf_title
            })
        
        # 板块1：日期匹配结果
        output += f"\n{'─'*60}\n"
        output += f"【日期匹配结果】\n"
        output += f"{'─'*60}\n"
        if overall_matches.get('date'):
            output += f"✓ 整体匹配成功\n"
        else:
            output += f"✗ 整体未匹配\n"
        output += f"网页日期: {web_date_to_match}\n"
        output += f"\n各文件匹配情况:\n"
        for match_info in date_matches:
            status = "✓ 匹配" if match_info['matched'] else "✗ 未匹配"
            output += f"  [{match_info['file_type']}] {match_info['file_name']}: {status}\n"
            if match_info['all_dates']:
                output += f"    PDF中所有日期: {', '.join(match_info['all_dates'])}\n"
            else:
                output += f"    PDF中所有日期: 未提取\n"
        
        # 板块2：作者匹配结果
        output += f"\n{'─'*60}\n"
        output += f"【作者匹配结果】\n"
        output += f"{'─'*60}\n"
        if overall_matches.get('author'):
            output += f"✓ 整体匹配成功\n"
        else:
            output += f"✗ 整体未匹配\n"
        output += f"网页作者: {web_author}\n"
        output += f"\n各文件匹配情况:\n"
        for match_info in author_matches:
            status = "✓ 匹配" if match_info['matched'] else "✗ 未匹配"
            output += f"  [{match_info['file_type']}] {match_info['file_name']}: {status}\n"
            if match_info['pdf_author']:
                output += f"    PDF中第一作者: {match_info['pdf_author']}\n"
            else:
                output += f"    PDF中第一作者: 未提取\n"
        
        # 板块3：标题匹配结果
        output += f"\n{'─'*60}\n"
        output += f"【标题匹配结果】\n"
        output += f"{'─'*60}\n"
        if overall_matches.get('title'):
            output += f"✓ 整体匹配成功\n"
        else:
            output += f"✗ 整体未匹配\n"
        output += f"网页标题: {web_title}\n"
        output += f"\n各文件匹配情况:\n"
        for match_info in title_matches:
            status = "✓ 匹配" if match_info['matched'] else "✗ 未匹配"
            output += f"  [{match_info['file_type']}] {match_info['file_name']}: {status}\n"
            if match_info['pdf_title']:
                output += f"    PDF中标题: {match_info['pdf_title'][:100]}{'...' if len(match_info['pdf_title']) > 100 else ''}\n"
            else:
                output += f"    PDF中标题: 未提取\n"
        
        # 显示错误信息
        if result.get('errors'):
            output += f"\n{'─'*60}\n"
            output += f"错误/警告:\n"
            for error in result['errors']:
                output += f"  - {error}\n"
        
        self.result_text.insert(tk.END, output)
        self.result_text.see(tk.END)
    
    def export_results(self):
        """导出结果"""
        if not self.current_results:
            messagebox.showwarning("警告", "没有可导出的结果")
            return
        
        file_path = filedialog.asksaveasfilename(
            title="保存结果",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        
        if file_path:
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(self.current_results, f, ensure_ascii=False, indent=2)
                messagebox.showinfo("成功", "结果已导出")
            except Exception as e:
                messagebox.showerror("错误", f"导出失败: {str(e)}")


def main():
    """主函数"""
    root = tk.Tk()
    app = PaperVerifierGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
