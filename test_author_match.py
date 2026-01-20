#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""测试作者匹配逻辑"""

import re
from pypinyin import lazy_pinyin, Style

def convert_chinese_to_pinyin(chinese: str) -> str:
    """转换中文为拼音"""
    if not chinese:
        return chinese
    
    try:
        # 使用pypinyin转换
        pinyin_list = lazy_pinyin(chinese, style=Style.NORMAL)
        # 首字母大写
        pinyin = ' '.join([p.capitalize() for p in pinyin_list])
        print(f"[拼音转换] 初始转换结果: {chinese} -> {pinyin}")
        
        # 处理连续重复的名字部分
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
                # 姓在前：合并后面的词作为名
                surname = words[0]
                given_name = ''.join(words[1:])
                result = f"{surname} {given_name}"
                print(f"[拼音转换] 姓在前，合并名部分: {pinyin} -> {result}")
                return result
        
        return pinyin
    except Exception as e:
        print(f"拼音转换失败: {e}")
        return chinese

def check_author_match(web_author: str, pdf_author: str) -> bool:
    """检查作者匹配"""
    print(f"\n[作者匹配] 开始匹配 - 网页作者: {web_author}, PDF作者: {pdf_author}")
    
    if not web_author or not pdf_author:
        print("[作者匹配] 作者名为空，匹配失败")
        return False
    
    # 先检查是否是中文，如果是中文，先转换为拼音，然后再标准化
    # 这样可以避免中文在标准化时被移除
    if any('\u4e00' <= char <= '\u9fff' for char in web_author):
        print("[作者匹配] 检测到中文作者，转换为拼音")
        web_pinyin = convert_chinese_to_pinyin(web_author).lower()
        web_pinyin_norm = re.sub(r'[^a-z\s]', '', web_pinyin).strip()
        web_pinyin_words = web_pinyin_norm.split()
        print(f"[作者匹配] 拼音转换结果: {web_pinyin} -> {web_pinyin_norm}, 分词: {web_pinyin_words}")
        
        # 对PDF作者进行标准化
        pdf_norm = re.sub(r'[^a-z\s]', '', pdf_author.lower()).strip()
        pdf_words = pdf_norm.split()
        print(f"[作者匹配] PDF标准化后 - pdf_norm: {pdf_norm}, pdf_words: {pdf_words}")
        
        if not pdf_norm:
            print("[作者匹配] PDF作者标准化后为空，匹配失败")
            return False
        
        # 检查拼音是否匹配
        if len(web_pinyin_words) >= 2:
            # 方法1：检查完全匹配（顺序相同）
            if web_pinyin_norm == pdf_norm:
                print(f"[作者匹配] ✓ 完全匹配成功: {web_pinyin_norm} == {pdf_norm}")
                return True
            
            # 方法2：检查顺序互换（姓在前 vs 名在前）
            all_web_in_pdf = all(w in pdf_words for w in web_pinyin_words)
            all_pdf_in_web = all(w in web_pinyin_words for w in pdf_words)
            print(f"[作者匹配] 顺序互换检查: all_web_in_pdf={all_web_in_pdf}, all_pdf_in_web={all_pdf_in_web}, "
                  f"web_words={web_pinyin_words}, pdf_words={pdf_words}, "
                  f"web_pinyin_norm={web_pinyin_norm}, pdf_norm={pdf_norm}")
            
            if all_web_in_pdf and all_pdf_in_web:
                # 如果词数相同，完全匹配
                if len(web_pinyin_words) == len(pdf_words):
                    print(f"[作者匹配] ✓ 顺序互换匹配成功（词数相同）: {web_pinyin_norm} <-> {pdf_norm}")
                    return True
                # 如果词数不同，但所有词都匹配，也认为匹配
                if len(web_pinyin_words) >= 2 and len(pdf_words) >= 2:
                    matched_count = sum(1 for w in web_pinyin_words if w in pdf_words)
                    print(f"[作者匹配] 词数不同但匹配检查: 匹配词数={matched_count}, web_words={web_pinyin_words}, pdf_words={pdf_words}")
                    if matched_count >= 2:
                        print(f"[作者匹配] ✓ 顺序互换匹配成功（词数不同但所有词匹配）: {web_pinyin_norm} <-> {pdf_norm}")
                        return True
            
            # 方法3：检查部分匹配（姓匹配 + 名匹配，顺序无关）
            web_surname = web_pinyin_words[0]
            web_given_name_parts = web_pinyin_words[1:]
            web_given_name_combined = ''.join(web_given_name_parts)
            
            # PDF可能是姓在前或名在前
            pdf_surname_last = pdf_words[-1]
            pdf_given_name_parts_last = pdf_words[:-1]
            pdf_given_name_combined_last = ''.join(pdf_given_name_parts_last)
            
            pdf_surname_first = pdf_words[0]
            pdf_given_name_parts_first = pdf_words[1:]
            pdf_given_name_combined_first = ''.join(pdf_given_name_parts_first)
            
            print(f"[作者匹配] 方法3-姓/名分别匹配检查: web_surname={web_surname}, web_given={web_given_name_combined}, "
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
            
            print(f"[作者匹配] 方法3-姓/名匹配结果: surname_last={surname_match_last}, given_last={given_name_match_last}, "
                  f"surname_first={surname_match_first}, given_first={given_name_match_first}, "
                  f"surname_rev={surname_match_reversed}, given_rev={given_name_match_reversed}")
            
            if (surname_match_last and given_name_match_last) or \
               (surname_match_first and given_name_match_first) or \
               (surname_match_reversed and given_name_match_reversed):
                print(f"[作者匹配] ✓ 方法3-姓/名分别匹配成功: {web_pinyin_norm} <-> {pdf_norm}")
                return True
    
    # 英文名字匹配（支持顺序互换）
    # 标准化：转小写，移除标点，保留空格
    web_norm = re.sub(r'[^a-z\s]', '', web_author.lower()).strip()
    pdf_norm = re.sub(r'[^a-z\s]', '', pdf_author.lower()).strip()
    
    print(f"[作者匹配] 英文标准化后 - web_norm: {web_norm}, pdf_norm: {pdf_norm}")
    
    if not web_norm or not pdf_norm:
        print("[作者匹配] 标准化后为空，匹配失败")
        return False
    
    web_words = web_norm.split()
    pdf_words = pdf_norm.split()
    
    print(f"[作者匹配] 英文分词后 - web_words: {web_words}, pdf_words: {pdf_words}")
    
    # 如果只有一个词，直接比较
    if len(web_words) < 2 or len(pdf_words) < 2:
        return web_norm == pdf_norm
    
    # 方法1：完全匹配
    if web_norm == pdf_norm:
        print(f"[作者匹配] ✓ 完全匹配成功: {web_norm} == {pdf_norm}")
        return True
    
    # 方法2：检查所有词是否都匹配（顺序无关）
    all_web_in_pdf = all(w in pdf_words for w in web_words)
    all_pdf_in_web = all(w in web_words for w in pdf_words)
    if all_web_in_pdf and all_pdf_in_web:
        print(f"[作者匹配] ✓ 顺序互换匹配成功: {web_norm} <-> {pdf_norm}")
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
        print(f"[作者匹配] ✓ 姓/名分别匹配成功: {web_norm} <-> {pdf_norm}")
        return True
    
    print("[作者匹配] ✗ 所有匹配方法都失败")
    return False

if __name__ == "__main__":
    # 测试用例
    print("=" * 60)
    print("测试用例1: 田纪辰 vs Jichen Tian")
    print("=" * 60)
    result1 = check_author_match("田纪辰", "Jichen Tian")
    print(f"\n最终结果: {'✓ 匹配成功' if result1 else '✗ 匹配失败'}")
    
    print("\n" + "=" * 60)
    print("测试用例2: 田纪辰 vs Jichen Tiana")
    print("=" * 60)
    result2 = check_author_match("田纪辰", "Jichen Tiana")
    print(f"\n最终结果: {'✓ 匹配成功' if result2 else '✗ 匹配失败'}")

