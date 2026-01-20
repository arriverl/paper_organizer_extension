# 论文智能整理助手

一个360浏览器插件，用于自动下载、解析和整理学术论文。插件能够从网页提取论文信息并生成JSON元数据文件，然后通过Python GUI工具进行验证和对比。

## 功能特点

### 浏览器插件功能
- ✅ 自动检测网页上的PDF下载链接
- ✅ 点击链接后自动下载PDF
- ✅ 从网页提取论文元数据（标题、作者、日期等）
- ✅ 自动生成JSON元数据文件（与PDF文件同名）
- ✅ 支持多种学术网站（arXiv、IEEE、ScienceDirect等）

### Python验证工具
- ✅ 读取插件生成的JSON元数据文件
- ✅ 从PDF文件中提取文本和元数据
- ✅ OCR识别（支持中英混排）
- ✅ 智能匹配验证（标题、作者、日期）
- ✅ 图形化界面，操作简单

## 工作流程

### 第一步：使用浏览器插件提取论文信息

1. **安装插件**
   - 打开360浏览器
   - 进入扩展管理页面：`chrome://extensions/`
   - 开启"开发者模式"（右上角开关）
   - 点击"加载已解压的扩展程序"
   - 选择 `paper_organizer_extension` 文件夹

2. **下载论文**
   - 访问包含PDF论文链接的网页
   - 点击任何 `.pdf` 链接
   - 插件会自动：
     - 拦截下载请求
     - 从网页提取论文元数据（标题、作者、日期等）
     - 下载PDF文件
     - 生成同名的JSON元数据文件（保存在下载目录）

3. **生成的JSON文件格式**
   ```json
   {
     "title": "论文标题",
     "firstAuthor": "第一作者",
     "allAuthors": ["作者1", "作者2"],
     "date": "2025-01-01",
     "dates": {
       "received": "2025-01-01",
       "accepted": "2025-02-01",
       "available_online": "2025-03-01"
     },
     "files": {
       "mainPdf": "论文文件名.pdf",
       "file1": "附件1.pdf",
       "file2": "附件2.pdf"
     },
     "webData": {
       "title": "论文标题",
       "firstAuthor": "第一作者",
       "allAuthors": ["作者1", "作者2"],
       "date": "2025-01-01"
     }
   }
   ```

### 第二步：使用Python GUI工具验证论文

1. **安装Python依赖**
   ```bash
   pip install -r requirements.txt
   ```
   
   **OCR库安装（三选一，推荐PaddleOCR）**：
   - **PaddleOCR**（推荐）：`pip install paddlepaddle paddleocr`
   - **EasyOCR**：`pip install easyocr`
   - **pytesseract**：`pip install pytesseract Pillow`（需要额外安装Tesseract引擎）

2. **运行验证工具**
   ```bash
   python verification_gui.py
   ```

3. **验证流程**
   - 设置下载目录（插件保存PDF和JSON文件的目录）
   - 选择或自动查找最新的JSON文件
   - 点击"开始验证"
   - 工具会自动：
     - 读取JSON文件中的元数据
     - 从对应的PDF文件中提取文本和元数据
     - 使用OCR识别（如需要）
     - 对比网页元数据与PDF提取的数据
     - 显示匹配结果（标题、作者、日期）

4. **查看验证结果**
   - 显示每个文件的详细验证信息
   - 显示PDF提取的数据
   - 显示OCR识别的数据
   - 显示匹配状态（✓ 匹配成功 / ✗ 匹配失败）
   - 显示最终汇总结果

## 项目结构

```
paper_organizer_extension/
├── manifest.json              # 插件配置文件
├── background.js               # 后台脚本（处理下载和解析）
├── content.js                  # 内容脚本（监听页面链接）
├── popup.html                  # 管理面板HTML
├── popup.css                   # 管理面板样式
├── popup.js                    # 管理面板逻辑
├── options.html                # 选项页面
├── options.js                  # 选项页面逻辑
├── verification.html           # 验证页面（浏览器内验证）
├── verification-page.js        # 验证页面脚本
├── verification.css            # 验证页面样式
├── ocr-api.js                  # OCR API封装
├── document-classifier.js      # 文档分类器
├── image-preprocessor.js       # 图像预处理器
├── pinyin-loader.js            # 拼音加载器
├── pdf-parser.js               # PDF解析工具（备用）
├── background-enhanced.js      # 增强版后台脚本（备用）
├── icons/                      # 图标文件夹
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── python_verifier.py          # Python验证核心模块
├── verification_gui.py         # Python GUI验证工具
├── ocr_api_python.py           # Python OCR API
├── requirements.txt            # Python依赖列表
├── gui_config.json             # GUI配置文件
├── ocr_config.json.example     # OCR配置示例文件
│
├── README.md                   # 本文件
├── README_PYTHON.md            # Python工具详细说明
├── VERIFICATION_GUIDE.md       # 浏览器内验证功能指南
└── INSTALL.md                  # 安装说明
```

