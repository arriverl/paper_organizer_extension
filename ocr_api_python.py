#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OCR API模块 - Python版本
与插件中的二段式OCR API完全一致
"""

import json
import re
import logging
import base64
import requests
from typing import Dict, Optional, Tuple
from pathlib import Path

logger = logging.getLogger('OCRAPI')

# OCR配置（默认值，可以从配置文件或环境变量读取）
OCR_CONFIG = {
    'baseUrl': 'https://api.tokenpony.cn/v1',
    'apiKey': 'sk-148b93a7942b4c2b826a88dd6d5e00ad',
    'model': 'deepseek-ocr'
}

# LLM配置（用于结构化提取）
LLM_CONFIG = {
    'baseUrl': None,  # 如果为None，使用OCR的baseUrl
    'apiKey': None,   # 如果为None，使用OCR的apiKey
    'model': 'deepseek-chat'  # 默认LLM模型
}


def load_config_from_file(config_file: str = 'ocr_config.json'):
    """从配置文件加载OCR和LLM配置"""
    global OCR_CONFIG, LLM_CONFIG
    try:
        config_path = Path(config_file)
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                if 'ocrConfig' in config:
                    OCR_CONFIG.update(config['ocrConfig'])
                if 'llmConfig' in config:
                    LLM_CONFIG.update(config['llmConfig'])
                logger.info(f"已从配置文件加载配置: {config_file}")
    except Exception as e:
        logger.warning(f"加载配置文件失败: {e}")


def get_ocr_pure_text_prompt() -> str:
    """获取OCR纯文本提取提示词（与插件一致）"""
    return '请只返回图片/PDF页面中的**全部可见文字**，按从上到下顺序逐行输出。不要做邮箱界面判断，不要加入---占位符，不要输出JSON，不要总结。输出所有识别到的文字，包括标题、正文、日期、作者等所有内容。'


def get_academic_structuring_prompt() -> str:
    """获取学术信息结构化提示词（与插件一致）"""
    return """你是学术文档信息抽取助手。下面是OCR识别得到的原始文本（可能包含论文首页、录用通知、邮件、网页截图等）。请从中提取论文关键信息并输出严格JSON。

重要提示：
1) 如果文本中包含"收件箱"、"草稿箱"等邮箱界面词汇，但同时也包含论文相关信息（如论文名称、作者、录用日期等），请判断为【邮件】类型，并提取其中的论文信息。
2) 不要因为出现"收件箱"就判为界面，要检查是否包含实际的论文/录用信息。
3) 对于邮件场景，重点关注：邮件主题/托举对象、论文名称、作者、录用日期、发件人邮箱等信息。

日期提取规则（非常重要）：
1) received（投稿日期）：查找"Received"、"Received:"、"Received in revised form"等关键词后的日期。这是论文最初投稿的日期。
2) received_in_revised（修改后投稿日期）：查找"Received in revised form"、"Revised"、"Revised:"等关键词后的日期。这是修改后重新投稿的日期。
3) accepted（接受日期）：查找"Accepted"、"Accepted:"、"录用日期"、"同意录用"等关键词后的日期。这是论文被接受的日期。
4) available_online（在线发表日期）：查找"Available online"、"Available online:"、"Published online"等关键词后的日期。这是论文在线发表的日期，通常出现在论文首页底部或期刊信息附近。

