#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
PDF提取测试脚本
用于测试PDF文件的文本、元数据、作者、标题、日期提取功能
"""

import os
import sys
import logging
from typing import Dict, Optional

# 配置日志
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('test_pdf_extraction.log', encoding='utf-8')
    ]
)
logger = logging.getLogger('PDFTest')

# 导入PDF处理库
HAS_PYPDF2 = False
HAS_PDFPLUMBER = False
HAS_OCR = False
HAS_PINYIN = False

try:
    import PyPDF2
    HAS_PYPDF2 = True
    logger.info("✓ PyPDF2 已安装")
except ImportError:
    logger.warning("✗ PyPDF2 未安装")

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
    logger.info("✓ pdfplumber 已安装")
except ImportError:
    logger.warning("✗ pdfplumber 未安装")

try:
    from pypinyin import lazy_pinyin, Style
    HAS_PINYIN = True
    logger.info("✓ pypinyin 已安装")
except ImportError:
    logger.warning("✗ pypinyin 未安装")

try:
    from pdf2image import convert_from_path
    HAS_OCR = True
    logger.info("✓ pdf2image 已安装（OCR支持）")
except ImportError:
    logger.warning("✗ pdf2image 未安装（OCR不可用）")

# OCR库
OCR_READER = None
OCR_METHOD = None

if HAS_OCR:
    try:
        from paddleocr import PaddleOCR
        OCR_METHOD = 'paddleocr'
        logger.info("✓ PaddleOCR 已安装")
    except ImportError:
        try:
            import easyocr
            OCR_METHOD = 'easyocr'
            logger.info("✓ EasyOCR 已安装")
        except ImportError:
            try:
                import pytesseract
                from PIL import Image
                OCR_METHOD = 'pytesseract'
                logger.info("✓ pytesseract 已安装")
            except ImportError:
                logger.warning("✗ 未找到OCR库")

import re
from datetime import datetime

class PDFExtractor:
    """PDF提取器（从python_verifier.py提取的核心功能）"""
    
    def __init__(self):
        self.logger = logger
    
    def extract_pdf_text(self, pdf_path: str, max_pages: int = 5) -> str:
        """提取PDF文本"""
        self.logger.info(f"\n{'='*60}")
        self.logger.info(f"[文本提取] 开始提取: {pdf_path}")
        self.logger.info(f"[文本提取] 最大页数: {max_pages}")
        
        text = ""
        try:
            if HAS_PDFPLUMBER:
                self.logger.info("[文本提取] 使用 pdfplumber")
                text = self._extract_with_pdfplumber(pdf_path, max_pages)
            elif HAS_PYPDF2:
                self.logger.info("[文本提取] 使用 PyPDF2")
                text = self._extract_with_pypdf2(pdf_path, max_pages)
            else:
                self.logger.error("[文本提取] 未找到PDF处理库")
                return ""
        except Exception as e:
            self.logger.error(f"[文本提取] 提取失败: {e}", exc_info=True)
            return ""
        
        self.logger.info(f"[文本提取] ✓ 提取完成，文本长度: {len(text)} 字符")
        return text
    
    def _extract_with_pdfplumber(self, pdf_path: str, max_pages: int) -> str:
        """使用pdfplumber提取文本"""
        text = ""
        try:
            with pdfplumber.open(pdf_path) as pdf:
                self.logger.info(f"[pdfplumber] 总页数: {len(pdf.pages)}")
                for i, page in enumerate(pdf.pages[:max_pages]):
                    try:
                        page_text = page.extract_text()
                        if page_text:
                            text += page_text + "\n"
                            self.logger.info(f"[pdfplumber] 第{i+1}页: {len(page_text)} 字符")
                        else:
                            self.logger.warning(f"[pdfplumber] 第{i+1}页: 文本为空（可能是扫描件）")
                    except Exception as e:
                        self.logger.warning(f"[pdfplumber] 第{i+1}页提取失败: {e}")
        except Exception as e:
            self.logger.error(f"[pdfplumber] 打开失败: {e}")
        return text
    
    def _extract_with_pypdf2(self, pdf_path: str, max_pages: int) -> str:
        """使用PyPDF2提取文本"""
        text = ""
        try:
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                self.logger.info(f"[PyPDF2] 总页数: {len(pdf_reader.pages)}")
                for i, page in enumerate(pdf_reader.pages[:max_pages]):
                    try:
                        page_text = page.extract_text()
                        if page_text:
                            text += page_text + "\n"
                            self.logger.info(f"[PyPDF2] 第{i+1}页: {len(page_text)} 字符")
                        else:
                            self.logger.warning(f"[PyPDF2] 第{i+1}页: 文本为空（可能是扫描件）")
                    except Exception as e:
                        self.logger.warning(f"[PyPDF2] 第{i+1}页提取失败: {e}")
        except Exception as e:
            self.logger.error(f"[PyPDF2] 打开失败: {e}")
        return text
    
    def extract_pdf_metadata(self, pdf_path: str) -> Dict:
        """提取PDF元数据"""
        self.logger.info(f"\n{'='*60}")
        self.logger.info(f"[元数据提取] 开始提取: {pdf_path}")
        
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
                            
                            if raw_author:
                                author_lower = raw_author.lower()
                                invalid_names = [
                                    'direct journals', 'expert systems', 'fields', 'open access',
                                    'international journal', 'elsevier', 'science direct',
                                    'compaq', 'hp', 'dell', 'lenovo', 'computer', 'system',
                                    'creative commons', 'the author', 'this article',
                                    'engineering failure', 'engineering failure analysis'
                                ]
                                is_invalid = any(inv in author_lower for inv in invalid_names)
                                if not is_invalid and len(raw_author) >= 5 and len(raw_author) <= 200:
                                    metadata['author'] = raw_author
                                    authors = [a.strip() for a in raw_author.split(',')]
                                    if authors:
                                        metadata['firstAuthor'] = authors[0]
                            
                            if '/CreationDate' in pdf_reader.metadata:
                                try:
                                    date_str = pdf_reader.metadata['/CreationDate']
                                    metadata['date'] = self._parse_pdf_date(date_str)
                                except:
                                    pass
                        except Exception as e:
                            self.logger.warning(f"[元数据] PyPDF2读取失败: {e}")
            except Exception as e:
                pass
        
        # 方法2：如果PyPDF2失败，尝试使用pdfplumber
        if (not metadata.get('title') or not metadata.get('firstAuthor')) and HAS_PDFPLUMBER:
            try:
                with pdfplumber.open(pdf_path) as pdf:
                    if pdf.metadata:
                        if not metadata.get('title'):
                            metadata['title'] = pdf.metadata.get('Title', '') or ''
                        if not metadata.get('author'):
                            raw_author = pdf.metadata.get('Author', '') or ''
                            if raw_author:
                                author_lower = raw_author.lower()
                                invalid_names = [
                                    'direct journals', 'expert systems', 'fields', 'open access',
                                    'international journal', 'elsevier', 'science direct',
                                    'compaq', 'hp', 'dell', 'lenovo', 'computer', 'system',
                                    'creative commons', 'the author', 'this article',
                                    'engineering failure', 'engineering failure analysis'
                                ]
                                is_invalid = any(inv in author_lower for inv in invalid_names)
                                if not is_invalid and len(raw_author) >= 5 and len(raw_author) <= 200:
                                    metadata['author'] = raw_author
                                    authors = [a.strip() for a in raw_author.split(',')]
                                    if authors:
                                        metadata['firstAuthor'] = authors[0]
            except Exception as e:
                self.logger.warning(f"[元数据] pdfplumber提取失败: {e}")
        
        self.logger.info(f"[元数据] ✓ 提取完成")
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
    
    def extract_title_from_text(self, text: str) -> str:
        """从文本中提取标题"""
        self.logger.info(f"\n{'='*60}")
        self.logger.info(f"[标题提取] 开始从文本提取标题（文本长度: {len(text)}）")
        
        if not text:
            return ''
        
        # 优先从前2000个字符中提取
        search_text = text[:2000]
        lines = search_text.split('\n')
        
        # 过滤掉常见的页眉页脚和期刊信息
        invalid_keywords = [
            'doi:', 'doi.org', 'http://', 'https://', 'www.', 'volume', 'vol.',
            'page', 'pp.', 'received', 'accepted', 'published', 'available online',
            'copyright', 'elsevier', 'springer', 'ieee', 'acm', 'introduction',
            'abstract', 'keywords', 'references', 'journal', 'article', 'paper'
        ]
        
        candidates = []
        for i, line in enumerate(lines[:30]):
            line = line.strip()
            if not line or len(line) < 10:
                continue
            
            # 跳过包含无效关键词的行
            line_lower = line.lower()
            if any(keyword in line_lower for keyword in invalid_keywords):
                continue
            
            # 检查是否是标题格式（通常较长，且包含多个单词）
            words = line.split()
            if len(words) >= 3 and len(line) >= 20:
                # 检查是否大部分单词首字母大写（英文标题）
                if any('\u4e00' <= char <= '\u9fff' for char in line):
                    # 中文标题
                    candidates.append((100 - i, line))
                elif sum(1 for w in words if w and w[0].isupper()) >= len(words) * 0.5:
                    # 英文标题
                    candidates.append((100 - i, line))
        
        if candidates:
            candidates.sort(reverse=True, key=lambda x: x[0])
            title = candidates[0][1]
            self.logger.info(f"[标题提取] ✓ 找到标题: {title[:100]}")
            return title
        
        self.logger.warning("[标题提取] ✗ 未找到标题")
        return ''
    
    def extract_author_from_text(self, text: str) -> str:
        """从文本中提取第一作者"""
        self.logger.info(f"\n{'='*60}")
        self.logger.info(f"[作者提取] 开始从文本提取作者（文本长度: {len(text)}）")
        
        if not text:
            return ''
        
        search_text = text[:3000]
        lines = search_text.split('\n')
        
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
            'journal', 'article', 'paper', 'publication', 'publisher', 'editorial'
        ]
        
        author_patterns = [
            r'^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[,;]',
            r'^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+[a-z]\s*[,;]',
            r'^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$',
            r'^([A-Z][a-z]+\s+[A-Z]\.\s+[A-Z][a-z]+)\s*$',
            r'^([A-Z][a-z]+),\s+([A-Z][a-z]+(?:\s+[A-Z]\.)?)\s*$',
            r'^([\u4e00-\u9fa5]{2,4}(?:\s+[\u4e00-\u9fa5]{2,4}){0,2})\s*$',
        ]
        
        candidates = []
        for i, line in enumerate(lines[:40]):
            line = line.strip()
            if not line:
                continue
            
            line_lower = line.lower()
            is_invalid = False
            for invalid in invalid_names:
                if invalid in line_lower:
                    is_invalid = True
                    break
            
            if is_invalid:
                continue
            
            for pattern_idx, pattern in enumerate(author_patterns):
                match = re.search(pattern, line, re.MULTILINE)
                if match:
                    if pattern_idx == 4 and len(match.groups()) >= 2:
                        author = f"{match.group(2)} {match.group(1)}".strip()
                    else:
                        author = match.group(1).strip()
                    
                    author = re.sub(r'\(contributed equally\)', '', author, flags=re.IGNORECASE).strip()
                    author = re.sub(r'\(equal contribution\)', '', author, flags=re.IGNORECASE).strip()
                    author = re.sub(r'[†‡*]', '', author).strip()
                    # 移除标记如 "a,b,c" 或 "a b c"（在作者名后面）
                    author = re.sub(r'\s+[a-z]\s*[,;]\s*[a-z]', '', author).strip()
                    author = re.sub(r'\s*[a-z]\s*[,;]\s*[a-z]\s*$', '', author).strip()
                    # 移除上标标记（单个小写字母，通常在作者名末尾，且前面有空格）
                    # 例如："Jian Caoa" -> "Jian Cao"，但 "Cao" 不会被影响
                    # 只移除末尾的单个小写字母（前面必须有空格，确保不是名字的一部分）
                    author = re.sub(r'([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+([a-z])\s*$', r'\1 \2', author).strip()
                    # 如果还有单个小写字母在末尾（前面有空格），也移除
                    author = re.sub(r'([A-Z][a-z]+)\s+([a-z])\s*$', r'\1', author).strip()
                    
                    if not author:
                        continue
                    
                    author_lower = author.lower()
                    is_invalid_author = False
                    for invalid in invalid_names:
                        if invalid in author_lower or author_lower == invalid:
                            is_invalid_author = True
                            break
                    
                    if is_invalid_author:
                        continue
                    
                    if len(author) < 5 or len(author) > 100:
                        continue
                    
                    if re.search(r'\d', author):
                        continue
                    
                    words = author.split()
                    if len(words) < 2:
                        continue
                    
                    has_valid_format = False
                    if any('\u4e00' <= char <= '\u9fff' for char in author):
                        has_valid_format = True
                    else:
                        if len(words) >= 2:
                            if words[0][0].isupper() and words[1][0].isupper():
                                has_valid_format = True
                    
                    if has_valid_format:
                        priority = 100 - i
                        candidates.append((priority, author))
                        self.logger.debug(f"[作者提取] 找到候选作者（行{i+1}）: '{author}'")
                        break
        
        if candidates:
            candidates.sort(reverse=True, key=lambda x: x[0])
            author = candidates[0][1]
            self.logger.info(f"[作者提取] ✓ 找到作者: {author}")
            return author
        
        self.logger.warning("[作者提取] ✗ 未找到作者")
        return ''
    
    def extract_dates_from_text(self, text: str) -> Dict:
        """从文本中提取日期"""
        self.logger.info(f"\n{'='*60}")
        self.logger.info(f"[日期提取] 开始从文本提取日期（文本长度: {len(text)}）")
        
        # 调试：检查文本中是否包含 "Available online"
        available_online_matches = re.finditer(r'Available\s+online', text, re.IGNORECASE)
        available_online_count = 0
        for match in available_online_matches:
            available_online_count += 1
            context = text[max(0, match.start()-30):match.end()+50]
            self.logger.debug(f"[日期提取] 找到 'Available online' (第{available_online_count}处): ...{context}...")
        if available_online_count > 0:
            self.logger.info(f"[日期提取] 在文本中找到 {available_online_count} 处 'Available online'")
        else:
            self.logger.warning(f"[日期提取] 文本中未找到 'Available online'")
        
        dates = {
            'received': None,
            'accepted': None,
            'published': None,
            'revised': None,
            'availableOnline': None,
            'other': []
        }
        
        date_patterns = [
            ('received', [
                r'Received\s+in\s+revised\s+form\s+(\d{1,2}\s+\w+\s+\d{4})',
                r'Received:\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})',
                r'Received\s+(\d{1,2}\s+\w+\s+\d{4})',  # 匹配 "Received 1 January 2025"
                r'Received\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2})'
            ]),
            ('revised', [
                r'Received\s+in\s+revised\s+form\s+(\d{1,2}\s+\w+\s+\d{4})',
                r'Revised:\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})',
                r'Revised\s+(\d{1,2}\s+\w+\s+\d{4})'
            ]),
            ('accepted', [
                r'Accepted\s+(\d{1,2}\s+\w+\s+\d{4})',
                r'Accepted:\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})',
                r'录用日期[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日)',
                r'录用日期[:：]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})',
            ]),
            ('availableOnline', [
                r'Available\s+online\s+(\d{1,2}\s+\w+\s+\d{4})',  # 匹配 "Available online 24 February 2025"
                r'Available\s+online:\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})',
                r'Available\s+online\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2})'
            ]),
            ('published', [
                r'Published\s+(\d{1,2}\s+\w+\s+\d{4})',
                r'Published:\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})'
            ]),
            ('other', [
                r'日期[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日)',
                r'日期[:：]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})',
                r'(\d{4}年\d{1,2}月\d{1,2}日)',
                r'(\d{4}-\d{1,2}-\d{1,2})',
                r'(\d{4}/\d{1,2}/\d{1,2})'
            ])
        ]
        
        # 收集所有匹配的日期（不立即break，以便找到所有日期）
        all_matches = []
        for date_type, patterns in date_patterns:
            for pattern in patterns:
                # 使用findall找到所有匹配
                matches = re.finditer(pattern, text, re.IGNORECASE)
                for match in matches:
                    date_str = match.group(1)
                    normalized = self.normalize_date(date_str)
                    if normalized:
                        all_matches.append((date_type, normalized, match.start()))
                        # 调试：显示匹配到的原始文本
                        matched_text = text[max(0, match.start()-20):match.end()+20]
                        self.logger.debug(f"[日期提取] 匹配到{date_type} - 原始文本: ...{matched_text}... -> 标准化: {normalized}")
        
        # 按位置排序，优先使用较早出现的日期
        all_matches.sort(key=lambda x: x[2])
        
        # 对于每种日期类型，使用第一个匹配的（最早的）
        for date_type, normalized, pos in all_matches:
            if date_type == 'other':
                if normalized not in dates['other']:
                    dates['other'].append(normalized)
                    self.logger.info(f"[日期提取] ✓ 找到{date_type}日期: {normalized}")
            else:
                # 如果该类型还没有日期，或者当前日期更早，则更新
                if dates[date_type] is None:
                    dates[date_type] = normalized
                    self.logger.info(f"[日期提取] ✓ 找到{date_type}日期: {normalized}")
                # 对于received，如果有多个，保留最早的（1月1日应该比1月30日早）
                elif date_type == 'received':
                    # 比较日期，保留较早的
                    if normalized < dates[date_type]:
                        self.logger.info(f"[日期提取] ✓ 更新{date_type}日期: {dates[date_type]} -> {normalized} (保留较早的)")
                        dates[date_type] = normalized
        
        return dates
    
    def normalize_date(self, date_string: str) -> Optional[str]:
        """标准化日期格式为 YYYY-MM-DD"""
        if not date_string or not isinstance(date_string, str):
            return None
        
        try:
            # 格式1: "DD Month YYYY"
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
            
            # 格式2: "2025年12月24日"
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
            logger.error(f"日期标准化失败: {date_string}, {e}")
        
        return None
    
    def ocr_image(self, pdf_path: str, page_num: int = 0) -> str:
        """OCR识别PDF第一页"""
        global OCR_READER
        
        if not HAS_OCR:
            self.logger.warning("[OCR] OCR库未安装")
            return ""
        
        self.logger.info(f"\n{'='*60}")
        self.logger.info(f"[OCR] 开始识别: {pdf_path}, 页码: {page_num}")
        
        try:
            images = convert_from_path(pdf_path, first_page=page_num+1, last_page=page_num+1)
            if not images:
                self.logger.warning("[OCR] PDF转图像失败")
                return ""
            
            image = images[0]
            self.logger.info(f"[OCR] PDF转图像成功，图像尺寸: {image.size}")
            
            if OCR_METHOD == 'paddleocr':
                if OCR_READER is None:
                    self.logger.info("[OCR] 正在初始化 PaddleOCR（首次运行会下载模型，请稍候）...")
                    try:
                        OCR_READER = PaddleOCR(use_textline_orientation=True, lang='ch')
                    except TypeError:
                        try:
                            OCR_READER = PaddleOCR(use_angle_cls=True, lang='ch')
                        except:
                            OCR_READER = PaddleOCR(lang='ch')
                
                try:
                    import numpy as np
                    image_array = np.array(image)
                    result = OCR_READER.ocr(image_array, cls=True)
                except:
                    result = OCR_READER.ocr(image, cls=True)
                
                # 解析结果
                text_lines = []
                if isinstance(result, list):
                    for page in result:
                        if isinstance(page, list):
                            for item in page:
                                if isinstance(item, list) and len(item) >= 2:
                                    text_info = item[1]
                                    if isinstance(text_info, tuple):
                                        text = text_info[0] if len(text_info) > 0 else ''
                                    elif isinstance(text_info, str):
                                        text = text_info
                                    else:
                                        text = str(text_info) if text_info else ''
                                    if text:
                                        text_lines.append(text)
                
                text = '\n'.join(text_lines)
                self.logger.info(f"[OCR] ✓ 识别完成，文本长度: {len(text)} 字符")
                return text
            else:
                self.logger.warning(f"[OCR] OCR方法 {OCR_METHOD} 暂未实现")
                return ""
        except Exception as e:
            self.logger.error(f"[OCR] 识别失败: {e}", exc_info=True)
            return ""


def print_results(extractor: PDFExtractor, pdf_path: str):
    """打印提取结果"""
    print("\n" + "="*80)
    print("PDF提取测试结果")
    print("="*80)
    print(f"文件: {pdf_path}")
    print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    # 1. 提取文本
    pdf_text = extractor.extract_pdf_text(pdf_path, max_pages=5)
    
    # 2. 提取元数据
    pdf_metadata = extractor.extract_pdf_metadata(pdf_path)
    
    # 3. 从文本提取标题
    extracted_title = extractor.extract_title_from_text(pdf_text)
    
    # 4. 从文本提取作者
    extracted_author = extractor.extract_author_from_text(pdf_text)
    
    # 5. 提取日期
    extracted_dates = extractor.extract_dates_from_text(pdf_text)
    
    # 6. OCR（如果文本太少）
    ocr_text = ""
    if len(pdf_text) < 100:
        ocr_text = extractor.ocr_image(pdf_path, page_num=0)
        if ocr_text:
            # 从OCR文本重新提取
            if not extracted_title:
                extracted_title = extractor.extract_title_from_text(ocr_text)
            if not extracted_author:
                extracted_author = extractor.extract_author_from_text(ocr_text)
            ocr_dates = extractor.extract_dates_from_text(ocr_text)
            # 合并日期
            for key in ocr_dates:
                if ocr_dates[key] and not extracted_dates[key]:
                    extracted_dates[key] = ocr_dates[key]
                if key == 'other' and ocr_dates['other']:
                    for d in ocr_dates['other']:
                        if d not in extracted_dates['other']:
                            extracted_dates['other'].append(d)
    
    # 打印结果
    print("\n" + "-"*80)
    print("【PDF元数据】")
    print("-"*80)
    print(f"标题: {pdf_metadata.get('title') or '(空)'}")
    print(f"作者: {pdf_metadata.get('author') or '(空)'}")
    print(f"第一作者: {pdf_metadata.get('firstAuthor') or '(空)'}")
    print(f"日期: {pdf_metadata.get('date') or '(空)'}")
    
    print("\n" + "-"*80)
    print("【从文本提取】")
    print("-"*80)
    print(f"PDF文本长度: {len(pdf_text)} 字符")
    if pdf_text:
        print(f"PDF文本预览（前500字符）:\n{pdf_text[:500]}")
    
    print(f"\n提取的标题: {extracted_title or '(未提取)'}")
    print(f"提取的作者: {extracted_author or '(未提取)'}")
    
    print("\n" + "-"*80)
    print("【提取的日期】")
    print("-"*80)
    print(f"Received: {extracted_dates.get('received') or '(无)'}")
    print(f"Accepted: {extracted_dates.get('accepted') or '(无)'}")
    print(f"Published: {extracted_dates.get('published') or '(无)'}")
    print(f"Revised: {extracted_dates.get('revised') or '(无)'}")
    print(f"Available Online: {extracted_dates.get('availableOnline') or '(无)'}")
    if extracted_dates.get('other'):
        print(f"Other: {', '.join(extracted_dates['other'])}")
    else:
        print(f"Other: (无)")
    
    if ocr_text:
        print("\n" + "-"*80)
        print("【OCR识别结果】")
        print("-"*80)
        print(f"OCR文本长度: {len(ocr_text)} 字符")
        print(f"OCR文本预览（前500字符）:\n{ocr_text[:500]}")
    
    print("\n" + "-"*80)
    print("【最终结果】")
    print("-"*80)
    final_title = pdf_metadata.get('title') or extracted_title or '(未提取)'
    final_author = pdf_metadata.get('firstAuthor') or extracted_author or '(未提取)'
    final_date = pdf_metadata.get('date') or extracted_dates.get('received') or extracted_dates.get('accepted') or extracted_dates.get('availableOnline') or '(未提取)'
    
    print(f"✓ 标题: {final_title}")
    print(f"✓ 第一作者: {final_author}")
    print(f"✓ 日期: {final_date}")
    
    print("\n" + "="*80)


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("用法: python test_pdf_extraction.py <PDF文件路径>")
        print("示例: python test_pdf_extraction.py paper.pdf")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    if not os.path.exists(pdf_path):
        print(f"错误: 文件不存在: {pdf_path}")
        sys.exit(1)
    
    if not pdf_path.lower().endswith('.pdf'):
        print(f"错误: 不是PDF文件: {pdf_path}")
        sys.exit(1)
    
    extractor = PDFExtractor()
    print_results(extractor, pdf_path)


if __name__ == '__main__':
    main()

