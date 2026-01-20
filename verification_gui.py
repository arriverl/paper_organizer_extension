#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
论文验证GUI - 简化版
自动读取默认路径的JSON文件，执行验证并显示结果
"""

import json
import os
import sys
import re
import logging
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import threading
from datetime import datetime

# 导入验证器
try:
    from python_verifier import PDFVerifier, setup_logging
    HAS_VERIFIER = True
except ImportError:
    HAS_VERIFIER = False
    print("警告: 无法导入 python_verifier，请确保 python_verifier.py 在同一目录")

# 配置日志
logger = setup_logging() if HAS_VERIFIER else logging.getLogger('VerificationGUI')

class SimpleVerificationGUI:
    """简化的验证GUI - 自动读取默认路径的JSON文件"""
    
    def __init__(self, root):
        self.root = root
        self.root.title("论文验证工具 - 自动验证模式")
        self.root.geometry("1000x700")
        
        self.verifier = PDFVerifier() if HAS_VERIFIER else None
        self.json_file_path = None
        self.default_download_dir = None
        
        # 尝试获取默认下载目录（Windows）
        self.detect_default_download_dir()
        
        # 尝试从配置文件加载保存的下载目录
        self.load_saved_download_dir()
        
        self.setup_ui()
    
    def detect_default_download_dir(self):
        """检测默认下载目录"""
        # Windows默认下载目录
        if sys.platform == 'win32':
            user_profile = os.environ.get('USERPROFILE', '')
            if user_profile:
                # 常见下载目录
                possible_dirs = [
                    os.path.join(user_profile, 'Downloads'),
                    os.path.join(user_profile, '下载'),
                    r'D:\360安全浏览器下载',
                    r'D:\Downloads',
                ]
                for dir_path in possible_dirs:
                    if os.path.exists(dir_path):
                        self.default_download_dir = dir_path
                        logger.info(f"检测到默认下载目录: {dir_path}")
                        break
        else:
            # Linux/Mac
            user_home = os.path.expanduser('~')
            download_dir = os.path.join(user_home, 'Downloads')
            if os.path.exists(download_dir):
                self.default_download_dir = download_dir
                logger.info(f"检测到默认下载目录: {download_dir}")
    
    def setup_ui(self):
        """设置UI界面"""
        # 主框架
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # 标题
        title_label = ttk.Label(main_frame, text="论文验证工具", 
                               font=("Arial", 16, "bold"))
        title_label.grid(row=0, column=0, columnspan=2, pady=10)
        
        # 下载目录设置
        dir_frame = ttk.LabelFrame(main_frame, text="下载目录设置", padding="10")
        dir_frame.grid(row=1, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        ttk.Label(dir_frame, text="下载目录:").grid(row=0, column=0, sticky=tk.W, pady=5)
        self.download_dir_var = tk.StringVar(value=self.default_download_dir or '')
        dir_entry = ttk.Entry(dir_frame, textvariable=self.download_dir_var, width=60)
        dir_entry.grid(row=0, column=1, sticky=(tk.W, tk.E), padx=5, pady=5)
        
        # 浏览目录按钮
        browse_dir_btn = ttk.Button(dir_frame, text="浏览目录...", command=self.browse_download_dir)
        browse_dir_btn.grid(row=0, column=2, padx=5, pady=5)
        
        # 保存目录按钮
        save_dir_btn = ttk.Button(dir_frame, text="保存", command=self.save_download_dir)
        save_dir_btn.grid(row=0, column=3, padx=5, pady=5)
        
        # JSON文件路径设置
        json_frame = ttk.LabelFrame(main_frame, text="JSON文件路径", padding="10")
        json_frame.grid(row=2, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        # JSON文件路径输入
        ttk.Label(json_frame, text="JSON文件路径:").grid(row=1, column=0, sticky=tk.W, pady=5)
        self.json_path_var = tk.StringVar()
        json_entry = ttk.Entry(json_frame, textvariable=self.json_path_var, width=60)
        json_entry.grid(row=1, column=1, sticky=(tk.W, tk.E), padx=5, pady=5)
        
        # 浏览按钮
        browse_btn = ttk.Button(json_frame, text="浏览...", command=self.browse_json_file)
        browse_btn.grid(row=1, column=2, padx=5, pady=5)
        
        # 自动查找按钮
        auto_find_btn = ttk.Button(json_frame, text="自动查找最新JSON", command=self.auto_find_json)
        auto_find_btn.grid(row=2, column=0, columnspan=3, pady=5)
        
        # 验证按钮
        verify_frame = ttk.Frame(main_frame)
        verify_frame.grid(row=3, column=0, columnspan=2, pady=10)
        
        self.verify_btn = ttk.Button(verify_frame, text="开始验证", 
                                    command=self.start_verification,
                                    style="Accent.TButton")
        self.verify_btn.pack(side=tk.LEFT, padx=5)
        
        # 进度条
        self.progress = ttk.Progressbar(main_frame, mode='indeterminate')
        self.progress.grid(row=4, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        # 结果显示区域
        result_frame = ttk.LabelFrame(main_frame, text="验证结果", padding="10")
        result_frame.grid(row=5, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)
        
        self.result_text = scrolledtext.ScrolledText(result_frame, height=20, wrap=tk.WORD,
                                                     font=("Consolas", 10))
        self.result_text.pack(fill=tk.BOTH, expand=True)
        
        # 配置网格权重
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        main_frame.rowconfigure(5, weight=1)
        json_frame.columnconfigure(1, weight=1)
        dir_frame.columnconfigure(1, weight=1)
    
    def load_saved_download_dir(self):
        """从配置文件加载保存的下载目录"""
        try:
            config_file = 'gui_config.json'
            if os.path.exists(config_file):
                with open(config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    saved_dir = config.get('downloadDirectory')
                    if saved_dir and os.path.exists(saved_dir):
                        self.default_download_dir = saved_dir
                        logger.info(f"从配置文件加载下载目录: {saved_dir}")
        except Exception as e:
            logger.warning(f"加载保存的下载目录失败: {e}")
    
    def save_download_dir(self):
        """保存下载目录到配置文件"""
        download_dir = self.download_dir_var.get().strip()
        if not download_dir:
            messagebox.showwarning("警告", "下载目录不能为空")
            return
        
        if not os.path.exists(download_dir):
            messagebox.showerror("错误", f"目录不存在: {download_dir}")
            return
        
        try:
            config_file = 'gui_config.json'
            config = {}
            if os.path.exists(config_file):
                with open(config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
            
            config['downloadDirectory'] = download_dir
            
            with open(config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            
            self.default_download_dir = download_dir
            messagebox.showinfo("成功", f"下载目录已保存: {download_dir}")
            logger.info(f"下载目录已保存: {download_dir}")
        except Exception as e:
            messagebox.showerror("错误", f"保存失败: {str(e)}")
            logger.error(f"保存下载目录失败: {e}")
    
    def browse_download_dir(self):
        """浏览选择下载目录"""
        initial_dir = self.download_dir_var.get() or self.default_download_dir or os.getcwd()
        dir_path = tk.filedialog.askdirectory(
            title="选择下载目录",
            initialdir=initial_dir
        )
        if dir_path:
            self.download_dir_var.set(dir_path)
    
    def browse_json_file(self):
        """浏览选择JSON文件"""
        initial_dir = self.download_dir_var.get() or self.default_download_dir or os.getcwd()
        file_path = tk.filedialog.askopenfilename(
            title="选择JSON文件",
            initialdir=initial_dir,
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        if file_path:
            self.json_path_var.set(file_path)
            self.json_file_path = file_path
    
    def auto_find_json(self):
        """自动查找最新的JSON文件"""
        # 使用用户设置的下载目录
        download_dir = self.download_dir_var.get().strip() or self.default_download_dir
        
        if not download_dir or not os.path.exists(download_dir):
            messagebox.showwarning("警告", "未找到下载目录，请先设置下载目录")
            return
        
        # 查找所有JSON文件
        json_files = []
        try:
            for file in os.listdir(download_dir):
                if file.endswith('.json'):
                    file_path = os.path.join(download_dir, file)
                    if os.path.isfile(file_path):
                        # 获取文件修改时间
                        mtime = os.path.getmtime(file_path)
                        json_files.append((file_path, mtime))
        except Exception as e:
            messagebox.showerror("错误", f"查找JSON文件失败: {str(e)}")
            return
        
        if not json_files:
            messagebox.showinfo("提示", "在默认下载目录中未找到JSON文件")
            return
        
        # 按修改时间排序，选择最新的
        json_files.sort(key=lambda x: x[1], reverse=True)
        latest_json = json_files[0][0]
        
        self.json_path_var.set(latest_json)
        self.json_file_path = latest_json
        messagebox.showinfo("成功", f"已找到最新JSON文件:\n{os.path.basename(latest_json)}")
    
    def start_verification(self):
        """开始验证"""
        if not HAS_VERIFIER:
            messagebox.showerror("错误", "验证器未加载，请检查 python_verifier.py 是否存在")
            return
        
        json_path = self.json_path_var.get().strip()
        if not json_path:
            messagebox.showwarning("警告", "请先选择或自动查找JSON文件")
            return
        
        if not os.path.exists(json_path):
            messagebox.showerror("错误", f"JSON文件不存在: {json_path}")
            return
        
        # 在新线程中执行验证
        self.verify_btn.config(state='disabled')
        self.progress.start()
        self.result_text.delete(1.0, tk.END)
        
        thread = threading.Thread(target=self.verify_json_file, args=(json_path,))
        thread.daemon = True
        thread.start()
    
    def verify_json_file(self, json_path: str):
        """验证JSON文件"""
        try:
            # 更新UI显示开始验证
            self.root.after(0, lambda: self.result_text.insert(tk.END, 
                f"开始验证: {os.path.basename(json_path)}\n"
                f"文件路径: {json_path}\n"
                f"{'='*60}\n\n"))
            
            # 读取JSON文件
            with open(json_path, 'r', encoding='utf-8') as f:
                json_data = json.load(f)
            
            # 提取文件路径
            files = json_data.get('files', {})
            web_data = json_data.get('webData') or {}
            
            # 如果webData为空，尝试从JSON根级别获取元数据（兼容旧格式）
            if not web_data or not web_data.get('title'):
                web_data = {
                    'title': json_data.get('title', ''),
                    'firstAuthor': json_data.get('firstAuthor', '') or json_data.get('author', ''),
                    'allAuthors': json_data.get('allAuthors', []),
                    'date': json_data.get('date', '') or json_data.get('extractedDate', ''),
                    'dates': json_data.get('dates', None)
                }
            
            # 显示JSON内容摘要
            web_title = (web_data.get('title', '')[:80] if web_data.get('title') else '') or '(空)'
            web_author = web_data.get('firstAuthor', '') or '(空)'
            web_date = web_data.get('date', '') or '(空)'
            web_authors = ', '.join(web_data.get('allAuthors', [])) if web_data.get('allAuthors') else ''
            
            self.root.after(0, lambda wt=web_title, wa=web_author, wd=web_date, was=web_authors: 
                self.result_text.insert(tk.END,
                    f"网页元数据:\n"
                    f"  标题: {wt}\n"
                    f"  第一作者: {wa}\n"
                    f"  日期: {wd}\n"
                    f"  所有作者: {was}\n"
                    f"\n文件列表:\n"))
            
            # 收集所有文件路径
            file_paths = []
            
            # 处理files可能是dict或list的情况
            if isinstance(files, list):
                # 旧格式：files是列表
                for file_info in files:
                    if isinstance(file_info, dict):
                        file_path = file_info.get('filePath') or file_info.get('path') or file_info.get('url')
                        if file_path:
                            normalized_path = file_path.replace('/', os.sep).replace('\\', os.sep)
                            if not os.path.isabs(normalized_path):
                                json_dir = os.path.dirname(os.path.abspath(json_path))
                                normalized_path = os.path.normpath(os.path.join(json_dir, normalized_path))
                            
                            if os.path.exists(normalized_path):
                                file_paths.append(normalized_path)
                                self.root.after(0, lambda p=normalized_path: self.result_text.insert(tk.END,
                                    f"  ✓ {os.path.basename(p)}\n"))
                            else:
                                self.root.after(0, lambda p=normalized_path: self.result_text.insert(tk.END,
                                    f"  ✗ {os.path.basename(p)} (文件不存在)\n"))
            elif isinstance(files, dict):
                # 新格式：files是字典，包含mainPdf, file1, file2, file3
                for key in ['mainPdf', 'file1', 'file2', 'file3']:
                    file_path = files.get(key)
                    if file_path:
                        # 处理路径（可能是正斜杠，需要转换为系统路径）
                        normalized_path = file_path.replace('/', os.sep).replace('\\', os.sep)
                        if not os.path.isabs(normalized_path):
                            # 如果是相对路径，尝试相对于JSON文件目录
                            json_dir = os.path.dirname(os.path.abspath(json_path))
                            normalized_path = os.path.normpath(os.path.join(json_dir, normalized_path))
                        
                        if os.path.exists(normalized_path):
                            file_paths.append(normalized_path)
                            self.root.after(0, lambda p=normalized_path: self.result_text.insert(tk.END,
                                f"  ✓ {os.path.basename(p)}\n"))
                        else:
                            self.root.after(0, lambda p=normalized_path: self.result_text.insert(tk.END,
                                f"  ✗ {os.path.basename(p)} (文件不存在)\n"))
            else:
                # files格式未知
                self.root.after(0, lambda: self.result_text.insert(tk.END,
                    f"  警告: files字段格式未知: {type(files)}\n"))
            
            if not file_paths:
                self.root.after(0, lambda: (
                    self.result_text.insert(tk.END, "\n错误: 未找到任何有效的PDF文件\n"),
                    self.progress.stop(),
                    self.verify_btn.config(state='normal'),
                    messagebox.showerror("错误", "未找到任何有效的PDF文件")
                ))
                return
            
            # 执行验证
            self.root.after(0, lambda: self.result_text.insert(tk.END, 
                f"\n开始验证 {len(file_paths)} 个文件...\n{'='*60}\n\n"))
            
            # 收集所有验证结果，用于生成汇总
            all_results = []
            
            # 对每个文件执行验证
            for i, pdf_path in enumerate(file_paths, 1):
                file_name = os.path.basename(pdf_path)
                # 使用默认参数避免闭包问题
                self.root.after(0, lambda idx=i, total=len(file_paths), path=pdf_path, name=file_name:
                    self.result_text.insert(tk.END, 
                        f"[{idx}/{total}] 验证文件: {name}\n"))
                
                # 构建验证用的元数据（需要符合python_verifier的格式）
                # python_verifier期望的格式：metadata包含title, firstAuthor, date等字段
                metadata = {
                    'title': web_data.get('title', ''),
                    'firstAuthor': web_data.get('firstAuthor', ''),
                    'allAuthors': web_data.get('allAuthors', []),
                    'date': web_data.get('date', ''),
                    'dates': web_data.get('dates', None),
                    'files': [{
                        'type': '论文全文',
                        'fileName': file_name,
                        'filePath': pdf_path
                    }]
                }
                
                # 执行验证
                result = self.verifier.verify_paper(metadata, json_file_path=json_path)
                
                # 保存结果（包含文件名）
                result_with_filename = {
                    'result': result,
                    'file_name': file_name,
                    'file_index': i
                }
                all_results.append(result_with_filename)
                
                # 显示验证结果（使用默认参数避免闭包问题）
                self.root.after(0, lambda r=result, idx=i: self.display_result(r, idx))
            
            # 生成并显示汇总结果
            self.root.after(0, lambda results=all_results: self.display_summary(results))
            
            # 完成
            self.root.after(0, lambda: (
                self.result_text.insert(tk.END, f"\n{'='*60}\n验证完成！\n"),
                self.progress.stop(),
                self.verify_btn.config(state='normal'),
                messagebox.showinfo("完成", "验证完成！请查看结果区域")
            ))
            
        except json.JSONDecodeError as e:
            error_msg = f"JSON文件格式错误: {str(e)}\n"
            self.root.after(0, lambda: (
                self.result_text.insert(tk.END, error_msg),
                self.progress.stop(),
                self.verify_btn.config(state='normal'),
                messagebox.showerror("错误", error_msg)
            ))
        except Exception as e:
            import traceback
            error_msg = f"验证过程出错: {str(e)}\n详细错误:\n{traceback.format_exc()}\n"
            self.root.after(0, lambda: (
                self.result_text.insert(tk.END, error_msg),
                self.progress.stop(),
                self.verify_btn.config(state='normal'),
                messagebox.showerror("错误", f"验证失败: {str(e)}")
            ))
    
    def display_result(self, result: Dict, file_index: int = 1):
        """显示验证结果"""
        try:
            # python_verifier返回的格式：result包含files列表和overall_matches
            overall_matches = result.get('overall_matches', {})
            title_match = overall_matches.get('title', False)
            author_match = overall_matches.get('author', False)
            date_match = overall_matches.get('date', False)
            
            # 显示整体匹配结果
            # self.result_text.insert(tk.END, f"\n文件 {file_index} 验证结果:\n")
            # self.result_text.insert(tk.END, f"  标题匹配: {'✓' if title_match else '✗'}\n")
            # self.result_text.insert(tk.END, f"  作者匹配: {'✓' if author_match else '✗'}\n")
            # self.result_text.insert(tk.END, f"  日期匹配: {'✓' if date_match else '✗'}\n")
            
            # 显示网页元数据中的日期信息
            metadata = result.get('metadata', {})
            web_dates = metadata.get('dates', {})
            if web_dates:
                self.result_text.insert(tk.END, f"\n  网页日期信息:\n")
                if web_dates.get('received'):
                    self.result_text.insert(tk.END, f"    投稿日期 (Received): {web_dates.get('received')}\n")
                if web_dates.get('received_in_revised'):
                    self.result_text.insert(tk.END, f"    修改日期 (Received in Revised): {web_dates.get('received_in_revised')}\n")
                if web_dates.get('accepted'):
                    self.result_text.insert(tk.END, f"    接受日期 (Accepted): {web_dates.get('accepted')}\n")
                if web_dates.get('available_online'):
                    self.result_text.insert(tk.END, f"    在线日期 (Available Online): {web_dates.get('available_online')}\n")
            
            # 显示每个文件的详细信息
            files = result.get('files', [])
            for idx, file_result in enumerate(files, 1):
                self.result_text.insert(tk.END, f"\n 文件 {idx} 详细信息:\n")
                
                # PDF元数据
                pdf_metadata = file_result.get('pdf_metadata', {})
                if pdf_metadata:
                    self.result_text.insert(tk.END, f"  PDF提取数据:\n")
                    self.result_text.insert(tk.END, f"    标题: {pdf_metadata.get('title', '(空)')[:80]}\n")
                    self.result_text.insert(tk.END, f"    第一作者: {pdf_metadata.get('firstAuthor', '(空)')}\n")
                    self.result_text.insert(tk.END, f"    日期: {pdf_metadata.get('date', '(空)')}\n")
                
                # OCR数据
                ocr_text = file_result.get('ocr_text', '')
                if ocr_text:
                    self.result_text.insert(tk.END, f"    OCR文本长度: {len(ocr_text)} 字符\n")
                
                # 提取的日期信息
                extracted_dates = file_result.get('extracted_dates', {})
                if extracted_dates:
                    self.result_text.insert(tk.END, f"    提取的日期信息:\n")
                    if extracted_dates.get('received'):
                        self.result_text.insert(tk.END, f"      投稿日期 (Received): {extracted_dates.get('received')}\n")
                    if extracted_dates.get('revised'):
                        self.result_text.insert(tk.END, f"      修改日期 (Revised): {extracted_dates.get('revised')}\n")
                    if extracted_dates.get('accepted'):
                        self.result_text.insert(tk.END, f"      接受日期 (Accepted): {extracted_dates.get('accepted')}\n")
                    if extracted_dates.get('availableOnline'):
                        self.result_text.insert(tk.END, f"      在线日期 (Available Online): {extracted_dates.get('availableOnline')}\n")
                    if extracted_dates.get('published'):
                        self.result_text.insert(tk.END, f"      发表日期 (Published): {extracted_dates.get('published')}\n")
                    if not any([extracted_dates.get('received'), extracted_dates.get('revised'), 
                                extracted_dates.get('accepted'), extracted_dates.get('availableOnline'), 
                                extracted_dates.get('published')]):
                        self.result_text.insert(tk.END, f"      (未提取到日期信息)\n")
                
                # 匹配结果
                matches = file_result.get('matches', {})
                self.result_text.insert(tk.END, f"    匹配结果:\n")
                self.result_text.insert(tk.END, f"      标题: {'✓' if matches.get('title') else '✗'}\n")
                self.result_text.insert(tk.END, f"      作者: {'✓' if matches.get('author') else '✗'}\n")
                self.result_text.insert(tk.END, f"      日期: {'✓' if matches.get('date') else '✗'}\n")
                
                # 错误信息
                errors = file_result.get('errors', [])
                if errors:
                    self.result_text.insert(tk.END, f"    错误:\n")
                    for error in errors:
                        self.result_text.insert(tk.END, f"      - {error}\n")
            
            self.result_text.insert(tk.END, f"\n{'-'*60}\n")
            self.result_text.see(tk.END)
            
        except Exception as e:
            self.result_text.insert(tk.END, f"显示结果时出错: {str(e)}\n")
            logger.error(f"显示结果时出错: {e}", exc_info=True)
    
    def display_summary(self, all_results: List[Dict]):
        """显示所有文件的汇总验证结果"""
        try:
            self.result_text.insert(tk.END, f"\n{'='*60}\n")
            self.result_text.insert(tk.END, "最终验证结果:\n")
            
            # 收集每个匹配项的匹配文件（使用Set去重）
            title_matched_files = set()
            author_matched_files = set()
            date_matched_files = set()
            
            for result_info in all_results:
                result = result_info['result']
                file_name = result_info['file_name']
                
                # 检查整体匹配结果
                overall_matches = result.get('overall_matches', {})
                
                if overall_matches.get('title', False):
                    title_matched_files.add(file_name)
                
                if overall_matches.get('author', False):
                    author_matched_files.add(file_name)
                
                if overall_matches.get('date', False):
                    date_matched_files.add(file_name)
            
            # 转换为排序后的列表（保持显示顺序一致）
            title_matched_list = sorted(list(title_matched_files))
            author_matched_list = sorted(list(author_matched_files))
            date_matched_list = sorted(list(date_matched_files))
            
            # 显示汇总结果
            title_status = '✓' if title_matched_list else '✗'
            author_status = '✓' if author_matched_list else '✗'
            date_status = '✓' if date_matched_list else '✗'
            
            self.result_text.insert(tk.END, f"  标题匹配: {title_status}")
            if title_matched_list:
                self.result_text.insert(tk.END, f" 匹配文件：{', '.join(title_matched_list)}\n")
            else:
                self.result_text.insert(tk.END, "\n")
            
            self.result_text.insert(tk.END, f"  作者匹配: {author_status}")
            if author_matched_list:
                self.result_text.insert(tk.END, f" 匹配文件：{', '.join(author_matched_list)}\n")
            else:
                self.result_text.insert(tk.END, "\n")
            
            self.result_text.insert(tk.END, f"  日期匹配: {date_status}")
            if date_matched_list:
                self.result_text.insert(tk.END, f" 匹配文件：{', '.join(date_matched_list)}\n")
            else:
                self.result_text.insert(tk.END, "\n")
            
            self.result_text.see(tk.END)
            
        except Exception as e:
            self.result_text.insert(tk.END, f"显示汇总结果时出错: {str(e)}\n")
            logger.error(f"显示汇总结果时出错: {e}", exc_info=True)


def main():
    """主函数"""
    if not HAS_VERIFIER:
        print("错误: 无法导入 python_verifier.py")
        print("请确保 python_verifier.py 文件在同一目录下")
        sys.exit(1)
    
    root = tk.Tk()
    app = SimpleVerificationGUI(root)
    root.mainloop()


if __name__ == '__main__':
    main()

