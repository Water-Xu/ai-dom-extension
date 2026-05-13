// ============================================================
//  AI DOM 操作助手 - Service Worker (background.js)
//  负责：接收 popup 指令 → 调用 AI API → 将代码注入页面执行
// ============================================================

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_API_BASE = 'https://router.shengsuanyun.com/api/v1';

// ── 消息监听 ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PROCESS_COMMAND') {
    handleCommand(message.payload)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 保持消息通道开放（异步响应必须）
  }

  if (message.type === 'GET_SETTINGS') {
    getSettings().then(sendResponse);
    return true;
  }
});

// ── 核心处理流程 ──────────────────────────────────────────────
async function handleCommand({ command, tabId, selectedHtml, mode }) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('❌ 请先在设置页面配置 API Key');
  }

  // 1. 获取页面 DOM（如果用户没有手动选择元素则自动提取）
  let pageContext = selectedHtml;
  if (!pageContext) {
    const [domResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageDOM,
      args: [mode === 'focused'], // focused 模式只取可视区域
    });
    pageContext = domResult.result;
  }

  // 2. 获取当前标签页信息
  const tab = await chrome.tabs.get(tabId);

  // 3. 调用 AI 生成 JS 代码
  const code = await callAI({
    command,
    pageHtml: pageContext,
    pageUrl: tab.url,
    pageTitle: tab.title,
    settings,
  });

  if (!code || !code.trim()) {
    throw new Error('AI 未返回有效代码，请重新描述需求');
  }

  // 4. 在页面中执行生成的代码（world:'MAIN' 运行在页面主世界，Blob URL 绕过 CSP eval 限制）
  const [execResult] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: executeAICode,
    args: [code],
  });

  return {
    success: true,
    code: code,
    execResult: execResult.result,
  };
}

// ── 在页面上下文中执行：提取 DOM ─────────────────────────────
// 注意：此函数通过 scripting.executeScript 注入到页面执行，不能引用外部变量
function extractPageDOM(focusedMode) {
  try {
    const clone = document.documentElement.cloneNode(true);

    // 移除无关标签，大幅压缩体积
    clone.querySelectorAll(
      'script, style, noscript, link[rel="stylesheet"], svg, canvas, video, audio, iframe'
    ).forEach(el => el.remove());

    // 移除事件属性
    clone.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('on') || attr.name === 'style') {
          el.removeAttribute(attr.name);
        }
      });
    });

    let html = clone.outerHTML;

    // 移除空属性、data-* 属性（减小体积）
    html = html.replace(/\s+data-[\w-]+="[^"]*"/g, '');
    html = html.replace(/\s+aria-[\w-]+="[^"]*"/g, '');
    html = html.replace(/\s+class="[\s]*"/g, '');

    // 限制总长度（约 20K tokens）
    const MAX_LEN = 80000;
    if (html.length > MAX_LEN) {
      html = html.substring(0, MAX_LEN) + '\n<!-- 页面内容已截断... -->';
    }

    return html;
  } catch (e) {
    return `<!-- DOM 提取失败: ${e.message} -->`;
  }
}

