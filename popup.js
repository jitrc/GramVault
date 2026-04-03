// popup.js — Settings UI with multi-provider support

const statusDot = document.getElementById('statusDot');
const enableToggle = document.getElementById('enableToggle');
const debugToggle = document.getElementById('debugToggle');
const providerSelect = document.getElementById('providerSelect');
const apiKeySection = document.getElementById('apiKeySection');
const apiKeyInput = document.getElementById('apiKeyInput');
const apiKeyToggle = document.getElementById('apiKeyToggle');
const endpointSection = document.getElementById('endpointSection');
const endpointInput = document.getElementById('endpointInput');
const modelSelect = document.getElementById('modelSelect');
const refreshModels = document.getElementById('refreshModels');
const modelHint = document.getElementById('modelHint');
const frequencyRadios = document.querySelectorAll('input[name="frequency"]');
const cloudWarningSection = document.getElementById('cloudWarningSection');
const languageSelect = document.getElementById('languageSelect');

// State
let providers = [];
let currentSettings = {};

// Speed tiers from M5 benchmarks (for Ollama model hints)
function getModelTag(modelName) {
  // Tag small models as recommended
  const small = ['gemma3:1b', 'llama3.2:3b', 'qwen3:1.7b', 'phi4-mini', 'gemma3:4b', 'qwen3:8b'];
  for (const s of small) {
    if (modelName.startsWith(s)) return 'recommended';
  }
  return '';
}

// ============================================================
// INIT
// ============================================================

async function init() {
  // Load providers list
  const provResp = await sendMessage({ type: 'GET_PROVIDERS' });
  providers = provResp.providers;

  // Populate provider dropdown — local first
  providerSelect.innerHTML = '';
  const localProviders = providers.filter(p => p.local);
  const cloudProviders = providers.filter(p => !p.local);

  if (localProviders.length > 0) {
    const group = document.createElement('optgroup');
    group.label = 'Local (Private)';
    localProviders.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = p.name;
      group.appendChild(opt);
    });
    providerSelect.appendChild(group);
  }

  if (cloudProviders.length > 0) {
    const group = document.createElement('optgroup');
    group.label = 'Cloud';
    cloudProviders.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = p.name;
      group.appendChild(opt);
    });
    providerSelect.appendChild(group);
  }

  // Load current settings
  currentSettings = await sendMessage({ type: 'GET_SETTINGS' });

  enableToggle.checked = currentSettings.enabled;
  chrome.storage.local.get(['debugPanel'], (data) => {
    debugToggle.checked = data.debugPanel === true;
  });
  providerSelect.value = currentSettings.provider || 'ollama';
  frequencyRadios.forEach(r => { r.checked = r.value === currentSettings.llmFrequency; });

  // Language selector
  languageSelect.value = currentSettings.language || 'auto';

  // Update UI for selected provider
  updateProviderUI();
  loadModels();
  checkConnection();

  // Dictionary
  loadDictionary();

  // Stats
  loadStats();
}

function getProviderDef(key) {
  return providers.find(p => p.key === key);
}

function updateProviderUI() {
  const provKey = providerSelect.value;
  const provDef = getProviderDef(provKey);
  if (!provDef) return;

  // Show cloud privacy warning
  cloudWarningSection.style.display = provDef.needsApiKey ? '' : 'none';

  // Show/hide API key field
  if (provDef.needsApiKey) {
    apiKeySection.style.display = '';
    const savedKey = (currentSettings.apiKeys || {})[provKey] || '';
    apiKeyInput.value = savedKey;
    apiKeyInput.placeholder = provKey === 'openai' ? 'sk-...' :
      provKey === 'anthropic' ? 'sk-ant-...' :
      provKey === 'gemini' ? 'AIza...' : 'API key';
  } else {
    apiKeySection.style.display = 'none';
  }

  // Endpoint
  const savedEndpoint = (currentSettings.endpoints || {})[provKey] || '';
  endpointInput.value = savedEndpoint;
  endpointInput.placeholder = provDef.defaultEndpoint;
}

// ============================================================
// MODELS
// ============================================================