## 技术实现

### 浏览器插件部分

#### PDF解析
- 使用 [pdf.js](https://mozilla.github.io/pdf.js/) 库解析PDF文件
- 从URL直接读取PDF（无需下载）
- 提取PDF元数据（标题、作者、关键词等）
- 提取PDF文本内容（前500字符）
- 通过正则表达式和关键词匹配提取日期

#### 日期提取逻辑
插件会搜索以下关键词附近的日期：
- "Communicated by"
- "Received"
- "Published in"
- "Accepted"
- "Submitted"
- "Available online"
- "Published"
- "Date of publication"

支持的日期格式：
- YYYY-MM-DD
- MM-DD-YYYY
- Month DD, YYYY
- YYYY

#### JSON元数据生成
- 自动提取网页中的论文信息
- 提取PDF元数据和文本内容
- 生成结构化的JSON文件
- 保存文件路径信息

### Python验证部分

#### PDF处理
- 使用PyPDF2/pdfplumber提取PDF文本和元数据
- 支持多种PDF格式

#### OCR识别
- 支持PaddleOCR、EasyOCR、pytesseract三种OCR引擎
- 支持中英混排识别
- 自动处理图像型PDF

#### 智能匹配
- **作者匹配**：支持中文转拼音、直接字符串匹配、分词匹配
- **日期匹配**：支持多种日期格式，检查Received、Accepted、Published等日期类型
- **标题匹配**：基于相似度计算，支持部分匹配

## 使用示例

### 示例1：下载并验证单篇论文

1. 在浏览器中访问论文页面
2. 点击PDF下载链接
3. 插件自动下载PDF并生成JSON文件
4. 运行 `python verification_gui.py`
5. 选择生成的JSON文件
6. 点击"开始验证"
7. 查看验证结果

### 示例2：批量验证论文

1. 使用插件下载多篇论文（每篇都会生成对应的JSON文件）
2. 运行 `python verification_gui.py`
3. 点击"自动查找最新JSON"按钮
4. 点击"开始验证"
5. 工具会验证所有关联的PDF文件
6. 查看汇总验证结果

## 注意事项

1. **文件路径**：确保JSON文件中的PDF文件路径正确
2. **OCR性能**：OCR识别较慢，大文件可能需要较长时间
3. **中文支持**：需要安装中文语言包才能进行中文OCR
4. **网络连接**：插件需要网络连接来加载pdf.js库
5. **浏览器兼容性**：主要支持360浏览器（基于Chromium）

## 故障排除

### 插件无法加载
- 确保开启了"开发者模式"
- 检查 `manifest.json` 文件是否存在且格式正确
- 查看扩展程序页面的错误信息

### PDF无法解析
- 网络连接问题（需要从CDN加载pdf.js）
- PDF链接有CORS限制（会回退到基础下载模式）
- 查看控制台错误信息

### Python验证失败
- 检查Python依赖是否已安装：`pip install -r requirements.txt`
- 检查OCR库是否正确安装
- 确保JSON文件中的PDF路径正确
- 查看错误日志信息

### OCR不可用
- 检查OCR库是否已安装（PaddleOCR/EasyOCR/pytesseract）
- 检查中文语言包是否已安装
- 对于pytesseract，确保Tesseract引擎已安装

## 开发路线图

### ✅ 已完成
- [x] 浏览器插件基础功能
- [x] PDF元数据提取
- [x] JSON元数据生成
- [x] Python验证工具
- [x] GUI界面
- [x] OCR识别支持
- [x] 智能匹配算法

### 🔄 计划中
- [ ] 批量处理优化
- [ ] 验证结果导出
- [ ] 更多学术网站支持
- [ ] 自动重命名功能增强

## 相关文档

- [README_PYTHON.md](README_PYTHON.md) - Python验证工具详细说明
- [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) - 浏览器内验证功能指南
- [INSTALL.md](INSTALL.md) - 详细安装说明

## 许可证

本项目仅供学习和研究使用。
