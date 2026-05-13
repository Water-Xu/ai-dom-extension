# ✦ AI 页面操作助手

> 用自然语言直接修改任意网页的 DOM 结构 —— 隐藏广告、过滤列表、修改内容，所见即所得。

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-purple)

---

## 📖 这是什么

一个 Chrome 扩展程序，接入 AI 大模型（支持 OpenAI 及所有兼容接口），让你用中文描述想对当前网页做什么，AI 自动生成 JavaScript 代码并立即在页面中执行，**直接改变你看到的内容**。

**不是模拟用户点击，而是真正修改页面的 DOM 结构。**

### 使用场景示例

| 你说的话 | AI 做的事 |
|---------|---------|
| 隐藏页面上所有广告横幅 | 注入 CSS 将广告元素设为不可见 |
| 删除列表中经验不足 5 年的候选人 | 遍历卡片，移除不符合条件的节点 |
| 把所有价格改成 0 元 | 找到价格文本节点并替换内容 |
| 将倒计时改为 99:59:59 | 定位倒计时元素并修改其文本 |

---

## 🚀 安装

本扩展暂未上架 Chrome 应用商店，需手动加载。

**第一步：下载源码**

```bash
git clone https://github.com/你的用户名/ai-dom-extension.git
# 或直接下载 ZIP 解压
```

**第二步：打开 Chrome 扩展管理页**

在地址栏输入：
```
chrome://extensions/
```

**第三步：开启开发者模式**

点击右上角的「**开发者模式**」开关（打开后会出现三个按钮）。

**第四步：加载扩展**

点击「**加载已解压的扩展程序**」，选择刚才下载的 `ai-dom-extension` 文件夹。

加载成功后，浏览器右上角工具栏会出现扩展图标 ✦。

---

## ⚙️ 配置

首次使用前，必须配置 AI 接口信息。

**打开设置页**：点击扩展图标 → 点击右上角 ⚙ 按钮。

### 必填：API Key

填入你的 AI 服务 API Key。支持：

| 服务商 | API Key 获取地址 |
|-------|----------------|
| 盛算云中转站（推荐国内用户） | https://router.shengsuanyun.com |
| OpenAI 官方 | https://platform.openai.com/api-keys |
| DeepSeek | https://platform.deepseek.com |
| 月之暗面 Kimi | https://platform.moonshot.cn |
| 阿里通义千问 | https://bailian.console.aliyun.com |

### 选填：API Base URL

默认值为 `https://router.shengsuanyun.com/api/v1`（盛算云中转站）。

如需使用其他服务商，填入对应的接口地址：

```
OpenAI 官方：  https://api.openai.com/v1
DeepSeek：     https://api.deepseek.com/v1
Kimi：         https://api.moonshot.cn/v1
通义千问：     https://dashscope.aliyuncs.com/compatible-mode/v1
```

> 所有兼容 OpenAI Chat API 格式的接口均可使用。

### 选填：模型

点击预设模型徽章快速选择，或手动填写模型名称。

**推荐模型**（代码生成能力强）：
- `gpt-4o`
- `deepseek-chat`  
- `claude-3-5-sonnet-20241022`
- `gemini-2.0-flash`

填写完毕后点击「**💾 保存设置**」，再点「**测试连接**」验证配置是否正确。

---

## 🎯 使用方法

### 基础用法

1. 打开任意网页
2. 点击浏览器右上角的 **✦** 图标
3. 在底部输入框描述你想做的事
4. 按 **Enter** 或点击发送按钮
5. AI 生成代码并立即执行，页面实时变化

### 精准模式：选择区域

当页面内容复杂时，可以先框选目标区域，让 AI 聚焦在特定元素上：

1. 点击 **🎯 选择区域** 按钮（Popup 关闭，进入选择模式）
2. 在页面上**悬停**目标元素（元素会高亮显示）
3. **点击**确认选择（自动回到 Popup）
4. 输框上方会显示「已选择元素」的提示条
5. 此时发送指令，AI 仅针对该元素生成代码，**更精准、更省 token**

### 撤销操作

如果 AI 的修改不是你想要的，点击 **↩** 按钮可以一键恢复到执行前的状态（最多支持 5 步撤销）。

### 会话历史

扩展程序会按页面 URL 自动保存每次的对话记录。下次在同一页面打开 Popup 时，历史操作记录会自动加载显示。

点击 **🗑** 按钮可清除当前页面的全部历史记录。

---

## 📁 项目结构

```
ai-dom-extension/
├── manifest.json      # 扩展配置（Manifest V3）
├── background.js      # Service Worker：处理 AI API 调用和代码注入
├── content.js         # Content Script：DOM 访问、元素选择、撤销
├── popup.html         # 弹出窗口 HTML
├── popup.js           # 弹出窗口交互逻辑
├── popup.css          # 界面样式
├── options.html       # 设置页面 HTML
└── options.js         # 设置页面逻辑
```

---

## 🔧 工作原理

```
用户输入自然语言指令
        ↓
popup.js 发送消息至 background.js
        ↓
background.js 通过 content.js 提取页面 HTML 快照
        ↓
background.js 调用 AI API（发送页面结构 + 用户指令）
        ↓
AI 返回纯 JavaScript 代码字符串
        ↓
通过 Blob URL + <script> 标签注入页面主世界执行
（绕过页面 CSP 的 unsafe-eval 限制）
        ↓
页面 DOM 被修改，用户即时看到效果
```

---

## ⚠️ 常见问题

**Q：执行成功但页面没有变化？**  
A：该页面可能是 React / Vue 等框架构建的 SPA，框架会在渲染周期内还原被直接删除的节点。建议改用「隐藏」而非「删除」的描述方式，扩展会通过注入 CSS 实现持久生效。

**Q：提示 CSP 错误无法执行？**  
A：部分网站配置了严格的内容安全策略，同时限制了 `eval` 和 `blob:` 协议。此时可点击「复制代码」，按 F12 打开浏览器控制台，手动粘贴代码执行。

**Q：API Key 安全吗？**  
A：API Key 仅保存在你本地浏览器的 `chrome.storage.local` 中，不会上传至本扩展程序的任何服务器。Key 仅在你发送指令时，由你的浏览器直接请求你所配置的 AI 接口。

**Q：支持 Firefox 吗？**  
A：目前仅支持 Chrome / Edge / 基于 Chromium 的浏览器（Manifest V3）。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

如果这个工具对你有帮助，欢迎点个 ⭐ Star。

---

## 📬 联系作者

有问题、建议或合作意向，欢迎联系：

**Email：x17149@gmail.com**

---

## 📄 许可证

[MIT License](LICENSE) — 自由使用、修改和分发，保留版权声明即可。
