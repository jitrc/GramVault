// background.js — Multi-provider LLM service worker with context menu actions

// ============================================================
// PROVIDER DEFINITIONS
// ============================================================

const PROVIDERS = {
  ollama: {
    name: 'Ollama (Local)',
    local: true,
    defaultEndpoint: 'http://localhost:11434',
    needsApiKey: false,
    modelsEndpoint: '/api/tags',
    parseModels: (data) => (data.models || []).map(m => ({
      name: m.name, size: m.size, sizeHuman: formatBytes(m.size),
    })),
  },
  lmstudio: {
    name: 'LM Studio (Local)',
    local: true,
    defaultEndpoint: 'http://localhost:1234',
    needsApiKey: false,
    modelsEndpoint: '/v1/models',
    parseModels: (data) => (data.data || []).map(m => ({
      name: m.id, size: 0, sizeHuman: '',
    })),
  },
  openai: {
    name: 'OpenAI',
    local: false,
    defaultEndpoint: 'https://api.openai.com',
    needsApiKey: true,
    modelsEndpoint: '/v1/models',
    parseModels: (data) => (data.data || [])
      .filter(m => m.id.includes('gpt'))
      .map(m => ({ name: m.id, size: 0, sizeHuman: '' })),
    defaultModel: 'gpt-4o-mini',
  },
  anthropic: {
    name: 'Anthropic',
    local: false,
    defaultEndpoint: 'https://api.anthropic.com',
    needsApiKey: true,
    modelsEndpoint: null, // No list endpoint
    parseModels: null,
    staticModels: [
      { name: 'claude-sonnet-4-6', size: 0, sizeHuman: '' },
      { name: 'claude-haiku-4-5-20251001', size: 0, sizeHuman: '' },
      { name: 'claude-sonnet-4-5-20250514', size: 0, sizeHuman: '' },
      { name: 'claude-opus-4-6', size: 0, sizeHuman: '' },
    ],
    defaultModel: 'claude-haiku-4-5-20251001',
  },
  gemini: {
    name: 'Google Gemini',
    local: false,
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    needsApiKey: true,
    modelsEndpoint: null,
    parseModels: null,
    staticModels: [
      { name: 'gemini-2.0-flash', size: 0, sizeHuman: '' },
      { name: 'gemini-2.0-flash-lite', size: 0, sizeHuman: '' },
      { name: 'gemini-1.5-flash', size: 0, sizeHuman: '' },
      { name: 'gemini-1.5-pro', size: 0, sizeHuman: '' },
    ],
    defaultModel: 'gemini-2.0-flash-lite',
  },
  openrouter: {
    name: 'OpenRouter',
    local: false,
    defaultEndpoint: 'https://openrouter.ai',
    needsApiKey: true,
    modelsEndpoint: '/api/v1/models',
    parseModels: (data) => (data.data || []).slice(0, 50).map(m => ({
      name: m.id, size: 0, sizeHuman: m.pricing ? `$${m.pricing.prompt}/tok` : '',
    })),
    defaultModel: 'google/gemini-2.0-flash-exp:free',
  },
};

// Speed tiers from M5 benchmarks (for Ollama model sorting)
// Prioritize small/fast models (<= 8B) for grammar checking
const OLLAMA_PREFERRED = [
  'gemma3:1b',       // 162 tok/s — fastest
  'llama3.2:3b',     // 68 tok/s
  'qwen3:1.7b',      // 64 tok/s
  'phi4-mini',       // 53 tok/s, 3.8B
  'gemma3:4b',       // 49 tok/s
  'qwen3:8b',        // 28 tok/s
  'qwen3:30b-a3b',   // 42 tok/s, MoE
  'lfm2:24b',        // 82 tok/s, MoE — fast but large
  'gemma3:12b',      // 17 tok/s
  'qwen3:14b',       // 13 tok/s
];

// Track in-flight requests per tab
const inflightRequests = new Map();

// ============================================================
// RATE LIMITER (cloud providers only)
// ============================================================

const CLOUD_PROVIDERS = new Set(['openai', 'anthropic', 'gemini', 'openrouter']);
const rateLimitCalls = new Map(); // providerKey -> [timestamp, ...]
const RATE_LIMIT_MAX = 20; // calls per minute

