// ============================================================
//  AI DOM 操作助手 - Options 逻辑 (options.js)
// ============================================================

const apiKeyInput   = document.getElementById('api-key');
const apiBaseInput  = document.getElementById('api-base');
const modelInput    = document.getElementById('model-input');
const btnSave       = document.getElementById('btn-save');
const btnReset      = document.getElementById('btn-reset');
const btnTest       = document.getElementById('btn-test');
const togglePwBtn   = document.getElementById('toggle-pw');
const saveStatus    = document.getElementById('save-status');
const testStatus    = document.getElementById('test-status');
const modelList     = document.getElementById('model-list');

// ── 初始化：读取已保存设置 ────────────────────────────────────
async function init() {
  const settings = await loadSettings();
  apiKeyInput.value  = settings.apiKey  || '';
    apiBaseInput.value = settings.apiBase || 'https://router.shengsuanyun.com/api/v1';
  modelInput.value   = settings.model   || 'gpt-4o';

  // 高亮已选中模型
  updateModelBadges(modelInput.value);

  // 模型徽章点击
  modelList.querySelectorAll('.model-badge').forEach(badge => {
    badge.addEventListener('click', () => {
      modelInput.value = badge.dataset.model;
      updateModelBadges(badge.dataset.model);
    });
  });

  // 监听手动输入模型名
  modelInput.addEventListener('input', () => {
    updateModelBadges(modelInput.value.trim());
  });

  // 密码显示切换
  togglePwBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      apiKeyInput.style.letterSpacing = '';
      togglePwBtn.textContent = '🙈';
    } else {
      apiKeyInput.type = 'password';
      apiKeyInput.style.letterSpacing = '0.1em';
      togglePwBtn.textContent = '👁';
    }
  });

  // 保存
  btnSave.addEventListener('click', saveSettings);

  // 重置
  btnReset.addEventListener('click', () => {
    apiBaseInput.value = '';
    modelInput.value = 'gpt-4o';
    updateModelBadges('gpt-4o');
    showStatus(saveStatus, '已重置为默认值（API Key 保留）', 'success');
  });

  // 测试连接
  btnTest.addEventListener('click', testConnection);
}

function updateModelBadges(currentModel) {
  modelList.querySelectorAll('.model-badge').forEach(badge => {
    badge.classList.toggle('active', badge.dataset.model === currentModel);
  });
}

// ── 保存设置 ──────────────────────────────────────────────────
async function saveSettings() {
  const apiKey  = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim();
  const model   = modelInput.value.trim() || 'gpt-4o';

  if (!apiKey) {
    showStatus(saveStatus, '⚠ API Key 不能为空', 'error');
    apiKeyInput.focus();
    return;
  }

  btnSave.disabled = true;
  btnSave.textContent = '保存中...';

  await new Promise(resolve => {
    chrome.storage.local.set({ apiKey, apiBase, model }, resolve);
  });

  btnSave.disabled = false;
  btnSave.textContent = '💾 保存设置';
  showStatus(saveStatus, '✓ 设置已保存', 'success');
}

// ── 测试连接 ──────────────────────────────────────────────────
async function testConnection() {
  const apiKey  = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim() || 'https://router.shengsuanyun.com/api/v1';
  const model   = modelInput.value.trim() || 'gpt-4o';

  if (!apiKey) {
    showStatus(testStatus, '⚠ 请先填写 API Key', 'error');
    return;
  }

  btnTest.disabled = true;
  btnTest.textContent = '测试中...';
  testStatus.className = 'status-banner';
  testStatus.style.display = 'none';

  try {
    const resp = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
        max_tokens: 5,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
      throw new Error(err.error?.message || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || '(empty)';
    showStatus(testStatus, `✓ 连接成功！模型回复：${reply.trim()}`, 'success');
  } catch (err) {
    showStatus(testStatus, `✕ 连接失败：${err.message}`, 'error');
  } finally {
    btnTest.disabled = false;
    btnTest.textContent = '测试连接';
  }
}

// ── 工具函数 ──────────────────────────────────────────────────
function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['apiKey', 'apiBase', 'model'], result => resolve(result || {}));
  });
}

function showStatus(el, text, type) {
  el.textContent = text;
  el.className = `status-banner ${type}`;
  el.style.display = 'flex';
  if (type === 'success') {
    setTimeout(() => {
      el.style.display = 'none';
    }, 4000);
  }
}

// ── 启动 ──────────────────────────────────────────────────────
init();