// ── 在页面主世界执行：运行 AI 生成的代码 ─────────────────────
// 通过 Blob URL + <script> 标签注入，彻底避免 eval / new Function 的 CSP 限制
// 此函数通过 chrome.scripting.executeScript({ world:'MAIN' }) 注入，运行在页面主 JS 上下文中
function executeAICode(code) {
  return new Promise(function (resolve) {
    var settled = false;
    function done(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      document.removeEventListener('securitypolicyviolation', onCspViolation);
      resolve(result);
    }

    // ① 将当前 body 快照保存到 DOM 属性（两个 JS World 共享同一 DOM，都能读写）
    try {
      var snapshots = [];
      try { snapshots = JSON.parse(document.documentElement.dataset.aiUndoStack || '[]'); } catch (_) {}
      if (document.body) {
        snapshots.push(document.body.innerHTML);
        if (snapshots.length > 5) snapshots.shift();
        document.documentElement.dataset.aiUndoStack = JSON.stringify(snapshots);
      }
    } catch (_) {}

    // ② 监听 CSP 违规事件（比 onerror 更早、更可靠）
    var cspBlocked = false;
    function onCspViolation(e) {
      if (e.blockedURI === 'blob' || e.blockedURI === 'eval' || e.blockedURI === 'inline') {
        cspBlocked = true;
      }
    }
    document.addEventListener('securitypolicyviolation', onCspViolation);

    // ③ 5 秒超时保底，防止 onerror 不触发时 Promise 永久挂起
    var timeoutId = setTimeout(function () {
      done({
        success: false,
        message: cspBlocked
          ? '⚠ 该页面的 CSP 策略阻止了代码执行（不允许 blob: 协议）。\n请复制上方代码，按 F12 打开控制台后粘贴执行。'
          : '⚠ 执行超时，代码已注入但无法确认结果（页面响应过慢？）',
      });
    }, 5000);

    // ④ 把 AI 代码包裹成 IIFE，执行结果写入临时 window 属性
    var resultKey = '__aiExec_' + Date.now();
    var wrapped = [
      '(function(){',
      'try{',
      code,
      '\nwindow["' + resultKey + '"]={success:true,message:"执行成功"};',
      '}catch(e){',
      'window["' + resultKey + '"]={success:false,message:"执行出错: "+e.message};',
      '}',
      '})()'
    ].join('\n');

    // ⑤ 用 Blob URL 创建 <script>，不触发 unsafe-eval
    var blob, url;
    try {
      blob = new Blob([wrapped], { type: 'text/javascript' });
      url  = URL.createObjectURL(blob);
    } catch (e) {
      done({ success: false, message: '创建执行环境失败: ' + e.message });
      return;
    }

    var script = document.createElement('script');
    script.src = url;

    script.addEventListener('load', function () {
      URL.revokeObjectURL(url);
      script.remove();
      var result = window[resultKey] || { success: true, message: '执行成功' };
      try { delete window[resultKey]; } catch (_) {}
      done(result);
    });

    script.addEventListener('error', function () {
      URL.revokeObjectURL(url);
      script.remove();
      done({
        success: false,
        message: '⚠ 该页面的 CSP 策略阻止了 blob: 协议脚本。\n请复制上方代码，按 F12 打开控制台后粘贴执行。',
      });
    });

    (document.head || document.documentElement).appendChild(script);
  });
}

// ── 调用 AI API ──────────────────────────────────────────────
async function callAI({ command, pageHtml, pageUrl, pageTitle, settings }) {
  const apiBase = settings.apiBase || DEFAULT_API_BASE;
  const model = settings.model || DEFAULT_MODEL;

  const systemPrompt = `你是一个专业的网页DOM操作专家，内嵌在Chrome扩展中。
你的任务：根据用户的需求，分析页面HTML结构，生成能直接在浏览器中执行的JavaScript代码，通过修改DOM来实现用户想要的效果。

【严格规则】
1. 只返回纯JavaScript代码，绝对不要添加任何解释文字
2. 不要使用Markdown代码块（不要\`\`\`javascript 或 \`\`\`）
3. 代码精准、有针对性，只修改用户要求的内容
4. 使用标准DOM API：querySelector、querySelectorAll、getElementById等
5. 必须用if判断元素是否存在，防止报错
6. 禁止使用 alert()、confirm()、prompt() 等阻塞操作
7. 禁止跳转页面（不要修改 location）
8. 代码必须立即可执行，自包含，无需引入外部库

【关键：隐藏/删除元素的正确方式】
页面通常是 React/Vue/Angular 等框架构建的 SPA，直接 element.remove() 后框架会在下一渲染周期将节点还原。
因此，隐藏/删除元素必须按以下优先级执行：

优先级1（最可靠）—— 注入 <style> 标签用 CSS 隐藏，能穿透框架重渲染：
  const s = document.createElement('style');
  s.id = '__ai-style-' + Date.now();
  s.textContent = 'CSS选择器 { display: none !important; }';
  document.documentElement.appendChild(s);

优先级2（次选）—— 同时遍历当前节点隐藏 + 注入 CSS 双保险：
  document.querySelectorAll('选择器').forEach(el => { el.style.setProperty('display','none','important'); });
  // 再追加上面的 <style> 注入

优先级3（仅文本/属性修改时）—— 直接操作 DOM 属性：
  el.textContent = '新文本';
  el.setAttribute('src', '新值');

【当前页面信息】
URL: ${pageUrl}
标题: ${pageTitle}`;

  const userContent = `【页面HTML结构】
${pageHtml}

【用户需求】
${command}`;

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 3000,
    }),
  });

  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const errData = await response.json();
      errMsg = errData.error?.message || errMsg;
    } catch (_) {}
    throw new Error(`AI API 调用失败: ${errMsg}`);
  }

  const data = await response.json();
  let code = data.choices?.[0]?.message?.content || '';

  // 清理 AI 可能添加的 markdown 代码块标记
  code = code.replace(/^```(?:javascript|js|typescript|ts)?\s*/i, '');
  code = code.replace(/\s*```\s*$/i, '');
  code = code.trim();

  return code;
}

// ── 工具函数 ─────────────────────────────────────────────────
async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      ['apiKey', 'apiBase', 'model'],
      result => resolve(result || {})
    );
  });
}
