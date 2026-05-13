// ============================================================
//  AI DOM 操作助手 - Popup 逻辑 (popup.js)
// ============================================================

// ── 状态 ──────────────────────────────────────────────────────
let isLoading        = false;
let selectedElementInfo = null;
let currentPageKey   = null;   // 当前页面的历史存储 key
let sessionMessages  = [];     // 当前会话的消息数组（含历史）

const MAX_HISTORY_PER_PAGE = 60;  // 每个页面最多保留的消息数
const MAX_HISTORY_PAGES    = 150; // 最多缓存多少个不同页面

// ── DOM 引用 ──────────────────────────────────────────────────
const chatArea       = document.getElementById('chat-area');
const cmdInput       = document.getElementById('cmd-input');
const sendBtn        = document.getElementById('send-btn');
const welcome        = document.getElementById('welcome');
const contextBadge   = document.getElementById('context-badge');
const contextTag     = document.getElementById('context-tag');
const contextPreview = document.getElementById('context-preview');

// ── 初始化 ────────────────────────────────────────────────────
async function init() {
  bindEvents();
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // 获取当前标签页，加载历史
  const tab = await getActiveTab();
  if (tab) {
    currentPageKey = getPageKey(tab);
    sessionMessages = await loadHistory(currentPageKey);

    if (sessionMessages.length > 0) {
      welcome.style.display = 'none';
      renderHistoryBanner(tab);
      sessionMessages.forEach(msg => renderMessage(msg, true));
      scrollToBottom();
    }
  }

  // 检查 API Key
  const settings = await getSettings();
  if (!settings.apiKey) showApiKeyHint();
}

function bindEvents() {
  sendBtn.addEventListener('click', handleSend);
  cmdInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    autoResizeTextarea();
  });
  cmdInput.addEventListener('input', autoResizeTextarea);

  document.getElementById('btn-select').addEventListener('click', toggleSelectMode);
  document.getElementById('btn-select-sm').addEventListener('click', toggleSelectMode);
  document.getElementById('btn-undo').addEventListener('click', handleUndo);
  document.getElementById('btn-undo-sm').addEventListener('click', handleUndo);
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-clear-ctx').addEventListener('click', clearContext);
  document.getElementById('btn-clear-history').addEventListener('click', handleClearHistory);

  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      cmdInput.value = chip.dataset.cmd;
      autoResizeTextarea();
      cmdInput.focus();
    });
  });
}

// ── 消息监听 ──────────────────────────────────────────────────
function onRuntimeMessage(message) {
  if (message.type === 'ELEMENT_SELECTED') {
    setSelectedElement(message.info);
    document.getElementById('btn-select').classList.remove('active');
    document.getElementById('btn-select-sm').classList.remove('active');
  }
  if (message.type === 'SELECT_CANCELLED') {
    document.getElementById('btn-select').classList.remove('active');
    document.getElementById('btn-select-sm').classList.remove('active');
  }
}