function checkRateLimit(providerKey) {
  if (!CLOUD_PROVIDERS.has(providerKey)) return true;
  const now = Date.now();
  const prev = (rateLimitCalls.get(providerKey) || []).filter(t => now - t < 60000);
  if (prev.length >= RATE_LIMIT_MAX) return false;
  prev.push(now);
  rateLimitCalls.set(providerKey, prev);
  return true;
}

// ============================================================
// FETCH WITH TIMEOUT
// ============================================================

async function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// PROVIDER API CALLS
// ============================================================

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get([
      'provider', 'model', 'enabled', 'llmFrequency',
      'apiKeys', 'endpoints', 'providerModels',
    ], (data) => {
      resolve({
        provider: data.provider || 'ollama',
        model: data.model || '',
        enabled: data.enabled !== false,
        llmFrequency: data.llmFrequency || 'on-pause',
        apiKeys: data.apiKeys || {},
        endpoints: data.endpoints || {},
        providerModels: data.providerModels || {},
      });
    });
  });
}

function getEndpoint(settings, providerKey) {
  return settings.endpoints[providerKey] || PROVIDERS[providerKey].defaultEndpoint;
}

function getApiKey(settings, providerKey) {
  return settings.apiKeys[providerKey] || '';
}

function getModel(settings) {
  if (settings.model) return settings.model;
  const provDef = PROVIDERS[settings.provider];
  return provDef?.defaultModel || '';
}

// --- Ollama ---
async function callOllama(text, prompt, settings) {
  const endpoint = getEndpoint(settings, 'ollama');
  const model = getModel(settings);

  const response = await fetchWithTimeout(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.1, num_predict: 2048 },
    }),
  });
  if (!response.ok) throw new Error(`Ollama: ${response.status}`);
  const data = await response.json();
  return data.response;
}

// --- LM Studio (OpenAI-compatible) ---
async function callLMStudio(text, prompt, settings) {
  const endpoint = getEndpoint(settings, 'lmstudio');
  const model = getModel(settings);

  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are a helpful assistant. Always respond with valid JSON only. No markdown, no code fences.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 2048,
  };

  const response = await fetchWithTimeout(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`LM Studio: ${response.status} ${errBody.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

// --- OpenAI ---
async function callOpenAI(text, prompt, settings) {
  const endpoint = getEndpoint(settings, 'openai');
  const apiKey = getApiKey(settings, 'openai');
  if (!apiKey) throw new Error('OpenAI API key not set');

  const response = await fetchWithTimeout(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getModel(settings),
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

// --- Anthropic ---
async function callAnthropic(text, prompt, settings) {
  const endpoint = getEndpoint(settings, 'anthropic');
  const apiKey = getApiKey(settings, 'anthropic');
  if (!apiKey) throw new Error('Anthropic API key not set');

  const response = await fetchWithTimeout(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: getModel(settings),
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt + '\n\nRespond with valid JSON only.' }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic: ${response.status}`);
  const data = await response.json();
  return data.content[0].text;
}

