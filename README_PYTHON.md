# 论文验证工具 - Python GUI版本

## 功能说明

这是一个独立的Python GUI应用，用于验证从Chrome扩展下载的论文PDF文件。

### 主要功能

1. **拖拽JSON元数据文件**：支持拖拽或选择JSON文件
2. **自动PDF解析**：使用PyPDF2/pdfplumber提取PDF文本和元数据
3. **OCR识别**：对图像型PDF进行OCR识别（支持中英混排）
4. **智能匹配**：
   - 作者匹配（支持中文转拼音）
   - 日期匹配（支持多种日期格式）
   - 标题匹配（基于相似度）
5. **结果导出**：将验证结果导出为JSON文件

## 安装依赖

```bash
pip install -r requirements.txt
```

### 依赖说明

- **PyPDF2/pdfplumber**: PDF文本提取
- **OCR库**（三选一，推荐PaddleOCR）:
  - **PaddleOCR**（推荐）: 中文识别准确率高，支持GPU加速
  - **EasyOCR**: 支持80+语言，准确率高
  - **pytesseract**: 轻量级，需要安装Tesseract OCR引擎
- **pypinyin**: 中文转拼音（用于作者匹配，已经很成熟）
- **python-dateutil**: 日期解析

### OCR库安装（推荐PaddleOCR）

**方法1: PaddleOCR（推荐，中文识别最好）**
```bash
# 安装PaddleOCR
pip install paddlepaddle paddleocr

# 首次运行会自动下载模型文件（约100MB）
```

**方法2: EasyOCR（多语言支持好）**
```bash
# 安装EasyOCR
pip install easyocr

# 首次运行会自动下载模型文件（约200MB）
```

**方法3: pytesseract（需要额外安装Tesseract引擎）**
```bash
# 安装pytesseract
pip install pytesseract Pillow

# 然后安装Tesseract OCR引擎（见下方）
```

### Tesseract OCR安装（仅pytesseract需要）

**Windows:**
1. 下载安装包：https://github.com/UB-Mannheim/tesseract/wiki
2. 安装后，确保`tesseract.exe`在系统PATH中
3. 或设置环境变量：`pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'`

**macOS:**
```bash
brew install tesseract
brew install tesseract-lang  # 中文语言包
```

**Linux:**
```bash
sudo apt-get install tesseract-ocr
sudo apt-get install tesseract-ocr-chi-sim  # 中文语言包
```

## 使用方法

1. **生成元数据文件**：
   - 使用Chrome扩展下载论文时，会自动生成同名的`.json`文件
   - JSON文件包含网页提取的标题、作者、日期等信息

2. **运行Python GUI**：
   ```bash
   python python_verifier.py
   ```

3. **验证论文**：
   - 拖拽JSON文件到界面，或点击选择文件
   - 点击"开始验证"按钮
   - 查看验证结果

4. **导出结果**：
   - 点击"导出结果"按钮，保存验证结果

## JSON元数据文件格式

```json
{
  "title": "论文标题",
  "firstAuthor": "第一作者",
  "allAuthors": ["作者1", "作者2"],
  "date": "2025-01-01",
  "dates": {
    "received": "2025-01-01",
    "accepted": "2025-02-01",
    "published": "2025-03-01",
    "revised": null,
    "other": []
  },
  "pdfFileName": "paper.pdf",
  "pdfFilePath": "C:/Downloads/paper.pdf",
  "pdfFileDir": "C:/Downloads",
  "pageUrl": "https://example.com/paper",
  "originalUrl": "https://example.com/paper.pdf",
  "downloadTime": "2025-01-01T12:00:00Z"
}
```

## 验证逻辑

### 作者匹配
- 直接字符串匹配
- 中文转拼音匹配
- 分词匹配（处理姓名顺序不同）

### 日期匹配
- 支持多种日期格式
- 检查Received、Accepted、Published、Revised等日期类型

### 标题匹配
- 基于相似度计算
- 支持部分匹配

## 注意事项

1. **PDF文件路径**：确保JSON中的PDF文件路径正确
2. **OCR性能**：OCR识别较慢，大文件可能需要较长时间
3. **中文支持**：需要安装中文语言包才能进行中文OCR

## 故障排除

### OCR不可用
- 检查Tesseract OCR是否已安装
- 检查中文语言包是否已安装
- 设置`pytesseract.pytesseract.tesseract_cmd`路径

### PDF解析失败
- 检查PDF文件是否损坏
- 尝试使用不同的PDF库（PyPDF2或pdfplumber）

### 中文作者匹配失败
- 确保已安装`pypinyin`库
- 检查中文作者名是否正确

