#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF解析测试脚本 - 直接测试本地PDF文件
"""

import sys
import re
from pathlib import Path

try:
    import PyPDF2
    HAS_PYPDF2 = True
except ImportError:
    HAS_PYPDF2 = False
    print("警告: PyPDF2未安装，将使用基础文本提取")

try:
    from pdfminer.high_level import extract_text
    HAS_PDFMINER = True
except ImportError:
    HAS_PDFMINER = False

try:
    import pytesseract
    from PIL import Image
    import pdf2image
    HAS_OCR = True
except ImportError:
    HAS_OCR = False
    print("警告: OCR库未安装（pytesseract, pdf2image, PIL），无法处理图像PDF")

def extract_text_from_pdf(file_path, use_ocr=False):
    """从PDF提取文本"""
    text = ""
    
    # 首先尝试文本提取
    if HAS_PDFMINER:
        try:
            text = extract_text(file_path)
            if text and len(text.strip()) > 50:
                print(f"✓ 使用pdfminer提取文本: {len(text)} 字符")
                return text
        except Exception as e:
            print(f"pdfminer提取失败: {e}")
    
    if HAS_PYPDF2:
        try:
            with open(file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                text = ""
                for i, page in enumerate(pdf_reader.pages[:3]):  # 只读取前3页
                    page_text = page.extract_text()
                    text += page_text + " "
                if text and len(text.strip()) > 50:
                    print(f"✓ 使用PyPDF2提取文本: {len(text)} 字符")
                    return text
        except Exception as e:
            print(f"PyPDF2提取失败: {e}")
    
    # 如果文本提取失败或文本很少，尝试OCR
    if (not text or len(text.strip()) < 50) and (use_ocr or HAS_OCR):
        print("\n⚠ 文本提取失败或文本很少，尝试使用OCR识别...")
        text = extract_text_with_ocr(file_path)
        if text:
            return text
    
    return text

def extract_text_with_ocr(file_path):
    """使用OCR从PDF图像中提取文本"""
    if not HAS_OCR:
        print("❌ OCR库未安装，无法处理图像PDF")
        print("请安装: pip install pytesseract pdf2image pillow")
        return ""
    
    try:
        print("正在将PDF转换为图像...")
        # 将PDF第一页转换为图像
        images = pdf2image.convert_from_path(file_path, first_page=1, last_page=1, dpi=300)
        
        if not images:
            print("❌ 无法将PDF转换为图像")
            return ""
        
        print(f"✓ PDF已转换为图像，分辨率: {images[0].size}")
        
        # 使用OCR识别
        print("正在使用OCR识别文字...")
        ocr_text = pytesseract.image_to_string(images[0], lang='eng')
        
        if ocr_text and len(ocr_text.strip()) > 10:
            print(f"✓ OCR识别成功: {len(ocr_text)} 字符")
            return ocr_text
        else:
            print("⚠ OCR识别结果为空或过短")
            return ""
            
    except Exception as e:
        error_msg = str(e)
        print(f"❌ OCR识别失败: {error_msg}")
        
        if "poppler" in error_msg.lower() or "page count" in error_msg.lower():
            print("\n⚠ 问题: 缺少 poppler 工具（用于将PDF转换为图像）")
            print("解决方案:")
            print("1. 下载 poppler for Windows:")
            print("   https://github.com/oschwartz10612/poppler-windows/releases/")
            print("2. 解压后，将 bin 目录添加到系统 PATH 环境变量")
            print("   例如: C:\\poppler\\Library\\bin")
            print("3. 或者使用 conda 安装:")
            print("   conda install -c conda-forge poppler")
        elif "tesseract" in error_msg.lower():
            print("提示: 需要安装Tesseract OCR引擎")
            print("Windows: 下载安装 https://github.com/UB-Mannheim/tesseract/wiki")
        else:
            print("提示: 请检查Tesseract和poppler是否正确安装")
        
        return ""

def extract_metadata_from_pdf(file_path):
    """从PDF提取元数据"""
    metadata = {}
    
    if HAS_PYPDF2:
        try:
            with open(file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                if pdf_reader.metadata:
                    metadata = {
                        'title': pdf_reader.metadata.get('/Title', ''),
                        'author': pdf_reader.metadata.get('/Author', ''),
                        'subject': pdf_reader.metadata.get('/Subject', ''),
                        'creator': pdf_reader.metadata.get('/Creator', ''),
                        'producer': pdf_reader.metadata.get('/Producer', ''),
                        'creation_date': str(pdf_reader.metadata.get('/CreationDate', '')),
                        'mod_date': str(pdf_reader.metadata.get('/ModDate', ''))
                    }
        except Exception as e:
            print(f"元数据提取失败: {e}")
    
    return metadata

def extract_all_authors(text, metadata):
    """提取所有作者（包括equal contribution信息）"""
    authors = []
    has_equal_contribution = False
    equal_contribution_authors = []  # 记录哪些作者有equal contribution标记
    
    # 检查equal contribution标记，并提取相关作者
    equal_contribution_patterns = [
        r'contributed equally',
        r'equal contribution',
        r'equally contributed',
        r'contributed\.\s*equally',
        r'\(contributed equally\)',
        r'\(equal contribution\)',
    ]
    
    # 特殊标记（†, ‡等）
    special_markers = [r'†', r'‡', r'\*', r'#']
    
    # 首先检查是否有equal contribution关键词
    found_keyword = False
    keyword_context = ""
    for pattern in equal_contribution_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            found_keyword = True
            # 提取标记前后200字符的上下文
            start = max(0, match.start() - 200)
            end = min(len(text), match.end() + 200)
            keyword_context = text[start:end]
            print(f"  ✓ 检测到equal contribution标记: {pattern}")
            print(f"    上下文位置: {match.start()}-{match.end()}")
            break
    
    # 如果有equal contribution关键词，尝试提取相关作者
    if found_keyword and keyword_context:
        # 在上下文中查找作者名（通常格式：Name1, Name2 (contributed equally)）
        # 或者：Name1†, Name2† († contributed equally)
        author_name_pattern = r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[†‡\*#]?'
        context_authors = re.findall(author_name_pattern, keyword_context)
        
        # 检查标记前后的作者
        lines = keyword_context.split('\n')
        for i, line in enumerate(lines):
            if re.search(r'contributed equally|equal contribution', line, re.IGNORECASE):
                # 检查前后几行的作者
                for j in range(max(0, i-2), min(len(lines), i+3)):
                    line_authors = re.findall(author_name_pattern, lines[j])
                    for author in line_authors:
                        if len(author.split()) >= 2:  # 至少包含名和姓
                            equal_contribution_authors.append(author.strip())
        
        if equal_contribution_authors:
            equal_contribution_authors = list(dict.fromkeys(equal_contribution_authors))  # 去重
            has_equal_contribution = True
            print(f"    找到可能有equal contribution的作者: {', '.join(equal_contribution_authors[:5])}")
    
    # 检查特殊标记（†, ‡等）
    for marker_pattern in special_markers:
        # 查找标记后的说明文字
        marker_with_note = re.search(
            rf'{marker_pattern}\s*(?:contributed\s+equally|equal\s+contribution|These\s+authors\s+contributed\s+equally)',
            text, re.IGNORECASE
        )
        if marker_with_note:
            has_equal_contribution = True
            print(f"  ✓ 检测到特殊标记: {marker_pattern}")
            # 查找标记前的作者
            marker_pos = marker_with_note.start()
            before_text = text[max(0, marker_pos-300):marker_pos]
            # 提取标记前的作者名
            authors_with_marker = re.findall(r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*' + marker_pattern, before_text)
            if authors_with_marker:
                equal_contribution_authors.extend(authors_with_marker)
                print(f"    找到带标记的作者: {', '.join(authors_with_marker)}")
    
    # 从元数据提取
    if metadata.get('author'):
        meta_authors = [a.strip() for a in metadata['author'].split(',')]
        authors.extend(meta_authors)
    
    # 从文本中提取作者列表
    author_list_patterns = [
        r'Author[s]?:\s*([^\n]+(?:\n[^\n]+)*?)(?:\n\n|\nAbstract|$)',
        r'By:\s*([^\n]+(?:\n[^\n]+)*?)(?:\n\n|\nAbstract|$)',
        r'^([A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+(?:\s*[,;]\s*[A-Z][a-z]+ [A-Z]\. [A-Z][a-z]+)*)'
    ]
    
    for pattern in author_list_patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            author_text = match.group(1)
            # 分割作者
            extracted_authors = re.split(r'[,;]\s*|\n', author_text)
            extracted_authors = [
                re.sub(r'\(contributed equally\)', '', a, flags=re.IGNORECASE).strip()
                .replace('(equal contribution)', '').strip()
                .replace('†', '').strip()
                .replace('‡', '').strip()
                for a in extracted_authors
            ]
            extracted_authors = [a for a in extracted_authors if a and len(a) > 2]
            
            if extracted_authors:
                authors.extend(extracted_authors)
                break
    
    # 去重
    unique_authors = list(dict.fromkeys(authors))  # 保持顺序的去重
    equal_contribution_authors = list(dict.fromkeys(equal_contribution_authors))  # 去重
    
    # 验证第一作者是否在equal contribution列表中
    first_author_has_equal = False
    if unique_authors and equal_contribution_authors:
        first_author = unique_authors[0]
        # 模糊匹配：检查第一作者是否在equal contribution列表中
        for ec_author in equal_contribution_authors:
            # 提取姓氏进行比较
            first_author_last = first_author.split()[-1] if first_author.split() else ""
            ec_author_last = ec_author.split()[-1] if ec_author.split() else ""
            if first_author_last and ec_author_last and first_author_last.lower() == ec_author_last.lower():
                first_author_has_equal = True
                print(f"  ✓ 验证: 第一作者 '{first_author}' 在equal contribution列表中")
                break
            # 完全匹配
            if first_author.lower() in ec_author.lower() or ec_author.lower() in first_author.lower():
                first_author_has_equal = True
                print(f"  ✓ 验证: 第一作者 '{first_author}' 在equal contribution列表中")
                break
    
    return {
        'authors': unique_authors,
        'first_author': unique_authors[0] if unique_authors else None,
        'has_equal_contribution': has_equal_contribution,
        'equal_contribution_authors': equal_contribution_authors,
        'first_author_has_equal': first_author_has_equal
    }

def extract_first_author(text, metadata):
    """提取第一作者（兼容函数）"""
    author_info = extract_all_authors(text, metadata)
    return author_info['first_author']

def extract_all_dates(text):
    """提取所有类型的日期"""
    result = {
        'received': None,
        'accepted': None,
        'published': None,
        'other': []
    }
    
    # 日期关键词
    date_keywords = {
        'received': [
            'Received', 'Received date', 'Received:', 'Submitted', 
            'Submitted on', 'Submission date'
        ],
        'accepted': [
            'Accepted', 'Accepted date', 'Accepted:', 'Acceptance date'
        ],
        'published': [
            'Published', 'Published date', 'Published:', 
            'Publication date', 'Date of publication', 'Available online'
        ]
    }
    
    # 日期格式
    date_patterns = [
        r'(\d{4}[-/]\d{1,2}[-/]\d{1,2})',  # YYYY-MM-DD
        r'(\d{1,2}[-/]\d{1,2}[-/]\d{4})',  # MM-DD-YYYY
        r'([A-Z][a-z]+ \d{1,2}, \d{4})',   # Month DD, YYYY
        r'(\d{1,2} [A-Z][a-z]+ \d{4})',    # DD Month YYYY
        r'(\d{4})'                          # YYYY
    ]
    
    # 提取Received日期
    for keyword in date_keywords['received']:
        keyword_index = text.find(keyword)
        if keyword_index != -1:
            context = text[keyword_index:keyword_index + 150]
            for pattern in date_patterns:
                match = re.search(pattern, context)
                if match:
                    result['received'] = match.group(1)
                    print(f"  ✓ 找到Received日期: {match.group(1)} (关键词: {keyword})")
                    break
            if result['received']:
                break
    
    # 提取Accepted日期
    for keyword in date_keywords['accepted']:
        keyword_index = text.find(keyword)
        if keyword_index != -1:
            context = text[keyword_index:keyword_index + 150]
            for pattern in date_patterns:
                match = re.search(pattern, context)
                if match:
                    result['accepted'] = match.group(1)
                    print(f"  ✓ 找到Accepted日期: {match.group(1)} (关键词: {keyword})")
                    break
            if result['accepted']:
                break
    
    # 提取Published日期
    for keyword in date_keywords['published']:
        keyword_index = text.find(keyword)
        if keyword_index != -1:
            context = text[keyword_index:keyword_index + 150]
            for pattern in date_patterns:
                match = re.search(pattern, context)
                if match:
                    result['published'] = match.group(1)
                    print(f"  ✓ 找到Published日期: {match.group(1)} (关键词: {keyword})")
                    break
            if result['published']:
                break
    
    # 提取其他日期
    all_dates = []
    for pattern in date_patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            if match not in [result['received'], result['accepted'], result['published']]:
                # 检查年份是否合理
                year_match = re.search(r'(\d{4})', match)
                if year_match:
                    year = int(year_match.group(1))
                    if 1900 <= year <= 2100:
                        all_dates.append(match)
    
    result['other'] = list(set(all_dates))[:5]  # 去重并限制数量
    
    return result

def test_pdf(file_path):
    """测试PDF文件解析"""
    print("=" * 60)
    print("PDF解析测试工具")
    print("=" * 60)
    print(f"\n文件路径: {file_path}")
    
    # 检查文件是否存在
    if not Path(file_path).exists():
        print(f"\n❌ 错误: 文件不存在!")
        print(f"请检查路径是否正确")
        return
    
    print(f"✓ 文件存在")
    
    # 提取元数据
    print("\n[1/3] 提取PDF元数据...")
    metadata = extract_metadata_from_pdf(file_path)
    if metadata:
        print("✓ 元数据提取成功:")
        for key, value in metadata.items():
            if value:
                print(f"  - {key}: {value}")
    else:
        print("⚠ 未找到元数据")
    
    # 提取文本
    print("\n[2/3] 提取PDF文本内容（前3页）...")
    text = extract_text_from_pdf(file_path, use_ocr=True)  # 启用OCR
    
    if not text or len(text.strip()) < 10:
        print("❌ 无法提取文本内容")
        print("提示: 如果是图像PDF，请确保已安装Tesseract OCR")
        return
    
    print(f"✓ 文本提取成功: {len(text)} 字符")
    print(f"\n前500字符预览:")
    print("-" * 60)
    print(text[:500])
    print("-" * 60)
    
    # 提取信息
    print("\n[3/3] 分析并提取信息...")
    
    # 提取作者信息（包括equal contribution）
    print("\n提取作者信息...")
    author_info = extract_all_authors(text, metadata)
    first_author = author_info['first_author']
    all_authors = author_info['authors']
    has_equal_contribution = author_info['has_equal_contribution']
    equal_contribution_authors = author_info.get('equal_contribution_authors', [])
    first_author_has_equal = author_info.get('first_author_has_equal', False)
    
    print(f"第一作者: {first_author if first_author else '未找到'}")
    print(f"所有作者: {', '.join(all_authors) if all_authors else '未找到'}")
    
    if has_equal_contribution:
        if equal_contribution_authors:
            print(f"Equal Contribution标记的作者: {', '.join(equal_contribution_authors[:5])}")
        if first_author_has_equal:
            print(f"Equal Contribution: 是 ✓ (已验证: 第一作者 '{first_author}' 在标记中)")
        else:
            print(f"Equal Contribution: 是 ⚠ (检测到标记，但第一作者 '{first_author}' 未在标记中)")
    else:
        print(f"Equal Contribution: 否")
    
    # 提取所有日期
    print("\n提取日期信息...")
    dates = extract_all_dates(text)
    
    print("\n" + "=" * 60)
    print("解析结果汇总")
    print("=" * 60)
    print(f"\n标题: {metadata.get('title', '未找到')}")
    print(f"第一作者: {first_author or '未找到'}")
    print(f"所有作者: {', '.join(all_authors) if all_authors else '未找到'}")
    if has_equal_contribution:
        if equal_contribution_authors:
            print(f"Equal Contribution标记的作者: {', '.join(equal_contribution_authors[:5])}")
        if first_author_has_equal:
            print(f"Equal Contribution: 是 ✓ (已验证: 第一作者在标记中)")
        else:
            print(f"Equal Contribution: 是 ⚠ (检测到标记，但第一作者未在标记中)")
    else:
        print(f"Equal Contribution: 否")
    print(f"\nReceived日期: {dates['received'] or '未找到'}")
    print(f"Accepted日期: {dates['accepted'] or '未找到'}")
    print(f"Published日期: {dates['published'] or '未找到'}")
    if dates['other']:
        print(f"其他日期: {', '.join(dates['other'])}")
    print(f"\n创建日期: {metadata.get('creation_date', '未找到')}")
    print(f"修改日期: {metadata.get('mod_date', '未找到')}")
    
    print("\n" + "=" * 60)
    print("测试完成!")
    print("=" * 60)

if __name__ == "__main__":
    # 默认测试文件路径（图像PDF示例）
    default_path = r"D:\文档\xwechat_files\wxid_khk0tui54ai122_f010\msg\file\2025-12\46b4eaa3534f42c1bdad7dcac3c579c9.pdf"
    
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
    else:
        file_path = default_path
    
    # URL解码（如果是file://路径）
    if file_path.startswith('file:///'):
        file_path = file_path.replace('file:///', '')
        file_path = urllib.parse.unquote(file_path)
    
    # 设置Tesseract路径（如果需要）
    if HAS_OCR:
        try:
            # Windows默认路径
            import os
            tesseract_paths = [
                r'C:\Program Files\Tesseract-OCR\tesseract.exe',
                r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
            ]
            for tesseract_path in tesseract_paths:
                if os.path.exists(tesseract_path):
                    pytesseract.pytesseract.tesseract_cmd = tesseract_path
                    print(f"✓ 找到Tesseract: {tesseract_path}")
                    break
        except:
            pass
    
    test_pdf(file_path)