// --- Gemini ---
async function callGemini(text, prompt, settings) {
  const endpoint = getEndpoint(settings, 'gemini');
  const apiKey = getApiKey(settings, 'gemini');
  if (!apiKey) throw new Error('Gemini API key not set');
  const model = getModel(settings);

  const response = await fetchWithTimeout(
    `${endpoint}/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt + '\n\nRespond with valid JSON only.' }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    }
  );
  if (!response.ok) throw new Error(`Gemini: ${response.status}`);
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// --- OpenRouter (OpenAI-compatible) ---
async function callOpenRouter(text, prompt, settings) {
  const endpoint = getEndpoint(settings, 'openrouter');
  const apiKey = getApiKey(settings, 'openrouter');
  if (!apiKey) throw new Error('OpenRouter API key not set');

  const response = await fetchWithTimeout(`${endpoint}/api/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getModel(settings),
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

// --- Unified call ---
async function callProvider(text, prompt, settings) {
  const provider = settings.provider;
  if (!checkRateLimit(provider)) {
    throw new Error(`Rate limit reached for ${PROVIDERS[provider]?.name || provider} (max ${RATE_LIMIT_MAX} calls/min). Try again shortly.`);
  }
  switch (provider) {
    case 'ollama': return callOllama(text, prompt, settings);
    case 'lmstudio': return callLMStudio(text, prompt, settings);
    case 'openai': return callOpenAI(text, prompt, settings);
    case 'anthropic': return callAnthropic(text, prompt, settings);
    case 'gemini': return callGemini(text, prompt, settings);
    case 'openrouter': return callOpenRouter(text, prompt, settings);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

// ============================================================
// PROMPTS
// ============================================================

const PROMPTS = {
  grammar: (text) => `You are a grammar checker. Analyze the following text and return a JSON object with an "errors" array. Each error must have: "original" (exact text), "start" (char index, 0-based), "end" (char index, exclusive), "message" (explanation), "suggestions" (array of corrections). If no errors: {"errors": []}. Only check grammar/spelling/punctuation.

Text:
"""
${text}
"""`,

  rewrite: (text) => `Rewrite the following text to be clearer and more concise while preserving the meaning. Return JSON: {"result": "rewritten text"}

Text:
"""
${text}
"""`,

  reformat: (text) => `Reformat the following text for better readability. Fix paragraphing, spacing, and structure. Return JSON: {"result": "reformatted text"}

Text:
"""
${text}
"""`,

  bulleted: (text) => `Convert the following text into a well-organized bulleted list. Return JSON: {"result": "- point 1\\n- point 2\\n..."}

Text:
"""
${text}
"""`,

  elaborate: (text) => `Elaborate on the following text, adding detail and depth while keeping the same tone. Return JSON: {"result": "elaborated text"}

Text:
"""
${text}
"""`,

  summarize: (text) => `Summarize the following text concisely, capturing the key points. Return JSON: {"result": "summary"}

Text:
"""
${text}
"""`,

  professional: (text) => `Rewrite the following text in a professional, formal tone suitable for business communication. Return JSON: {"result": "professional text"}

Text:
"""
${text}
"""`,

  toneCheck: (text) => `Analyze the tone of the following text. Return JSON: {"tone": "detected tone", "score": 1-10, "notes": "brief analysis", "suggestion": "optional rewrite if tone could be improved or empty string"}

Text:
"""
${text}
"""`,

  friendly: (text) => `Rewrite the following text in a warm, friendly, and approachable tone. Return JSON: {"result": "friendly text"}

Text:
"""
${text}
"""`,

  concise: (text) => `Make the following text as concise as possible without losing meaning. Remove filler words, redundancy, and unnecessary phrases. Return JSON: {"result": "concise text"}

Text:
"""
${text}
"""`,
};

// ============================================================
// GRAMMAR CHECK LOGIC
// ============================================================

function validateErrors(errors, text) {
  const validated = [];
  for (const err of errors) {
    if (!err.original || !err.message) continue;
    if (!Array.isArray(err.suggestions)) err.suggestions = [];

    let { start, end, original } = err;

    if (text.slice(start, end) === original) {
      err.source = 'llm';
      validated.push(err);
      continue;
    }

    const idx = text.indexOf(original);
    if (idx !== -1) {
      err.start = idx;
      err.end = idx + original.length;
      err.source = 'llm';
      validated.push(err);
      continue;
    }

    const lowerIdx = text.toLowerCase().indexOf(original.toLowerCase());
    if (lowerIdx !== -1) {
      err.start = lowerIdx;
      err.end = lowerIdx + original.length;
      err.original = text.slice(lowerIdx, lowerIdx + original.length);
      err.source = 'llm';
      validated.push(err);
      continue;
    }
  }
  return validated;
}

function parseJsonResponse(raw) {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

// ============================================================
// FETCH MODELS
// ============================================================

async function fetchModels(providerKey, settings) {
  const provDef = PROVIDERS[providerKey];
  if (!provDef) return { models: [], connected: false };

  // Static models (Anthropic, Gemini)
  if (provDef.staticModels) {
    if (provDef.needsApiKey && !getApiKey(settings, providerKey)) {
      return { models: provDef.staticModels, connected: false, needsKey: true };
    }
    return { models: provDef.staticModels, connected: true };
  }

  if (!provDef.modelsEndpoint) return { models: [], connected: false };

  try {
    const endpoint = getEndpoint(settings, providerKey);
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = getApiKey(settings, providerKey);
    if (provDef.needsApiKey && apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetchWithTimeout(`${endpoint}${provDef.modelsEndpoint}`, { headers }, 5000);
    if (!response.ok) return { models: [], connected: false };

    const data = await response.json();
    let models = provDef.parseModels(data);

    // Sort Ollama models by benchmark speed
    if (providerKey === 'ollama') {
      models.sort((a, b) => {
        const aIdx = OLLAMA_PREFERRED.findIndex(p => a.name.startsWith(p));
        const bIdx = OLLAMA_PREFERRED.findIndex(p => b.name.startsWith(p));
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return (a.size || 0) - (b.size || 0);
      });
    }

    return { models, connected: true };
  } catch (e) {
    return { models: [], connected: false };
  }
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return gb.toFixed(1) + ' GB';
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(0) + ' MB';
}

// ============================================================
// CONTEXT MENUS
// ============================================================

const MENU_ITEMS = [
  { id: 'gc-check', title: 'Check Grammar', action: 'grammar' },
  { id: 'gc-sep1', type: 'separator' },
  { id: 'gc-rewrite', title: 'Rewrite', action: 'rewrite' },
  { id: 'gc-professional', title: 'Make Professional', action: 'professional' },
  { id: 'gc-friendly', title: 'Make Friendly', action: 'friendly' },
  { id: 'gc-concise', title: 'Make Concise', action: 'concise' },
  { id: 'gc-sep2', type: 'separator' },
  { id: 'gc-elaborate', title: 'Elaborate', action: 'elaborate' },
  { id: 'gc-summarize', title: 'Summarize', action: 'summarize' },
  { id: 'gc-bulleted', title: 'Convert to Bullets', action: 'bulleted' },
  { id: 'gc-reformat', title: 'Reformat', action: 'reformat' },
  { id: 'gc-sep3', type: 'separator' },
  { id: 'gc-tonecheck', title: 'Tone Check', action: 'toneCheck' },
];

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    // Parent menu
    chrome.contextMenus.create({
      id: 'gc-parent',
      title: 'Grammar Checker',
      contexts: ['selection', 'editable'],
    });

    for (const item of MENU_ITEMS) {
      if (item.type === 'separator') {
        chrome.contextMenus.create({
          id: item.id,
          type: 'separator',
          parentId: 'gc-parent',
          contexts: ['selection', 'editable'],
        });
      } else {
        chrome.contextMenus.create({
          id: item.id,
          title: item.title,
          parentId: 'gc-parent',
          contexts: ['selection', 'editable'],
        });
      }
    }
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItem = MENU_ITEMS.find(m => m.id === info.menuItemId);
  if (!menuItem || !menuItem.action) return;

  const selectedText = info.selectionText;
  if (!selectedText || selectedText.trim().length === 0) return;

  // tab can be undefined in some contexts (e.g., devtools, PDF viewer)
  const tabId = tab?.id;
  if (!tabId) return;

  const settings = await getSettings();
  const action = menuItem.action;
  const prompt = PROMPTS[action](selectedText);

  // Notify content script: show loading
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'CONTEXT_ACTION_START', action });
  } catch (e) {
    // Content script may not be injected on this page
    console.warn('[GC] Could not reach content script:', e.message);
    return;
  }

  try {
    const raw = await callProvider(selectedText, prompt, settings);
    const parsed = parseJsonResponse(raw);

    if (action === 'grammar') {
      const errors = validateErrors(parsed.errors || [], selectedText);
      await chrome.tabs.sendMessage(tabId, {
        type: 'CONTEXT_ACTION_RESULT',
        action,
        errors,
        originalText: selectedText,
      });
    } else if (action === 'toneCheck') {
      await chrome.tabs.sendMessage(tabId, {
        type: 'CONTEXT_ACTION_RESULT',
        action,
        tone: parsed.tone || 'Unknown',
        score: parsed.score || 0,
        notes: parsed.notes || '',
        suggestion: parsed.suggestion || '',
        originalText: selectedText,
      });
    } else {
      await chrome.tabs.sendMessage(tabId, {
        type: 'CONTEXT_ACTION_RESULT',
        action,
        result: parsed.result || raw,
        originalText: selectedText,
      });
    }
  } catch (e) {
    console.error('[GC] Context action failed:', e);
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'CONTEXT_ACTION_ERROR',
        action,
        error: e.message,
      });
    } catch (_) {
      // Content script unreachable
    }
  }
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === 'CHECK_GRAMMAR') {
    if (tabId && inflightRequests.has(tabId)) {
      inflightRequests.get(tabId).abort = true;
    }
    const controller = { abort: false };
    if (tabId) inflightRequests.set(tabId, controller);

    (async () => {
      try {
        const settings = await getSettings();
        if (!settings.enabled) {
          sendResponse({ type: 'GRAMMAR_RESULT', errors: [] });
          return;
        }

        const prompt = PROMPTS.grammar(message.text);
        const raw = await callProvider(message.text, prompt, settings);
        if (controller.abort) return;

        const parsed = parseJsonResponse(raw);
        const errors = validateErrors(parsed.errors || [], message.text);
        sendResponse({ type: 'GRAMMAR_RESULT', errors });
      } catch (e) {
        console.error('[GC] Grammar check failed:', e);
        sendResponse({ type: 'GRAMMAR_RESULT', errors: [], error: e.message });
      } finally {
        if (tabId) inflightRequests.delete(tabId);
      }
    })();
    return true;
  }

  if (message.type === 'FETCH_MODELS') {
    (async () => {
      const settings = await getSettings();
      const providerKey = message.provider || settings.provider;
      const result = await fetchModels(providerKey, settings);
      sendResponse(result);
    })();
    return true;
  }

  if (message.type === 'PING_PROVIDER') {
    (async () => {
      const settings = await getSettings();
      const providerKey = message.provider || settings.provider;
      const provDef = PROVIDERS[providerKey];
      try {
        if (provDef.staticModels) {
          const hasKey = !provDef.needsApiKey || !!getApiKey(settings, providerKey);
          sendResponse({ connected: hasKey });
          return;
        }
        const endpoint = getEndpoint(settings, providerKey);
        const headers = {};
        const apiKey = getApiKey(settings, providerKey);
        if (provDef.needsApiKey && apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        const r = await fetchWithTimeout(`${endpoint}${provDef.modelsEndpoint || '/'}`, { headers }, 5000);
        sendResponse({ connected: r.ok });
      } catch {
        sendResponse({ connected: false });
      }
    })();
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_PROVIDERS') {
    const list = Object.entries(PROVIDERS).map(([key, def]) => ({
      key,
      name: def.name,
      local: def.local,
      needsApiKey: def.needsApiKey,
      defaultEndpoint: def.defaultEndpoint,
      defaultModel: def.defaultModel || '',
    }));
    sendResponse({ providers: list });
    return true;
  }

  if (message.type === 'RUN_ACTION') {
    (async () => {
      try {
        const settings = await getSettings();
        const prompt = PROMPTS[message.action](message.text);
        const raw = await callProvider(message.text, prompt, settings);
        const parsed = parseJsonResponse(raw);

        if (message.action === 'grammar') {
          const errors = validateErrors(parsed.errors || [], message.text);
          sendResponse({ errors });
        } else if (message.action === 'toneCheck') {
          sendResponse(parsed);
        } else {
          sendResponse({ result: parsed.result || raw });
        }
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});

// ============================================================
// INIT
// ============================================================

chrome.runtime.onInstalled.addListener(async () => {
  setupContextMenus();

  const settings = await getSettings();
  // Try to auto-detect a local model
  for (const localProvider of ['ollama', 'lmstudio']) {
    const { models, connected } = await fetchModels(localProvider, settings);
    if (connected && models.length > 0) {
      await chrome.storage.local.set({
        provider: localProvider,
        model: models[0].name,
        enabled: true,
        llmFrequency: 'on-pause',
      });
      console.log(`[GC] Auto-selected: ${localProvider} / ${models[0].name}`);
      return;
    }
  }

  await chrome.storage.local.set({ enabled: true, llmFrequency: 'on-pause', provider: 'ollama' });
  console.log('[GC] No local provider found, rule-based checking only');
});

// Re-create context menus on startup (service worker can restart)
chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
});

// ============================================================
// KEYBOARD SHORTCUT
// ============================================================

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-badge-panel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'OPEN_BADGE_PANEL' }).catch(() => {});
    }
  }
});
