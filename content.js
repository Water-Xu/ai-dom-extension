// ============================================================
//  AI DOM 操作助手 - Content Script (content.js)
//  负责：元素选择模式、DOM 快照、撤销功能
//  运行在：每个网页的页面上下文中
// ============================================================

(function () {
  'use strict';

  // 防止重复注入
  if (window.__aiDomExtensionLoaded) return;
  window.__aiDomExtensionLoaded = true;

  // ── 状态 ────────────────────────────────────────────────────
  let selectionMode = false;
  let hoveredEl = null;
  let overlayEl = null;
  let tooltipEl = null;

  // ── 消息监听 ─────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'PING':
        sendResponse({ alive: true });
        break;

      case 'ENTER_SELECT_MODE':
        enterSelectMode();
        sendResponse({ ok: true });
        break;

      case 'EXIT_SELECT_MODE':
        exitSelectMode();
        sendResponse({ ok: true });
        break;

      case 'UNDO':
        const undone = doUndo();
        sendResponse({ success: undone, message: undone ? '已撤销上一步操作' : '没有可撤销的操作' });
        break;

      case 'GET_PAGE_INFO':
        sendResponse({
          url: location.href,
          title: document.title,
          readyState: document.readyState,
        });
        break;
    }
  });

  // ── 元素选择模式 ─────────────────────────────────────────────
  function enterSelectMode() {
    if (selectionMode) return;
    selectionMode = true;

    // 创建半透明遮罩提示
    createOverlay();

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onElementClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.body.style.cursor = 'crosshair';
  }

  function exitSelectMode() {
    if (!selectionMode) return;
    selectionMode = false;

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onElementClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.body.style.cursor = '';

    clearHighlight();
    removeOverlay();
  }

  function onMouseMove(e) {
    const el = e.target;
    if (el === overlayEl || el === tooltipEl || overlayEl?.contains(el)) return;

    if (hoveredEl !== el) {
      clearHighlight();
      hoveredEl = el;
      highlightElement(el);
    }
  }

  function onElementClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const el = e.target;
    if (el === overlayEl || el === tooltipEl || overlayEl?.contains(el)) return;

    const selectedHTML = el.outerHTML;
    const info = {
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
      className: el.className || null,
      textPreview: (el.textContent || '').trim().substring(0, 80),
      childCount: el.children.length,
      html: selectedHTML.length > 5000
        ? selectedHTML.substring(0, 5000) + '<!-- 已截断 -->'
        : selectedHTML,
    };

    exitSelectMode();

    // 通知 popup 已选择元素
    chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', info });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      exitSelectMode();
      chrome.runtime.sendMessage({ type: 'SELECT_CANCELLED' });
    }
  }

  // ── 高亮相关 ─────────────────────────────────────────────────
  function highlightElement(el) {
    if (!el || el === document.body || el === document.documentElement) return;
    el.dataset.__aiHighlight = 'true';
    el.style.setProperty('outline', '2px solid #6366f1', 'important');
    el.style.setProperty('outline-offset', '2px', 'important');
    el.style.setProperty('background-color', 'rgba(99, 102, 241, 0.08)', 'important');
    updateTooltip(el);
  }

  function clearHighlight() {
    if (!hoveredEl) return;
    if (hoveredEl.dataset.__aiHighlight) {
      hoveredEl.style.removeProperty('outline');
      hoveredEl.style.removeProperty('outline-offset');
      hoveredEl.style.removeProperty('background-color');
      delete hoveredEl.dataset.__aiHighlight;
    }
    hoveredEl = null;
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function updateTooltip(el) {
    if (!tooltipEl) return;
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const idStr = el.id ? `#${el.id}` : '';
    const cls = el.className ? `.${String(el.className).split(' ').filter(Boolean)[0]}` : '';
    tooltipEl.textContent = `<${tag}${idStr}${cls}>`;
    tooltipEl.style.display = 'block';
    tooltipEl.style.top = `${Math.max(0, rect.top + window.scrollY - 28)}px`;
    tooltipEl.style.left = `${Math.max(0, rect.left + window.scrollX)}px`;
  }

  function createOverlay() {
    // 顶部提示条
    overlayEl = document.createElement('div');
    overlayEl.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white; font-family: -apple-system, sans-serif;
      font-size: 13px; font-weight: 500;
      padding: 8px 16px; text-align: center;
      box-shadow: 0 2px 12px rgba(99,102,241,0.4);
      animation: __aiSlideDown 0.3s ease;
      pointer-events: none;
    `;
    overlayEl.textContent = '🎯 点击选择要操作的页面区域 · 按 Esc 取消';

    // 样式注入
    if (!document.getElementById('__ai-dom-styles')) {
      const style = document.createElement('style');
      style.id = '__ai-dom-styles';
      style.textContent = `
        @keyframes __aiSlideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    // 元素信息 tooltip
    tooltipEl = document.createElement('div');
    tooltipEl.style.cssText = `
      position: absolute; z-index: 2147483646;
      background: #1e1b4b; color: #a5b4fc;
      font-family: monospace; font-size: 11px;
      padding: 3px 8px; border-radius: 4px;
      pointer-events: none; display: none;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(overlayEl);
    document.body.appendChild(tooltipEl);
  }

  function removeOverlay() {
    overlayEl?.remove();
    tooltipEl?.remove();
    overlayEl = null;
    tooltipEl = null;
  }

  // ── 撤销功能 ─────────────────────────────────────────────────
  // 快照存在 DOM 属性中，隔离 World 和主 World 都能读写同一份 DOM 属性
  function doUndo() {
    try {
      const raw = document.documentElement.dataset.aiUndoStack;
      if (!raw) return false;
      const snapshots = JSON.parse(raw);
      if (!snapshots.length) return false;
      const prev = snapshots.pop();
      document.documentElement.dataset.aiUndoStack = JSON.stringify(snapshots);
      if (document.body && prev) {
        document.body.innerHTML = prev;
        return true;
      }
    } catch (_) {}
    return false;
  }

  // ── 初始化完成 ───────────────────────────────────────────────
  chrome.runtime.sendMessage({ type: 'CONTENT_READY', url: location.href }).catch(() => {});
})();