async function loadModels() {
  const provKey = providerSelect.value;
  modelSelect.innerHTML = '<option value="">Loading...</option>';
  modelHint.textContent = '';

  const result = await sendMessage({ type: 'FETCH_MODELS', provider: provKey });

  if (!result.connected && result.needsKey) {
    modelSelect.innerHTML = '<option value="">Enter API key first</option>';
    statusDot.className = 'status-dot disconnected';
    statusDot.title = 'API key required';
    return;
  }

  if (!result.connected) {
    const provDef = getProviderDef(provKey);
    modelSelect.innerHTML = '<option value="">Not connected</option>';
    statusDot.className = 'status-dot disconnected';
    statusDot.title = `Cannot reach ${provDef?.name || provKey}`;

    if (provKey === 'ollama') {
      modelHint.innerHTML = 'Run: <code>ollama serve</code>';
    } else if (provKey === 'lmstudio') {
      modelHint.textContent = 'Start LM Studio and enable the local server';
    }
    return;
  }

  statusDot.className = 'status-dot connected';
  statusDot.title = 'Connected';

  if (result.models.length === 0) {
    modelSelect.innerHTML = '<option value="">No models found</option>';
    if (provKey === 'ollama') {
      modelHint.innerHTML = 'Install: <code>ollama pull gemma3:1b</code>';
    }
    return;
  }

  modelSelect.innerHTML = '';
  const currentModel = (currentSettings.providerModels || {})[provKey] || currentSettings.model || '';

  for (const model of result.models) {
    const opt = document.createElement('option');
    opt.value = model.name;
    let label = model.name;
    if (model.sizeHuman) label += ` (${model.sizeHuman})`;
    const tag = getModelTag(model.name);
    if (tag) label += ` ★`;
    opt.textContent = label;
    if (model.name === currentModel) opt.selected = true;
    modelSelect.appendChild(opt);
  }

  // If no model was selected, auto-pick first
  if (!modelSelect.value && result.models.length > 0) {
    modelSelect.value = result.models[0].name;
    saveModelChoice();
  }

  modelHint.textContent = provKey === 'ollama' ? 'Sorted by speed (fastest first)' : '';
}

async function checkConnection() {
  const provKey = providerSelect.value;
  const result = await sendMessage({ type: 'PING_PROVIDER', provider: provKey });
  statusDot.className = result.connected ? 'status-dot connected' : 'status-dot disconnected';
  statusDot.title = result.connected ? 'Connected' : 'Not connected';
}

// ============================================================
// SAVE SETTINGS
// ============================================================

function saveModelChoice() {
  const provKey = providerSelect.value;
  const model = modelSelect.value;
  if (!model) return;

  // Save per-provider model choice
  const providerModels = currentSettings.providerModels || {};
  providerModels[provKey] = model;
  currentSettings.providerModels = providerModels;
  currentSettings.model = model;

  chrome.storage.local.set({ model, providerModels });
}

function saveApiKey() {
  const provKey = providerSelect.value;
  const key = apiKeyInput.value.trim();
  const apiKeys = currentSettings.apiKeys || {};
  apiKeys[provKey] = key;
  currentSettings.apiKeys = apiKeys;
  chrome.storage.local.set({ apiKeys });
}

function saveEndpoint() {
  const provKey = providerSelect.value;
  const endpoint = endpointInput.value.trim();
  const endpoints = currentSettings.endpoints || {};
  endpoints[provKey] = endpoint;
  currentSettings.endpoints = endpoints;
  chrome.storage.local.set({ endpoints });
}

// ============================================================
// EVENT LISTENERS
// ============================================================

enableToggle.addEventListener('change', () => {
  currentSettings.enabled = enableToggle.checked;
  chrome.storage.local.set({ enabled: enableToggle.checked });
});

debugToggle.addEventListener('change', () => {
  chrome.storage.local.set({ debugPanel: debugToggle.checked });
});

providerSelect.addEventListener('change', () => {
  const provKey = providerSelect.value;
  currentSettings.provider = provKey;

  // Restore per-provider model
  const savedModel = (currentSettings.providerModels || {})[provKey];
  if (savedModel) currentSettings.model = savedModel;

  chrome.storage.local.set({ provider: provKey, model: savedModel || '' });
  updateProviderUI();
  loadModels();
  checkConnection();
});