// ── 历史记录：存储 Key ────────────────────────────────────────
function getPageKey(tab) {
  try {
    const u = new URL(tab.url);
    // 用 origin + pathname 作为 key，忽略查询参数和 hash
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch (_) {
    return tab.url || 'unknown';
  }
}

// ── 历史记录：读写 ────────────────────────────────────────────
function loadHistory(pageKey) {
  return new Promise(resolve => {
    chrome.storage.local.get('chatHistory', result => {
      const all = result.chatHistory || {};
      resolve(all[pageKey] || []);
    });
  });
}

async function saveHistory() {
  if (!currentPageKey) return;
  await new Promise(resolve => {
    chrome.storage.local.get('chatHistory', result => {
      const all = result.chatHistory || {};
      all[currentPageKey] = sessionMessages.slice(-MAX_HISTORY_PER_PAGE);
      // 防止无限增长：超出页面数限制时删除最旧的
      const keys = Object.keys(all);
      if (keys.length > MAX_HISTORY_PAGES) {
        keys.slice(0, keys.length - MAX_HISTORY_PAGES).forEach(k => delete all[k]);
      }
      chrome.storage.local.set({ chatHistory: all }, resolve);
    });
  });
}

async function handleClearHistory() {
  if (!currentPageKey) return;
  await new Promise(resolve => {
    chrome.storage.local.get('chatHistory', result => {
      const all = result.chatHistory || {};
      delete all[currentPageKey];
      chrome.storage.local.set({ chatHistory: all }, resolve);
    });
  });
  sessionMessages = [];
  // 清空聊天区，恢复欢迎页
  chatArea.innerHTML = '';
  chatArea.appendChild(welcome);
  welcome.style.display = '';
  showToast('✓ 本页历史已清除', 'success');
}

// ── 历史渲染 ──────────────────────────────────────────────────
function renderHistoryBanner(tab) {
  const hostname = (() => { try { return new URL(tab.url).hostname; } catch(_){ return tab.url; } })();
  const count    = sessionMessages.length;
  const el = document.createElement('div');
  el.className = 'history-banner';
  el.innerHTML = `
    <div class="history-banner-line"></div>
    <div class="history-banner-text">
      <span class="history-banner-icon">🕐</span>
      <span>${hostname} · ${count} 条历史记录</span>
    </div>
    <div class="history-banner-line"></div>`;
  chatArea.appendChild(el);
}

// ── 统一渲染函数（支持从历史重放 or 新消息）────────────────────
function renderMessage(msg, isHistory = false) {
  switch (msg.type) {
    case 'user':  renderUserBubble(msg.text, isHistory); break;
    case 'ai':    renderAIResult(msg.code, msg.execResult, isHistory); break;
    case 'error': renderError(msg.text, isHistory); break;
  }
}

// ── 元素选择模式 ──────────────────────────────────────────────
async function toggleSelectMode() {
  const tab = await getActiveTab();
  if (!tab) return;
  const selectBtn   = document.getElementById('btn-select');
  const selectBtnSm = document.getElementById('btn-select-sm');
  const isActive = selectBtn.classList.contains('active');
  if (isActive) {
    selectBtn.classList.remove('active');
    selectBtnSm.classList.remove('active');
    await sendToContentScript(tab.id, { type: 'EXIT_SELECT_MODE' });
  } else {
    selectBtn.classList.add('active');
    selectBtnSm.classList.add('active');
    await ensureContentScriptLoaded(tab.id);
    await sendToContentScript(tab.id, { type: 'ENTER_SELECT_MODE' });
    window.close();
  }
}

function setSelectedElement(info) {
  selectedElementInfo = info;
  contextTag.textContent = `<${info.tagName}>`;
  contextPreview.textContent = info.textPreview || '已选择元素';
  contextBadge.style.display = 'flex';
}

function clearContext() {
  selectedElementInfo = null;
  contextBadge.style.display = 'none';
}

// ── 发送命令 ──────────────────────────────────────────────────
async function handleSend() {
  const command = cmdInput.value.trim();
  if (!command || isLoading) return;

  const tab = await getActiveTab();
  if (!tab) { showToast('无法获取当前标签页', 'error'); return; }

  const settings = await getSettings();
  if (!settings.apiKey) { openSettings(); showToast('请先配置 API Key', 'error'); return; }

  cmdInput.value = '';
  autoResizeTextarea();
  if (welcome) welcome.style.display = 'none';

  // ① 渲染并保存用户消息
  const userMsg = { type: 'user', text: command, ts: Date.now() };
  sessionMessages.push(userMsg);
  renderUserBubble(command);
  await saveHistory();

  // ② 思考动画
  const thinkingEl = appendThinking();
  setLoading(true);

  try {
    await ensureContentScriptLoaded(tab.id);
    const response = await chrome.runtime.sendMessage({
      type: 'PROCESS_COMMAND',
      payload: { command, tabId: tab.id, selectedHtml: selectedElementInfo?.html || null },
    });

    thinkingEl.remove();

    if (response.success) {
      const aiMsg = { type: 'ai', code: response.code, execResult: response.execResult, ts: Date.now() };
      sessionMessages.push(aiMsg);
      renderAIResult(response.code, response.execResult);
      await saveHistory();
    } else {
      const errMsg = { type: 'error', text: response.error || '未知错误', ts: Date.now() };
      sessionMessages.push(errMsg);
      renderError(response.error || '未知错误');
      await saveHistory();
    }
  } catch (err) {
    thinkingEl.remove();
    const errMsg = { type: 'error', text: err.message || '发送失败，请检查网络或 API 配置', ts: Date.now() };
    sessionMessages.push(errMsg);
    renderError(errMsg.text);
    await saveHistory();
  } finally {
    setLoading(false);
    scrollToBottom();
  }
}

// ── 撤销 ──────────────────────────────────────────────────────
async function handleUndo() {
  const tab = await getActiveTab();
  if (!tab) return;
  try {
    const res = await sendToContentScript(tab.id, { type: 'UNDO' });
    showToast(res?.success ? '✓ 已撤销' : '没有可撤销的操作', res?.success ? 'success' : 'warning');
  } catch (_) { showToast('撤销失败', 'error'); }
}

// ── 渲染：用户气泡 ────────────────────────────────────────────
function renderUserBubble(text, isHistory = false) {
  const el = document.createElement('div');
  el.className = 'message msg-user' + (isHistory ? ' is-history' : '');
  el.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  chatArea.appendChild(el);
}

// ── 渲染：思考动画 ────────────────────────────────────────────
function appendThinking() {
  const el = document.createElement('div');
  el.className = 'message msg-ai';
  el.innerHTML = `
    <div class="thinking-card">
      <div class="thinking-dots">
        <div class="thinking-dot"></div>
        <div class="thinking-dot"></div>
        <div class="thinking-dot"></div>
      </div>
      <span class="thinking-text">AI 正在分析页面并生成代码...</span>
    </div>`;
  chatArea.appendChild(el);
  scrollToBottom();
  return el;
}

// ── 渲染：AI 结果 ─────────────────────────────────────────────
function renderAIResult(code, execResult, isHistory = false) {
  const isSuccess = execResult?.success !== false;
  const rawMsg    = execResult?.message || (isSuccess ? '执行成功' : '执行出错');
  const lines     = rawMsg.split('\n');
  const headline  = lines[0];
  const sublines  = lines.slice(1).filter(Boolean);
  const statusCls = isSuccess ? 'success' : 'error';
  const statusIcon= isSuccess ? '✓' : '✕';
  const blockId   = `code-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;

  const subHtml = sublines.length
    ? `<div style="padding:0 12px 10px;font-size:11px;color:var(--text-2);line-height:1.6">${sublines.map(l => escapeHtml(l)).join('<br>')}</div>`
    : '';

  const historyTag = isHistory
    ? `<span class="history-tag">历史</span>`
    : '';

  const el = document.createElement('div');
  el.className = 'message msg-ai' + (isHistory ? ' is-history' : '');
  el.innerHTML = `
    <div class="msg-ai-header">
      <div class="ai-avatar">✦</div>
      <span>AI 助手</span>
      ${historyTag}
    </div>
    <div class="result-card ${statusCls}">
      <div class="result-header">
        <div class="result-status ${statusCls}">
          <div class="result-status-dot"></div>
          ${statusIcon} ${escapeHtml(headline)}
        </div>
      </div>
      ${subHtml}
      <div class="code-block" id="${blockId}">
        <div class="code-toggle" id="${blockId}-toggle">
          <span class="code-toggle-icon">▶</span>
          <span>查看生成的代码</span>
          <span style="color:var(--text-3);font-size:10px;margin-left:auto">${code.split('\n').length} 行</span>
        </div>
        <div class="code-content" id="${blockId}-content">
          <pre>${escapeHtml(code)}</pre>
        </div>
        <button class="copy-btn" id="${blockId}-copy">复制</button>
      </div>
    </div>`;
  chatArea.appendChild(el);

  const toggle  = document.getElementById(`${blockId}-toggle`);
  const content = document.getElementById(`${blockId}-content`);
  const copyBtn = document.getElementById(`${blockId}-copy`);

  toggle.addEventListener('click', () => {
    const open = content.classList.toggle('visible');
    toggle.classList.toggle('open', open);
  });

  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(code);
    copyBtn.textContent = '已复制!';
    setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
  });
}

// ── 渲染：错误 ────────────────────────────────────────────────
function renderError(errorMsg, isHistory = false) {
  const el = document.createElement('div');
  el.className = 'message msg-ai' + (isHistory ? ' is-history' : '');
  el.innerHTML = `
    <div class="msg-ai-header">
      <div class="ai-avatar">✦</div>
      <span>AI 助手</span>
      ${isHistory ? '<span class="history-tag">历史</span>' : ''}
    </div>
    <div class="result-card error">
      <div class="result-header">
        <div class="result-status error">
          <div class="result-status-dot"></div>
          ✕ 出错了
        </div>
      </div>
      <div style="padding:10px 12px;font-size:12px;color:var(--text-2);line-height:1.6">
        ${escapeHtml(errorMsg)}
      </div>
    </div>`;
  chatArea.appendChild(el);
}

// ── API Key 提示 ───────────────────────────────────────────────
function showApiKeyHint() {
  const el = document.createElement('div');
  el.style.cssText = `
    background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);
    border-radius:8px;padding:10px 12px;font-size:12px;color:#fbbf24;
    display:flex;align-items:center;gap:8px;cursor:pointer;animation:fadeIn 0.3s ease;`;
  el.innerHTML = `⚠ 请先 <u>配置 API Key</u> 才能使用`;
  el.addEventListener('click', openSettings);
  // 插到聊天区最顶部（历史 banner 之前）
  chatArea.insertBefore(el, chatArea.firstChild);
}

// ── 工具函数 ──────────────────────────────────────────────────
function setLoading(val) {
  isLoading = val;
  sendBtn.disabled = val;
  cmdInput.disabled = val;
  sendBtn.classList.toggle('loading', val);
  sendBtn.textContent = val ? '⟳' : '➤';
}

function scrollToBottom() {
  requestAnimationFrame(() => { chatArea.scrollTop = chatArea.scrollHeight; });
}

function autoResizeTextarea() {
  cmdInput.style.height = 'auto';
  cmdInput.style.height = Math.min(cmdInput.scrollHeight, 100) + 'px';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openSettings() { chrome.runtime.openOptionsPage(); }

function showToast(text, type = 'success') {
  const colors = { success: '#34d399', error: '#f87171', warning: '#fbbf24' };
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed;bottom:70px;left:50%;transform:translateX(-50%);
    background:var(--bg-card);border:1px solid ${colors[type]};
    color:${colors[type]};font-size:12px;padding:6px 14px;
    border-radius:20px;z-index:9999;animation:fadeIn 0.2s ease;
    box-shadow:0 4px 12px rgba(0,0,0,0.3);white-space:nowrap;`;
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['apiKey', 'apiBase', 'model'], r => resolve(r || {}));
  });
}

async function ensureContentScriptLoaded(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch (_) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

async function sendToContentScript(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); }
  catch (err) { console.warn('sendToContentScript error:', err); return null; }
}

// ── 启动 ──────────────────────────────────────────────────────
init();