重要区分：
- "Received"和"Available online"是不同的日期类型，不要混淆。
- "Received"通常出现在论文首页顶部或摘要附近，表示投稿日期。
- "Available online"通常出现在论文首页底部或期刊信息附近，表示在线发表日期。
- 如果文本中同时存在"Received"和"Available online"，必须分别提取，不要将"Received"的日期填入"available_online"字段。

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
}"""


def is_degenerate_ocr_output(text: str) -> bool:
    """检查OCR输出是否异常（与插件逻辑一致）"""
    if not text or len(text) < 50:
        return False
    
    # 移除空白字符
    t = re.sub(r'\s+', '', text)
    if len(t) < 50:
        return False
    
    # 统计字符频率
    counts = {}
    for ch in t:
        counts[ch] = counts.get(ch, 0) + 1
    
    entries = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    unique = len(entries)
    top_count = entries[0][1] if entries else 0
    top_ratio = top_count / len(t) if t else 0
    
    # 如果唯一字符数 <= 3 且最高字符占比 > 80%，认为是异常输出
    if unique <= 3 and top_ratio > 0.8:
        return True
    
    # 如果主要是标点符号且最高字符占比 > 60%，认为是异常输出
    if re.match(r'^[\}\]\)\{\[,.:;"\'`~!@#$%^&*+=<>|\\/-]+$', t) and top_ratio > 0.6:
        return True
    
    return False


def call_chat_completions(base_url: str, api_key: str, model: str, messages: list, 
                          temperature: float = 0, max_tokens: int = 2048) -> Dict:
    """调用Chat Completions API（与插件逻辑一致）"""
    
    if not base_url:
        raise ValueError('Base URL未配置')
    if not api_key:
        raise ValueError('API Key未配置')
    if not model:
        raise ValueError('Model未配置')
    
    # 构建API URL
    api_url = f"{base_url.rstrip('/')}/chat/completions"
    
    # 构建请求体
    request_body = {
        'model': model,
        'messages': messages,
        'temperature': temperature,
        'max_tokens': max_tokens,
        'stream': False
    }
    
    # 发送请求
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {api_key}'
    }
    
    logger.debug(f"发送API请求到: {api_url}")
    response = requests.post(api_url, json=request_body, headers=headers, timeout=60)
    
    if not response.ok:
        error_text = response.text
        raise Exception(f'API请求失败: {response.status_code} {response.reason} - {error_text}')
    
    data = response.json()
    content = data.get('choices', [{}])[0].get('message', {}).get('content')
    
    if not content:
        raise Exception('API返回内容为空')
    
    return {'content': content, 'raw': data}


def extract_json_from_text(text: str) -> Dict[str, any]:
    """从文本中提取JSON（与插件逻辑一致）"""
    if not text:
        return {'json': None, 'error': 'empty'}
    
    def try_parse(json_str: str) -> Dict:
        try:
            return {'json': json.loads(json_str), 'error': None}
        except Exception as e:
            return {'json': None, 'error': str(e)}
    
    # 尝试匹配 ```json ... ```
    json_block = re.search(r'```json\s*([\s\S]*?)\s*```', text, re.IGNORECASE)
    if json_block and json_block.group(1):
        return try_parse(json_block.group(1))
    
    # 尝试匹配 ``` ... ```
    code_block = re.search(r'```\s*([\s\S]*?)\s*```', text)
    if code_block and code_block.group(1):
        return try_parse(code_block.group(1))
    
    # 通过括号计数抽取第一个完整JSON对象
    brace_count = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == '{':
            if brace_count == 0:
                start = i
            brace_count += 1
        elif ch == '}':
            brace_count -= 1
            if brace_count == 0 and start != -1:
                candidate = text[start:i + 1]
                parsed = try_parse(candidate)
                if parsed['json']:
                    return parsed
                start = -1
    
    # 最后兜底：找最长的 {...}
    matches = re.findall(r'\{[\s\S]*\}', text)
    if matches:
        matches.sort(key=len, reverse=True)
        for m in matches:
            parsed = try_parse(m)
            if parsed['json']:
                return parsed
    
    return {'json': None, 'error': 'json_parse_failed'}


def build_structuring_input_text(ocr_text: str, max_chars: int = 8000) -> Tuple[str, bool]:
    """构建结构化输入文本（与插件逻辑一致）"""
    if not ocr_text:
        return '', False
    
    # 移除多余空白
    cleaned = re.sub(r'\s+', ' ', ocr_text).strip()
    
    # 如果超过最大长度，截断
    truncated = len(cleaned) > max_chars
    if truncated:
        cleaned = cleaned[:max_chars]
    
    return cleaned, truncated


def ocr_extract_text_from_image_data_url(image_data_url: str) -> str:
    """第一段OCR：从图片提取纯文本（与插件逻辑一致）"""
    if not OCR_CONFIG.get('apiKey'):
        raise ValueError('OCR API Key未配置，请在配置文件中配置API Key')
    if not OCR_CONFIG.get('baseUrl'):
        raise ValueError('OCR Base URL未配置')
    if not OCR_CONFIG.get('model'):
        raise ValueError('OCR模型未配置')
    
    retry_prompts = [
        get_ocr_pure_text_prompt(),
        '请只返回图片中的全部可见文字，逐行输出。不要做界面判断，不要加入占位符。',
        'Extract all visible text from the image line by line. Output only the text, no placeholders.'
    ]
    
    last_content = ''
    for i, current_prompt in enumerate(retry_prompts):
        logger.debug(f"[OCR] 尝试第{i+1}次，prompt前100字符: {current_prompt[:100]}")
        logger.debug(f"[OCR] 图片数据URL长度: {len(image_data_url)}, 前50字符: {image_data_url[:50]}")
        
        try:
            result = call_chat_completions(
                base_url=OCR_CONFIG['baseUrl'],
                api_key=OCR_CONFIG['apiKey'],
                model=OCR_CONFIG['model'],
                messages=[
                    {
                        'role': 'user',
                        'content': [
                            {'type': 'text', 'text': current_prompt},
                            {'type': 'image_url', 'image_url': {'url': image_data_url, 'detail': 'high'}}
                        ]
                    }
                ],
                temperature=0,
                max_tokens=4096
            )
            
            content = result['content']
            logger.debug(f"[OCR] API返回内容长度: {len(content)}")
            logger.debug(f"[OCR] API返回内容前200字符: {content[:200]}")
            
            # 检查返回内容是否包含提示词
            if current_prompt[:50] in content:
                logger.warning('[OCR] ⚠️ 警告：返回内容包含提示词，可能API调用有问题！')
                logger.warning(f'[OCR] 返回内容: {content}')
            
            last_content = content
            if not is_degenerate_ocr_output(content):
                return content
            
            logger.warning('[OCR] 检测到异常输出（低多样性/重复符号），准备重试...')
        except Exception as e:
            logger.error(f'[OCR] 第{i+1}次尝试失败: {e}')
            if i == len(retry_prompts) - 1:
                raise
    
    logger.warning('[OCR] 多次重试后仍异常，返回最后一次输出')
    return last_content


def structure_academic_info_from_ocr_text(ocr_text: str) -> Dict:
    """第二段LLM：从OCR文本中提取结构化信息（与插件逻辑一致）"""
    # 如果LLM配置为空字符串或None，使用OCR配置（与插件逻辑一致）
    base_url = LLM_CONFIG.get('baseUrl') or OCR_CONFIG.get('baseUrl')
    api_key = LLM_CONFIG.get('apiKey') or OCR_CONFIG.get('apiKey')
    model = LLM_CONFIG.get('model')
    
    # 处理空字符串的情况
    if not base_url or base_url.strip() == '':
        base_url = OCR_CONFIG.get('baseUrl')
    if not api_key or api_key.strip() == '':
        api_key = OCR_CONFIG.get('apiKey')
    
    if not base_url:
        raise ValueError('LLM Base URL未配置')
    if not api_key:
        raise ValueError('LLM API Key未配置')
    if not model:
        raise ValueError('LLM Model未配置')
    
    struct_input_text, truncated = build_structuring_input_text(ocr_text)
    
    try:
        result = call_chat_completions(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[
                {'role': 'system', 'content': '你是一个严谨的JSON信息抽取器。'},
                {'role': 'user', 'content': f"{get_academic_structuring_prompt()}\n\nOCR文本如下：\n{struct_input_text}"}
            ],
            temperature=0,
            max_tokens=2048
        )
        
        content = result['content']
        parsed = extract_json_from_text(content)
        
        return {
            'rawText': content,
            'structured': parsed['json'],
            'isStructured': bool(parsed['json']),
            'parseError': parsed['error'],
            'truncatedInput': truncated
        }
    except Exception as e:
        logger.error(f'[LLM] 结构化提取失败: {e}')
        return {
            'rawText': '',
            'structured': None,
            'isStructured': False,
            'parseError': str(e),
            'truncatedInput': truncated
        }


def perform_two_stage_ocr(image_data_url: str) -> Dict:
    """执行二段式OCR（与插件逻辑一致）"""
    logger.info('[OCR] 开始二段式OCR识别...')
    
    # 第一段：OCR提取纯文本
    logger.info('[OCR] 第一段：提取纯文本...')
    ocr_text = ocr_extract_text_from_image_data_url(image_data_url)
    logger.info(f'[OCR] ✓ OCR识别完成，文本长度: {len(ocr_text)}')
    logger.info(f'[OCR] ========== OCR原始文本输出 ==========')
    logger.info(f'[OCR] {ocr_text}')
    logger.info(f'[OCR] ========== OCR原始文本结束 ==========')
    
    # 第二段：LLM结构化
    logger.info('[LLM] 开始从OCR文本提取结构化信息...')
    llm_result = structure_academic_info_from_ocr_text(ocr_text)
    logger.info(f'[LLM] ✓ 结构化完成，是否结构化: {llm_result["isStructured"]}, 解析错误: {llm_result.get("parseError") or "无"}')
    logger.info(f'[LLM] ========== LLM原始输出 ==========')
    logger.info(f'[LLM] {llm_result["rawText"]}')
    logger.info(f'[LLM] ========== LLM原始输出结束 ==========')
    logger.info(f'[LLM] ========== LLM结构化结果 ==========')
    logger.info(f'[LLM] {json.dumps(llm_result["structured"], indent=2, ensure_ascii=False)}')
    logger.info(f'[LLM] ========== LLM结构化结果结束 ==========')
    
    return {
        'text': ocr_text,
        'structured': llm_result['structured'],
        'isStructured': llm_result['isStructured'],
        'parseError': llm_result.get('parseError'),
        'truncatedInput': llm_result.get('truncatedInput', False)
    }


# 测试主函数
if __name__ == '__main__':
    import sys
    import os
    
    # 配置日志
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    
    print("=" * 60)
    print("OCR API Python 模块测试")
    print("=" * 60)
    print()
    
    # 加载配置
    print("1. 加载配置文件...")
    load_config_from_file()
    print(f"   OCR配置: baseUrl={OCR_CONFIG.get('baseUrl')}, model={OCR_CONFIG.get('model')}, hasApiKey={bool(OCR_CONFIG.get('apiKey'))}")
    print(f"   LLM配置: baseUrl={LLM_CONFIG.get('baseUrl') or '(使用OCR配置)'}, model={LLM_CONFIG.get('model')}, hasApiKey={bool(LLM_CONFIG.get('apiKey'))}")
    print()
    
    # 检查是否有测试图片
    if len(sys.argv) > 1:
        image_path = sys.argv[1]
        print(f"2. 测试图片路径: {image_path}")
        
        if not os.path.exists(image_path):
            print(f"   ❌ 错误: 文件不存在: {image_path}")
            sys.exit(1)
        
        try:
            from pdf2image import convert_from_path
            from PIL import Image
            import io
            import base64
            
            # 判断是PDF还是图片
            if image_path.lower().endswith('.pdf'):
                print("   检测到PDF文件，转换为图片...")
                images = convert_from_path(image_path, first_page=1, last_page=1, dpi=300)
                if not images:
                    print("   ❌ 错误: PDF转图片失败")
                    sys.exit(1)
                image = images[0]
            else:
                print("   加载图片文件...")
                image = Image.open(image_path)
            
            print(f"   图片尺寸: {image.size}")
            
            # 转换为data URL
            buffer = io.BytesIO()
            image.save(buffer, format='JPEG', quality=95)
            image_bytes = buffer.getvalue()
            image_base64 = base64.b64encode(image_bytes).decode('utf-8')
            image_data_url = f'data:image/jpeg;base64,{image_base64}'
            
            print(f"   图片已转换为data URL，长度: {len(image_data_url)} 字符")
            print()
            
            # 执行二段式OCR
            print("3. 执行二段式OCR识别...")
            print("   (这可能需要一些时间，请耐心等待...)")
            print()
            
            result = perform_two_stage_ocr(image_data_url)
            
            print()
            print("=" * 60)
            print("OCR识别结果")
            print("=" * 60)
            print(f"文本长度: {len(result.get('text', ''))} 字符")
            print(f"是否结构化: {result.get('isStructured', False)}")
            if result.get('parseError'):
                print(f"解析错误: {result.get('parseError')}")
            print()
            
            if result.get('text'):
                print("OCR文本（前500字符）:")
                print("-" * 60)
                print(result['text'][:500])
                if len(result['text']) > 500:
                    print("...")
                print("-" * 60)
                print()
            
            if result.get('structured'):
                print("结构化结果:")
                print("-" * 60)
                print(json.dumps(result['structured'], indent=2, ensure_ascii=False))
                print("-" * 60)
            
        except ImportError as e:
            print(f"   ❌ 错误: 缺少必要的库: {e}")
            print("   请安装: pip install pdf2image pillow")
            sys.exit(1)
        except Exception as e:
            print(f"   ❌ 错误: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)
    else:
        print("使用方法:")
        print("  python ocr_api_python.py <图片路径或PDF路径>")
        print()
        print("示例:")
        print("  python ocr_api_python.py test.jpg")
        print("  python ocr_api_python.py test.pdf")
        print()
        print("注意:")
        print("  1. 确保已创建 ocr_config.json 配置文件")
        print("  2. 确保已安装必要的库: pip install pdf2image pillow requests")
        print("  3. 如果测试PDF，需要安装 poppler (Windows: 下载并添加到PATH)")

