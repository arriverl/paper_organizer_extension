# 论文智能整理助手

一个360浏览器插件，用于自动下载、解析和整理学术论文。能够从网页的PDF链接处自动提取论文的作者、日期等信息，并按照 `[日期]_[第一作者]_[论文标题].pdf` 的格式自动重命名文件。

## 功能特点

### 第一阶段：基础功能 ✅
- ✅ 自动检测网页上的PDF下载链接
- ✅ 点击链接后自动下载PDF
- ✅ 提取PDF元数据（标题、关键词、作者）
- ✅ 在控制台打印元数据信息

### 第二阶段：智能提取 ✅
- ✅ 集成 pdf.js 库解析PDF内容
- ✅ 提取PDF正文前500个字符
- ✅ 通过关键词（"Communicated by", "Received", "Published in"等）精准定位日期
- ✅ 自动识别第一作者


### 2. 加载插件到360浏览器

1. 打开360浏览器
2. 进入扩展管理页面：
   - 点击右上角菜单 → 更多工具 → 扩展程序
   - 或直接访问 `chrome://extensions/`
3. 开启"开发者模式"（右上角开关）
4. 点击"加载已解压的扩展程序"
5. 选择 `paper_organizer_extension` 文件夹
6. 插件安装完成

## 使用方法

### 下载论文

1. 访问包含PDF论文链接的网页
2. 点击任何 `.pdf` 链接
3. 插件会自动：
   - 拦截下载请求
   - 解析PDF元数据和内容
   - 提取作者、日期等信息
   - 自动重命名文件并下载

### 查看已下载论文

1. 点击浏览器工具栏上的插件图标
2. 打开管理面板
3. 查看所有已下载论文的列表
4. 可以点击论文链接查看原始网页

### 控制台查看详细信息

打开浏览器开发者工具（F12），在控制台中可以看到：
- PDF下载链接检测信息
- PDF元数据提取结果
- 文件重命名信息

## 项目结构

```
paper_organizer_extension/
├── manifest.json              # 插件配置文件
├── background.js              # 后台脚本（处理下载和解析）
├── content.js                 # 内容脚本（监听页面链接）
├── popup.html                 # 管理面板HTML
├── popup.css                  # 管理面板样式
├── popup.js                   # 管理面板逻辑
├── pdf-parser.js              # PDF解析工具（备用）
├── background-enhanced.js     # 增强版后台脚本（备用）
├── icons/                     # 图标文件夹
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md                  # 本文件
```

## 技术实现

### PDF解析

使用 [pdf.js](https://mozilla.github.io/pdf.js/) 库来解析PDF文件：
- 从URL直接读取PDF（无需下载）
- 提取PDF元数据（标题、作者、关键词等）
- 提取PDF文本内容（前500字符）
- 通过正则表达式和关键词匹配提取日期

### 日期提取逻辑

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

### 文件重命名

文件名格式：`[日期]_[第一作者]_[论文标题].pdf`

- 自动清理非法字符（`<>:"/\|?*`）
- 限制各部分长度避免文件名过长
- 如果信息缺失，使用"未知日期"、"未知作者"等占位符

## 开发路线图

### ✅ 第一阶段：原型开发 (MVP)
- [x] manifest.json 配置
- [x] 检测PDF下载链接
- [x] 提取PDF元数据
- [x] 控制台输出信息

### ✅ 第二阶段：智能提取优化
- [x] 集成 pdf.js
- [x] 提取前500字符
- [x] 关键词定位日期
- [x] 提取第一作者

### ✅ 第三阶段：文件重命名与归档
- [x] 自动重命名文件
- [x] 管理面板
- [x] 论文列表展示
- [x] 本地存储

##python验证提取
```python verification_gui.py```