modelSelect.addEventListener('change', saveModelChoice);

apiKeyInput.addEventListener('change', () => {
  saveApiKey();
  // Reload models after API key change
  setTimeout(() => { loadModels(); checkConnection(); }, 200);
});

apiKeyToggle.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

endpointInput.addEventListener('change', () => {
  saveEndpoint();
  setTimeout(() => { loadModels(); checkConnection(); }, 200);
});

refreshModels.addEventListener('click', () => {
  loadModels();
  checkConnection();
});

frequencyRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    currentSettings.llmFrequency = radio.value;
    chrome.storage.local.set({ llmFrequency: radio.value });
  });
});

languageSelect.addEventListener('change', () => {
  chrome.storage.local.set({ language: languageSelect.value });
});

// ============================================================
// DICTIONARY
// ============================================================

function loadDictionary() {
  chrome.storage.local.get(['customDictionary'], (data) => {
    const words = data.customDictionary || [];
    renderDictionary(words);
  });
}

function renderDictionary(words) {
  const listEl = document.getElementById('dictWordList');
  const countEl = document.getElementById('dictCount');

  listEl.innerHTML = '';
  words.forEach(word => {
    const div = document.createElement('div');
    div.className = 'dict-word';
    div.innerHTML = `<span>${word}</span><button class="dict-remove" data-word="${word}">✕</button>`;
    listEl.appendChild(div);
  });

  countEl.textContent = words.length > 0 ? `(${words.length} word${words.length === 1 ? '' : 's'})` : '';

  listEl.querySelectorAll('.dict-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const wordToRemove = btn.dataset.word;
      chrome.storage.local.get(['customDictionary'], (data) => {
        const updated = (data.customDictionary || []).filter(w => w !== wordToRemove);
        chrome.storage.local.set({ customDictionary: updated }, () => renderDictionary(updated));
      });
    });
  });
}

function addDictionaryWord() {
  const input = document.getElementById('dictInput');
  const word = input.value.trim().toLowerCase();
  if (!word) return;
  chrome.storage.local.get(['customDictionary'], (data) => {
    const words = data.customDictionary || [];
    if (!words.includes(word)) {
      const updated = [...words, word];
      chrome.storage.local.set({ customDictionary: updated }, () => renderDictionary(updated));
    }
    input.value = '';
  });
}

document.getElementById('dictAddBtn').addEventListener('click', addDictionaryWord);
document.getElementById('dictInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addDictionaryWord();
});

document.getElementById('dictToggle').addEventListener('click', () => {
  const section = document.getElementById('dictSection');
  const arrow = document.querySelector('#dictToggle .collapse-arrow');
  section.classList.toggle('hidden');
  arrow.textContent = section.classList.contains('hidden') ? '▸' : '▾';
});

// ============================================================
// STATS
// ============================================================

function loadStats() {
  chrome.storage.local.get(['writingStats'], (data) => {
    const stats = data.writingStats || {};
    const today = new Date().toISOString().slice(0, 10);
    const isToday = stats.date === today;

    const checksRun   = isToday ? (stats.checksRun   || 0) : 0;
    const errorsFound = isToday ? (stats.errorsFound  || 0) : 0;
    const errorsFixed = isToday ? (stats.errorsFixed  || 0) : 0;

    const statsSection = document.getElementById('statsSection');
    if (checksRun === 0 && errorsFound === 0 && errorsFixed === 0) {
      statsSection.style.display = 'none';
      return;
    }

    statsSection.style.display = '';
    document.getElementById('statsContent').innerHTML =
      `<div class="stat-item"><span class="stat-num">${checksRun}</span><span class="stat-label">checks</span></div>` +
      `<div class="stat-item"><span class="stat-num">${errorsFound}</span><span class="stat-label">errors found</span></div>` +
      `<div class="stat-item"><span class="stat-num">${errorsFixed}</span><span class="stat-label">fixed</span></div>`;
  });
}

// ============================================================
// HELPERS
// ============================================================

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      resolve(response || {});
    });
  });
}

// Start
init();
