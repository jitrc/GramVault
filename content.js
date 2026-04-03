// content.js — Text detection, overlay rendering, contenteditable support, suggestion popups

(() => {
  const RULES_DEBOUNCE_MS = 150;
  const LLM_PAUSE_MS = 2000;

  // Per-element state
  const elementState = new WeakMap();

  // Current popup reference
  let activePopup = null;
  let activePopupElement = null;

  // Settings (loaded from storage)
  let settings = { enabled: true, llmFrequency: 'on-pause' };

  // Custom dictionary (words to skip)
  let customDictionary = new Set();

  // ============================================================
  // DEBUG PANEL
  // ============================================================

  let debugPanel = null;
  let debugLog = [];
  const MAX_DEBUG_LINES = 50;

  function createDebugPanel() {
    if (debugPanel) return;
    debugPanel = document.createElement('div');
    debugPanel.id = 'gc-debug-panel';
    debugPanel.innerHTML = `
      <div id="gc-debug-header">
        <span>GC Debug</span>
        <div>
          <button id="gc-debug-copy" title="Copy log">⎘</button>
          <button id="gc-debug-clear" title="Clear">C</button>
          <button id="gc-debug-minimize" title="Minimize">_</button>
          <button id="gc-debug-close" title="Close">X</button>
        </div>
      </div>
      <div id="gc-debug-status"></div>
      <div id="gc-debug-log"></div>
    `;
    document.body.appendChild(debugPanel);

    // Make draggable
    let isDragging = false, offsetX, offsetY;
    const header = debugPanel.querySelector('#gc-debug-header');
    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - debugPanel.getBoundingClientRect().left;
      offsetY = e.clientY - debugPanel.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      debugPanel.style.left = (e.clientX - offsetX) + 'px';
      debugPanel.style.top = (e.clientY - offsetY) + 'px';
      debugPanel.style.right = 'auto';
      debugPanel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    debugPanel.querySelector('#gc-debug-close').addEventListener('click', () => {
      debugPanel.remove();
      debugPanel = null;
    });
    debugPanel.querySelector('#gc-debug-minimize').addEventListener('click', () => {
      const log = debugPanel.querySelector('#gc-debug-log');
      const status = debugPanel.querySelector('#gc-debug-status');
      const isHidden = log.style.display === 'none';
      log.style.display = isHidden ? '' : 'none';
      status.style.display = isHidden ? '' : 'none';
    });
    debugPanel.querySelector('#gc-debug-copy').addEventListener('click', () => {
      const text = debugLog.map(e => {
        const data = e.data ? ` | ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}` : '';
        return `[${e.time}] [${e.type.toUpperCase()}] ${e.msg}${data}`;
      }).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        const btn = debugPanel.querySelector('#gc-debug-copy');
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '⎘'; }, 1000);
      });
    });
    debugPanel.querySelector('#gc-debug-clear').addEventListener('click', () => {
      debugLog = [];
      renderDebugLog();
    });

    updateDebugStatus();
  }

  function debugMessage(type, msg, data) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = { time, type, msg, data };
    debugLog.push(entry);
    if (debugLog.length > MAX_DEBUG_LINES) debugLog.shift();

    console.log(`[GC:${type}] ${msg}`, data || '');
    if (debugPanel) renderDebugLog();
  }

  function renderDebugLog() {
    const logEl = debugPanel?.querySelector('#gc-debug-log');
    if (!logEl) return;

    logEl.innerHTML = debugLog.map(e => {
      const color = e.type === 'error' ? '#ef4444' :
                    e.type === 'warn' ? '#f59e0b' :
                    e.type === 'ok' ? '#22c55e' :
                    e.type === 'action' ? '#a78bfa' :
                    e.type === 'llm' ? '#3b82f6' : '#94a3b8';
      const dataStr = e.data ? `<div class="gc-debug-data">${escapeHtml(typeof e.data === 'string' ? e.data : JSON.stringify(e.data, null, 1)).slice(0, 500)}</div>` : '';
      return `<div class="gc-debug-entry"><span style="color:${color}">[${e.time}] [${e.type.toUpperCase()}]</span> ${escapeHtml(e.msg)}${dataStr}</div>`;
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function updateDebugStatus() {
    const statusEl = debugPanel?.querySelector('#gc-debug-status');
    if (!statusEl) return;

    chrome.storage.local.get(['provider', 'model', 'enabled', 'llmFrequency'], (data) => {
      statusEl.innerHTML = `
        <div><b>Enabled:</b> ${data.enabled !== false ? '<span style="color:#22c55e">YES</span>' : '<span style="color:#ef4444">NO</span>'}</div>
        <div><b>Provider:</b> ${data.provider || 'ollama'}</div>
        <div><b>Model:</b> ${data.model || 'none'}</div>
        <div><b>LLM Freq:</b> ${data.llmFrequency || 'on-pause'}</div>
      `;
    });
  }

  // Create panel based on setting (default: off)
  chrome.storage.local.get(['debugPanel'], (data) => {
    if (data.debugPanel === true) {
      createDebugPanel();
      debugMessage('info', 'Grammar Checker initializing...');
    }
  });

  // React to debug toggle changes in real-time
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.debugPanel) {
      if (changes.debugPanel.newValue === false) {
        if (debugPanel) { debugPanel.remove(); debugPanel = null; }
      } else {
        createDebugPanel();
        debugMessage('info', 'Debug panel enabled');
      }
    }
  });

  // Load settings
  chrome.storage.local.get(['enabled', 'llmFrequency', 'customDictionary'], (data) => {
    settings.enabled = data.enabled !== false;
    settings.llmFrequency = data.llmFrequency || 'on-pause';
    customDictionary = new Set(data.customDictionary || []);
    debugMessage('info', `Settings loaded: enabled=${settings.enabled}, freq=${settings.llmFrequency}, dict=${customDictionary.size} words`);
  });

  // Listen for settings changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.llmFrequency) settings.llmFrequency = changes.llmFrequency.newValue;
    if (changes.customDictionary) customDictionary = new Set(changes.customDictionary.newValue || []);
  });

  // --- UTILITY FUNCTIONS ---

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getState(el) {
    if (!elementState.has(el)) {
      elementState.set(el, {
        rulesTimer: null,
        llmTimer: null,
        ruleErrors: [],
        llmErrors: [],
        mergedErrors: [],
        overlay: null,
        resizeObserver: null,
        listening: false,
      });
    }
    return elementState.get(el);
  }

  function isCheckable(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      // Only check text-like inputs, not passwords/emails/search
      return ['text', 'search', ''].includes(type);
    }
    if (el.isContentEditable && el.tagName !== 'BODY') return true;
    // Support div[role="textbox"] used by modern editors
    if (el.getAttribute?.('role') === 'textbox') return true;
    return false;
  }

  function getText(el) {
    if (el.tagName === 'TEXTAREA') return el.value;
    if (el.tagName === 'INPUT') return el.value;
    if (el.isContentEditable || el.getAttribute?.('role') === 'textbox') return el.innerText;
    return '';
  }

  // --- MERGE ERRORS ---
  // LLM errors override rule errors for overlapping ranges

  function mergeErrors(ruleErrors, llmErrors) {
    if (llmErrors.length === 0) return [...ruleErrors];
    if (ruleErrors.length === 0) return [...llmErrors];

    const merged = [...llmErrors];

    for (const rErr of ruleErrors) {
      const overlaps = llmErrors.some(
        lErr => rErr.start < lErr.end && rErr.end > lErr.start
      );
      if (!overlaps) merged.push(rErr);
    }

    merged.sort((a, b) => a.start - b.start);
    return merged;
  }

  // --- TEXTAREA OVERLAY ---

  const COPY_STYLES = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'wordSpacing', 'lineHeight', 'textTransform', 'textIndent', 'textAlign',
    'whiteSpace', 'overflowWrap', 'wordWrap', 'wordBreak',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'boxSizing', 'direction',
  ];

  function createOverlay(textarea) {
    const overlay = document.createElement('div');
    overlay.className = 'gc-overlay';

    // Append to body and position absolutely over the textarea — no DOM wrapping
    document.body.appendChild(overlay);
    syncOverlayStyles(textarea, overlay);
    positionOverlay(textarea, overlay);

    // Sync scroll
    textarea.addEventListener('scroll', () => {
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    });

    // Reposition on resize, scroll, or layout changes
    const state = getState(textarea);
    state.resizeObserver = new ResizeObserver(() => {
      syncOverlayStyles(textarea, overlay);
      positionOverlay(textarea, overlay);
    });
    state.resizeObserver.observe(textarea);

    // Reposition on window scroll (textarea may move)
    const repositionHandler = () => positionOverlay(textarea, overlay);
    window.addEventListener('scroll', repositionHandler, true);
    state._repositionHandler = repositionHandler;

    debugMessage('ok', `Overlay created for <textarea> (${textarea.offsetWidth}x${textarea.offsetHeight})`);
    return overlay;
  }

  function syncOverlayStyles(textarea, overlay) {
    const cs = window.getComputedStyle(textarea);
    for (const prop of COPY_STYLES) {
      overlay.style[prop] = cs[prop];
    }
    overlay.style.width = textarea.offsetWidth + 'px';
    overlay.style.height = textarea.offsetHeight + 'px';
  }

  function positionOverlay(textarea, overlay) {
    const rect = textarea.getBoundingClientRect();
    overlay.style.position = 'fixed';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.overflow = 'hidden';
    overlay.style.pointerEvents = 'none';
    overlay.style.color = 'transparent';
    overlay.style.background = 'transparent';
    overlay.style.zIndex = '2147483646';
    overlay.style.margin = '0';
    overlay.style.border = 'none';
  }

  function renderTextareaOverlay(textarea, errors) {
    const state = getState(textarea);
    if (!state.overlay) {
      state.overlay = createOverlay(textarea);
    }

    const text = textarea.value;
    let html = '';
    let cursor = 0;

    for (const err of errors) {
      if (err.start < cursor) continue; // Skip overlapping
      html += escapeHtml(text.slice(cursor, err.start));
      const errClass = err.source === 'llm' ? 'gc-error gc-error-llm' : 'gc-error';
      html += `<span class="${errClass}" data-gc-idx="${errors.indexOf(err)}">${escapeHtml(text.slice(err.start, err.end))}</span>`;
      cursor = err.end;
    }
    html += escapeHtml(text.slice(cursor));

    state.overlay.innerHTML = html;
    state.overlay.scrollTop = textarea.scrollTop;
  }

  // --- CONTENTEDITABLE SUPPORT ---

  function getTextNodesWithOffsets(el) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: offset, end: offset + node.textContent.length });
      offset += node.textContent.length;
    }
    return nodes;
  }

  function clearEditableErrors(el) {
    const spans = el.querySelectorAll('.gc-error, .gc-error-llm');
    spans.forEach(span => {
      const parent = span.parentNode;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize(); // Merge adjacent text nodes
    });
  }

  function renderEditableErrors(el, errors) {
    if (errors.length === 0) {
      clearEditableErrors(el);
      return;
    }

    // Save selection
    const sel = window.getSelection();
    let savedRange = null;
    if (sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }

    // Clear previous error spans
    clearEditableErrors(el);

    // Get fresh text nodes after clearing
    const textNodes = getTextNodesWithOffsets(el);
    if (textNodes.length === 0) return;

    // Apply errors in reverse order to preserve offsets
    const sorted = [...errors].sort((a, b) => b.start - a.start);

    for (const err of sorted) {
      // Find the text node(s) that contain this error range
      const startNode = textNodes.find(n => err.start >= n.start && err.start < n.end);
      const endNode = textNodes.find(n => err.end > n.start && err.end <= n.end);

      if (!startNode || !endNode || startNode !== endNode) continue; // Skip multi-node errors for now

      const node = startNode.node;
      const localStart = err.start - startNode.start;
      const localEnd = err.end - startNode.start;

      try {
        const range = document.createRange();
        range.setStart(node, localStart);
        range.setEnd(node, localEnd);

        const span = document.createElement('span');
        span.className = err.source === 'llm' ? 'gc-error gc-error-llm' : 'gc-error';
        span.dataset.gcIdx = errors.indexOf(err).toString();
        range.surroundContents(span);
      } catch (e) {
        // surroundContents can fail if range crosses element boundaries
        continue;
      }
    }

    // Restore selection
    if (savedRange) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch (e) {
        // Selection restoration can fail if DOM changed significantly
      }
    }
  }

  // --- RENDER ERRORS ---

  function renderErrors(el) {
    const state = getState(el);
    const merged = mergeErrors(state.ruleErrors, state.llmErrors);
    // Filter out words in custom dictionary
    state.mergedErrors = merged.filter(err => !customDictionary.has(err.original.toLowerCase().trim()));

    debugMessage('info', `Render: ${state.mergedErrors.length} errors for <${el.tagName.toLowerCase()}> (rules: ${state.ruleErrors.length}, llm: ${state.llmErrors.length})`);

    // Render overlay for textarea
    if (el.tagName === 'TEXTAREA') {
      try {
        renderTextareaOverlay(el, state.mergedErrors);
      } catch (e) {
        debugMessage('error', `Overlay render failed: ${e.message}`);
      }
    }
    // Render inline spans for contenteditable
    if (el.isContentEditable || el.getAttribute?.('role') === 'textbox') {
      try {
        renderEditableErrors(el, state.mergedErrors);
      } catch (e) {
        debugMessage('error', `Editable render failed: ${e.message}`);
      }
    }

    // Always show/update the floating badge
    updateBadge(el, state.mergedErrors);
  }

  // ============================================================
  // FLOATING BADGE (Grammarly-style)
  // ============================================================

  const badgeMap = new WeakMap(); // el -> badge element
  let activeBadgePanel = null;

  function updateBadge(el, errors) {
    let badge = badgeMap.get(el);

    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'gc-badge-float';
      document.body.appendChild(badge);
      badgeMap.set(el, badge);

      const reposition = () => positionBadge(el, badge);
      window.addEventListener('scroll', reposition, true);
      const ro = new ResizeObserver(reposition);
      ro.observe(el);
      badge._cleanup = () => {
        window.removeEventListener('scroll', reposition, true);
        ro.disconnect();
      };
    }

    positionBadge(el, badge);

    if (errors.length === 0) {
      badge.className = 'gc-badge-float gc-badge-ok';
      badge.innerHTML = '<span class="gc-badge-icon">✓</span>';
      badge.title = 'No issues — click for actions';
      badge.onclick = (e) => {
        e.stopPropagation();
        toggleBadgePanel(el, errors, badge);
      };
      return;
    }

    const hasLlm = errors.some(e => e.source === 'llm');
    badge.className = `gc-badge-float ${hasLlm ? 'gc-badge-llm-active' : 'gc-badge-error'}`;
    badge.innerHTML = `<span class="gc-badge-count">${errors.length}</span>`;
    badge.title = `${errors.length} issue${errors.length > 1 ? 's' : ''} — click to fix`;

    badge.onclick = (e) => {
      e.stopPropagation();
      toggleBadgePanel(el, errors, badge);
    };
  }

  function positionBadge(el, badge) {
    const rect = el.getBoundingClientRect();
    badge.style.position = 'fixed';
    badge.style.top = (rect.bottom - 30) + 'px';
    badge.style.left = (rect.right - 36) + 'px';
    // Keep in viewport
    if (rect.right - 36 < rect.left) {
      badge.style.left = (rect.right - 36) + 'px';
    }
  }

  function toggleBadgePanel(el, errors, badge) {
    if (activeBadgePanel && activeBadgePanel._el === el) {
      dismissBadgePanel();
      return;
    }
    dismissBadgePanel();
    showBadgePanel(el, errors, badge);
  }

  function showBadgePanel(el, errors, badge) {
    const panel = document.createElement('div');
    panel.className = 'gc-badge-panel';
    panel._el = el;

    const text = getText(el);
    let html = '';

    // --- Header ---
    html += `<div class="gc-badge-panel-header">${errors.length > 0 ? `${errors.length} issue${errors.length > 1 ? 's' : ''}` : 'No issues'}</div>`;

    // --- Quick Actions toolbar ---
    html += `
      <div class="gc-badge-panel-toolbar">
        <button class="gc-action-btn" data-action="rewrite" title="Rewrite">Rewrite</button>
        <button class="gc-action-btn" data-action="professional" title="Professional tone">Professional</button>
        <button class="gc-action-btn" data-action="friendly" title="Friendly tone">Friendly</button>
        <button class="gc-action-btn" data-action="concise" title="Make concise">Concise</button>
        <button class="gc-action-btn" data-action="elaborate" title="Elaborate">Elaborate</button>
        <button class="gc-action-btn" data-action="summarize" title="Summarize">Summarize</button>
        <button class="gc-action-btn" data-action="bulleted" title="Bullets">Bullets</button>
        <button class="gc-action-btn gc-action-tone" data-action="toneCheck" title="Check tone">Tone</button>
      </div>
    `;

    // --- Tone result area (hidden until tone check runs) ---
    html += `<div class="gc-tone-area" id="gc-tone-area" style="display:none"></div>`;

    // --- Action result area (hidden until an action runs) ---
    html += `<div class="gc-action-result-area" id="gc-action-result" style="display:none"></div>`;

    // --- Error list ---
    html += '<div class="gc-badge-panel-list">';
    errors.forEach((err, i) => {
      const source = err.source === 'llm' ? 'AI' : 'Rules';
      const sourceClass = err.source === 'llm' ? 'gc-badge-src-llm' : 'gc-badge-src-rules';
      const suggestion = err.suggestions?.[0] || '';
      html += `
        <div class="gc-badge-panel-item" data-idx="${i}">
          <div class="gc-badge-panel-item-top">
            <span class="${sourceClass}">${source}</span>
            <span class="gc-badge-panel-original">${escapeHtml(err.original)}</span>
          </div>
          <div class="gc-badge-panel-msg">${escapeHtml(err.message)}</div>
          <div class="gc-badge-panel-actions">
            ${suggestion ? err.suggestions.map(s => `<button class="gc-badge-panel-fix" data-idx="${i}" data-fix="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('') : ''}
            <button class="gc-badge-panel-dismiss" data-idx="${i}">Ignore</button>
            <button class="gc-badge-panel-adddict" data-word="${escapeHtml(err.original.toLowerCase().trim())}">+ Dictionary</button>
          </div>
        </div>
      `;
    });

    // Fix all button
    const fixable = errors.filter(e => e.suggestions?.length > 0);
    if (fixable.length > 1) {
      html += `<div class="gc-badge-panel-fixall"><button class="gc-badge-panel-fixall-btn">Fix all ${fixable.length} issues</button></div>`;
    }

    html += '</div>';
    panel.innerHTML = html;

    // Position below badge
    const badgeRect = badge.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = (badgeRect.bottom + 4) + 'px';
    panel.style.right = (window.innerWidth - badgeRect.right) + 'px';
    document.body.appendChild(panel);
    activeBadgePanel = panel;

    // Keep in viewport
    requestAnimationFrame(() => {
      const pr = panel.getBoundingClientRect();
      if (pr.bottom > window.innerHeight - 8) {
        panel.style.top = (badgeRect.top - pr.height - 4) + 'px';
      }
    });

    // --- Wire up fix buttons ---
    panel.querySelectorAll('.gc-badge-panel-fix').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        applyFixToElement(el, errors[idx], btn.dataset.fix);
        dismissBadgePanel();
      });
    });

    // --- Wire up ignore buttons ---
    panel.querySelectorAll('.gc-badge-panel-dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        const err = errors[idx];
        const state = getState(el);
        state.ruleErrors = state.ruleErrors.filter(e => e !== err);
        state.llmErrors = state.llmErrors.filter(e => e !== err);
        renderErrors(el);
        dismissBadgePanel();
      });
    });

    // --- Wire up "Add to dictionary" buttons ---
    panel.querySelectorAll('.gc-badge-panel-adddict').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const word = btn.dataset.word;
        customDictionary.add(word);
        chrome.storage.local.get(['customDictionary'], (data) => {
          const dict = data.customDictionary || [];
          if (!dict.includes(word)) dict.push(word);
          chrome.storage.local.set({ customDictionary: dict });
        });
        const state = getState(el);
        state.ruleErrors = state.ruleErrors.filter(e => e.original.toLowerCase().trim() !== word);
        state.llmErrors = state.llmErrors.filter(e => e.original.toLowerCase().trim() !== word);
        renderErrors(el);
        dismissBadgePanel();
      });
    });

    // --- Wire up fix all ---
    const fixAllBtn = panel.querySelector('.gc-badge-panel-fixall-btn');
    if (fixAllBtn) {
      fixAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyAllFixes(el, errors);
        dismissBadgePanel();
      });
    }

    // --- Wire up quick action buttons ---
    panel.querySelectorAll('.gc-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        runQuickAction(el, text, action, panel);
      });
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', closeBadgePanelOnOutside, true);
    }, 0);
  }

  // --- Quick actions from badge panel ---

  function runQuickAction(el, text, action, panel) {
    if (!text || text.trim().length < 2) return;

    // Show loading in the result area
    const resultArea = panel.querySelector('#gc-action-result');
    const toneArea = panel.querySelector('#gc-tone-area');

    if (action === 'toneCheck') {
      toneArea.style.display = '';
      toneArea.innerHTML = '<div class="gc-action-loading"><div class="gc-loading-spinner"></div> Checking tone...</div>';
    } else {
      resultArea.style.display = '';
      resultArea.innerHTML = '<div class="gc-action-loading"><div class="gc-loading-spinner"></div> Processing...</div>';
    }

    // Disable all action buttons while loading
    panel.querySelectorAll('.gc-action-btn').forEach(b => b.disabled = true);

    debugMessage('action', `Quick action: ${action} on ${text.length} chars`);

    chrome.runtime.sendMessage({ type: 'RUN_ACTION', action, text }, (response) => {
      // Re-enable buttons
      panel.querySelectorAll('.gc-action-btn').forEach(b => b.disabled = false);

      if (chrome.runtime.lastError) {
        debugMessage('error', `Action failed: ${chrome.runtime.lastError.message}`);
        resultArea.innerHTML = `<div class="gc-action-error">Error: ${escapeHtml(chrome.runtime.lastError.message)}</div>`;
        return;
      }

      if (response?.error) {
        debugMessage('error', `Action error: ${response.error}`);
        if (action === 'toneCheck') {
          toneArea.innerHTML = `<div class="gc-action-error">Error: ${escapeHtml(response.error)}</div>`;
        } else {
          resultArea.innerHTML = `<div class="gc-action-error">Error: ${escapeHtml(response.error)}</div>`;
        }
        return;
      }

      if (action === 'toneCheck') {
        const tone = response.tone || 'Unknown';
        const score = response.score || 0;
        const notes = response.notes || '';
        const suggestion = response.suggestion || '';

        let toneHtml = `
          <div class="gc-tone-compact">
            <span class="gc-tone-badge">${escapeHtml(tone)}</span>
            <span class="gc-tone-score-bar">
              <span class="gc-tone-score-fill" style="width:${score * 10}%"></span>
            </span>
            <span class="gc-tone-score-num">${score}/10</span>
          </div>
        `;
        if (notes) toneHtml += `<div class="gc-tone-compact-notes">${escapeHtml(notes)}</div>`;
        if (suggestion) {
          toneHtml += `
            <div class="gc-action-result-row">
              <div class="gc-action-result-text">${escapeHtml(suggestion)}</div>
              <div class="gc-action-result-btns">
                <button class="gc-action-apply" data-text="${escapeHtml(suggestion)}">Apply</button>
                <button class="gc-action-copy" data-text="${escapeHtml(suggestion)}">Copy</button>
              </div>
            </div>
          `;
        }
        toneArea.innerHTML = toneHtml;
        wireResultButtons(panel, el);
        debugMessage('ok', `Tone: ${tone} (${score}/10)`);
      } else {
        const result = response.result || '';
        resultArea.innerHTML = `
          <div class="gc-action-result-label">${escapeHtml(action)}</div>
          <div class="gc-action-result-row">
            <div class="gc-action-result-text">${escapeHtml(result)}</div>
            <div class="gc-action-result-btns">
              <button class="gc-action-apply" data-text="${escapeHtml(result)}">Replace</button>
              <button class="gc-action-copy" data-text="${escapeHtml(result)}">Copy</button>
            </div>
          </div>
        `;
        wireResultButtons(panel, el);
        debugMessage('ok', `Action ${action}: ${result.length} chars returned`);
      }
    });
  }

  function wireResultButtons(panel, el) {
    panel.querySelectorAll('.gc-action-apply').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newText = btn.dataset.text;
        // Replace all text in the element
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          el.focus();
          el.select();
          if (!document.execCommand('insertText', false, newText)) {
            el.value = newText;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (el.isContentEditable) {
          el.focus();
          document.execCommand('selectAll');
          if (!document.execCommand('insertText', false, newText)) {
            el.innerText = newText;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        dismissBadgePanel();
        debugMessage('ok', 'Action result applied');
      });
    });

    panel.querySelectorAll('.gc-action-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(btn.dataset.text).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
      });
    });
  }

  function closeBadgePanelOnOutside(e) {
    if (activeBadgePanel && !activeBadgePanel.contains(e.target)) {
      dismissBadgePanel();
    }
  }

  function dismissBadgePanel() {
    document.removeEventListener('click', closeBadgePanelOnOutside, true);
    if (activeBadgePanel) {
      activeBadgePanel.remove();
      activeBadgePanel = null;
    }
  }

  function applyFixToElement(el, err, fix) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const text = el.value;
      if (text.slice(err.start, err.end) === err.original) {
        el.focus();
        el.selectionStart = err.start;
        el.selectionEnd = err.end;
        if (!document.execCommand('insertText', false, fix)) {
          el.value = text.slice(0, err.start) + fix + text.slice(err.end);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        debugMessage('ok', `Fixed: "${err.original}" → "${fix}"`);
      }
    } else if (el.isContentEditable) {
      // Find and replace in contenteditable
      const textNodes = getTextNodesWithOffsets(el);
      const startNode = textNodes.find(n => err.start >= n.start && err.start < n.end);
      if (startNode) {
        const localStart = err.start - startNode.start;
        const localEnd = err.end - startNode.start;
        const range = document.createRange();
        range.setStart(startNode.node, localStart);
        range.setEnd(startNode.node, localEnd);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        if (!document.execCommand('insertText', false, fix)) {
          range.deleteContents();
          range.insertNode(document.createTextNode(fix));
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        debugMessage('ok', `Fixed: "${err.original}" → "${fix}"`);
      }
    }
  }

  function applyAllFixes(el, errors) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      let text = el.value;
      // Apply fixes in reverse order to preserve offsets
      const fixable = errors.filter(e => e.suggestions?.length > 0).sort((a, b) => b.start - a.start);
      for (const err of fixable) {
        if (text.slice(err.start, err.end) === err.original) {
          text = text.slice(0, err.start) + err.suggestions[0] + text.slice(err.end);
        }
      }
      el.focus();
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      debugMessage('ok', `Fixed all ${fixable.length} issues`);
    } else if (el.isContentEditable) {
      // Apply one by one in reverse
      const fixable = errors.filter(e => e.suggestions?.length > 0).sort((a, b) => b.start - a.start);
      for (const err of fixable) {
        applyFixToElement(el, err, err.suggestions[0]);
      }
    }
  }

  // --- SUGGESTION POPUP ---

  function showPopup(el, error, rect) {
    dismissPopup();

    const popup = document.createElement('div');
    popup.className = 'gc-popup';

    const badge = error.source === 'llm' ? '<span class="gc-badge gc-badge-llm">AI</span>' : '<span class="gc-badge gc-badge-rules">Rules</span>';

    let suggestionsHtml = '';
    if (error.suggestions && error.suggestions.length > 0) {
      suggestionsHtml = '<div class="gc-popup-suggestions">' +
        error.suggestions.map((s, i) =>
          `<button class="gc-popup-suggestion" data-suggestion="${escapeHtml(s)}" data-idx="${i}">${escapeHtml(s)}</button>`
        ).join('') +
        '</div>';
    }

    popup.innerHTML = `
      <div class="gc-popup-header">${badge}</div>
      <div class="gc-popup-message">${escapeHtml(error.message)}</div>
      ${suggestionsHtml}
      <button class="gc-popup-dismiss">Dismiss</button>
    `;

    // Position near the error
    popup.style.position = 'fixed';
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.left = rect.left + 'px';

    document.body.appendChild(popup);
    activePopup = popup;
    activePopupElement = el;

    // Ensure popup is within viewport
    requestAnimationFrame(() => {
      const popupRect = popup.getBoundingClientRect();
      if (popupRect.right > window.innerWidth) {
        popup.style.left = (window.innerWidth - popupRect.width - 8) + 'px';
      }
      if (popupRect.bottom > window.innerHeight) {
        popup.style.top = (rect.top - popupRect.height - 4) + 'px';
      }
    });

    // Handle suggestion clicks
    popup.querySelectorAll('.gc-popup-suggestion').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const suggestion = btn.dataset.suggestion;
        applySuggestion(el, error, suggestion);
        dismissPopup();
      });
    });

    // Handle dismiss
    popup.querySelector('.gc-popup-dismiss').addEventListener('click', (e) => {
      e.stopPropagation();
      dismissPopup();
    });
  }

  function dismissPopup() {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
      activePopupElement = null;
    }
  }

  function applySuggestion(el, error, suggestion) {
    if (el.tagName === 'TEXTAREA') {
      const before = el.value.slice(0, error.start);
      const after = el.value.slice(error.end);
      el.value = before + suggestion + after;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) {
      // For contenteditable, find the error span and replace
      const span = el.querySelector(`[data-gc-idx="${error._idx}"]`);
      if (span) {
        span.textContent = suggestion;
        span.className = ''; // Remove error styling
        // Unwrap the span
        const parent = span.parentNode;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parent.normalize();
      }
      // Trigger re-check
      handleInput(el);
    }
  }

  // --- CLICK HANDLING FOR POPUPS ---

  function handleTextareaClick(e) {
    const textarea = e.target;
    if (textarea.tagName !== 'TEXTAREA') return;
    const state = getState(textarea);
    if (!state.mergedErrors || state.mergedErrors.length === 0) return;

    const cursorPos = textarea.selectionStart;
    const error = state.mergedErrors.find(
      err => cursorPos >= err.start && cursorPos <= err.end
    );

    if (error) {
      // Get approximate position using a mirror technique
      const rect = getCaretRect(textarea, error.start);
      error._idx = state.mergedErrors.indexOf(error);
      showPopup(textarea, error, rect);
    } else {
      dismissPopup();
    }
  }

  function handleEditableClick(e) {
    const span = e.target.closest('.gc-error, .gc-error-llm');
    if (!span) {
      dismissPopup();
      return;
    }

    const el = span.closest('[contenteditable="true"]');
    if (!el) return;

    const state = getState(el);
    const idx = parseInt(span.dataset.gcIdx, 10);
    const error = state.mergedErrors[idx];
    if (!error) return;

    const rect = span.getBoundingClientRect();
    error._idx = idx;
    showPopup(el, error, rect);
  }

  // Get approximate caret rectangle in a textarea
  function getCaretRect(textarea, position) {
    const mirror = document.createElement('div');
    const cs = window.getComputedStyle(textarea);

    for (const prop of COPY_STYLES) {
      mirror.style[prop] = cs[prop];
    }
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflow = 'hidden';
    mirror.style.width = textarea.offsetWidth + 'px';
    mirror.style.height = 'auto';

    const textBefore = textarea.value.slice(0, position);
    mirror.textContent = textBefore;

    const marker = document.createElement('span');
    marker.textContent = '|';
    mirror.appendChild(marker);

    document.body.appendChild(mirror);
    const markerRect = marker.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();

    const result = {
      top: textareaRect.top + (markerRect.top - mirror.getBoundingClientRect().top) - textarea.scrollTop,
      bottom: textareaRect.top + (markerRect.bottom - mirror.getBoundingClientRect().top) - textarea.scrollTop,
      left: textareaRect.left + (markerRect.left - mirror.getBoundingClientRect().left) - textarea.scrollLeft,
      right: textareaRect.left + (markerRect.right - mirror.getBoundingClientRect().left) - textarea.scrollLeft,
    };

    document.body.removeChild(mirror);
    return result;
  }

  // --- INPUT HANDLING ---

  function handleInput(el) {
    if (!settings.enabled) {
      debugMessage('warn', 'Skipping — extension disabled');
      return;
    }
    if (!isCheckable(el)) return;

    const state = getState(el);
    const text = getText(el);

    if (!text || text.trim().length < 2) {
      state.ruleErrors = [];
      state.llmErrors = [];
      renderErrors(el);
      return;
    }

    debugMessage('info', `Input detected: ${text.length} chars in <${el.tagName.toLowerCase()}>`);

    // Tier 1: Rule-based check (fast, 150ms debounce)
    clearTimeout(state.rulesTimer);
    state.rulesTimer = setTimeout(() => {
      const t0 = performance.now();
      const result = GrammarRules.check(text);
      const ms = (performance.now() - t0).toFixed(1);
      state.ruleErrors = result.errors;
      debugMessage('ok', `Rules: ${result.errors.length} errors in ${ms}ms`, result.errors.length > 0 ? result.errors.map(e => `"${e.original}" → ${e.suggestions.join('/')}`).join(', ') : null);
      renderErrors(el);
    }, RULES_DEBOUNCE_MS);

    // Tier 2: LLM check (configurable frequency)
    clearTimeout(state.llmTimer);

    if (settings.llmFrequency === 'on-pause') {
      debugMessage('info', `LLM check queued (${LLM_PAUSE_MS}ms pause)`);
      state.llmTimer = setTimeout(() => {
        requestLLMCheck(el, text);
      }, LLM_PAUSE_MS);
    } else if (settings.llmFrequency === 'on-sentence') {
      if (/[.!?]\s*$/.test(text)) {
        debugMessage('info', 'Sentence end detected — triggering LLM');
        state.llmTimer = setTimeout(() => {
          requestLLMCheck(el, text);
        }, 300);
      }
    } else {
      debugMessage('info', `LLM mode: ${settings.llmFrequency} (no auto-check)`);
    }
  }

  function requestLLMCheck(el, text) {
    if (settings.llmFrequency === 'disabled') {
      debugMessage('warn', 'LLM disabled — skipping');
      return;
    }

    debugMessage('llm', `Sending to LLM (${text.length} chars)...`);
    const t0 = performance.now();

    chrome.runtime.sendMessage(
      { type: 'CHECK_GRAMMAR', text: text },
      (response) => {
        const ms = (performance.now() - t0).toFixed(0);
        if (chrome.runtime.lastError) {
          debugMessage('error', `LLM failed (${ms}ms): ${chrome.runtime.lastError.message}`);
          return;
        }
        if (response && response.error) {
          debugMessage('error', `LLM error (${ms}ms): ${response.error}`);
          return;
        }
        if (response && response.errors) {
          const state = getState(el);
          state.llmErrors = response.errors;
          debugMessage('ok', `LLM: ${response.errors.length} errors in ${ms}ms`, response.errors.length > 0 ? response.errors.map(e => `"${e.original}" → ${e.suggestions.join('/')}`).join(', ') : null);
          renderErrors(el);
        } else {
          debugMessage('warn', `LLM: unexpected response (${ms}ms)`, JSON.stringify(response).slice(0, 200));
        }
      }
    );
  }

  // --- EVENT LISTENERS ---

  // Input detection (capture phase to catch all inputs)
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (isCheckable(el)) {
      handleInput(el);
    } else if (el.isContentEditable || el.closest?.('[contenteditable="true"]')) {
      const editable = el.isContentEditable ? el : el.closest('[contenteditable="true"]');
      if (isCheckable(editable)) handleInput(editable);
    } else if (el.closest?.('[role="textbox"]')) {
      const textbox = el.closest('[role="textbox"]');
      if (isCheckable(textbox)) handleInput(textbox);
    }
  }, true);

  // Click handling for suggestion popups
  document.addEventListener('click', (e) => {
    if (activePopup && activePopup.contains(e.target)) return;

    if (e.target.tagName === 'TEXTAREA') {
      handleTextareaClick(e);
    } else if (e.target.closest?.('.gc-error, .gc-error-llm')) {
      handleEditableClick(e);
    } else {
      dismissPopup();
    }
  }, true);

  // Dismiss popup on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dismissPopup();
      dismissContextPopup();
    }
  });

  // ============================================================
  // CONTEXT MENU ACTION HANDLING
  // ============================================================

  let contextPopup = null;
  let loadingIndicator = null;

  let loadingTimeout = null;

  function showLoading() {
    dismissLoading();
    loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'gc-loading';
    loadingIndicator.innerHTML = `
      <div class="gc-loading-spinner"></div>
      <span>Processing...</span>
      <button class="gc-loading-cancel" title="Cancel">✕</button>
    `;
    document.body.appendChild(loadingIndicator);

    loadingIndicator.querySelector('.gc-loading-cancel').addEventListener('click', () => {
      debugMessage('warn', 'Action cancelled by user');
      dismissLoading();
    });

    // Auto-timeout after 30s
    loadingTimeout = setTimeout(() => {
      debugMessage('error', 'Action timed out (30s)');
      dismissLoading();
      showErrorPopup('Request timed out. Check your provider connection.');
    }, 30000);
  }

  function dismissLoading() {
    if (loadingTimeout) { clearTimeout(loadingTimeout); loadingTimeout = null; }
    if (loadingIndicator) {
      loadingIndicator.remove();
      loadingIndicator = null;
    }
  }

  function dismissContextPopup() {
    if (contextPopup) {
      contextPopup.remove();
      contextPopup = null;
    }
  }

  // Track last focused editable + selection so we can restore after context menu
  let lastEditableEl = null;
  let lastSelectionStart = 0;
  let lastSelectionEnd = 0;
  let lastSelectionText = '';
  let lastRange = null;

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    const active = document.activeElement;

    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      lastEditableEl = active;
      lastSelectionStart = active.selectionStart;
      lastSelectionEnd = active.selectionEnd;
      lastSelectionText = active.value.slice(active.selectionStart, active.selectionEnd);
      lastRange = null;
    } else if (sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      let node = range.commonAncestorContainer;
      while (node && node !== document.body) {
        if (node.isContentEditable) {
          lastEditableEl = node;
          lastRange = range.cloneRange();
          lastSelectionText = sel.toString();
          break;
        }
        node = node.parentElement;
      }
    }
  });

  function replaceSelectedText(newText) {
    debugMessage('action', `Replace: "${lastSelectionText?.slice(0, 30)}..." → "${newText.slice(0, 30)}..."`);

    if (!lastEditableEl) {
      debugMessage('error', 'Replace failed: no editable element tracked');
      return;
    }

    const el = lastEditableEl;

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // Use the saved selection positions
      const start = lastSelectionStart;
      const end = lastSelectionEnd;

      // If selection text matches what we saved, do direct replace
      if (el.value.slice(start, end) === lastSelectionText) {
        el.focus();
        el.selectionStart = start;
        el.selectionEnd = end;
        // Use execCommand for undo support, fall back to direct assignment
        if (!document.execCommand('insertText', false, newText)) {
          el.value = el.value.slice(0, start) + newText + el.value.slice(end);
        }
        el.selectionStart = start;
        el.selectionEnd = start + newText.length;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        debugMessage('ok', `Text replaced in <${el.tagName.toLowerCase()}>`);
      } else {
        // Selection shifted — try to find the original text
        const idx = el.value.indexOf(lastSelectionText);
        if (idx !== -1) {
          el.focus();
          el.selectionStart = idx;
          el.selectionEnd = idx + lastSelectionText.length;
          if (!document.execCommand('insertText', false, newText)) {
            el.value = el.value.slice(0, idx) + newText + el.value.slice(idx + lastSelectionText.length);
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          debugMessage('ok', 'Text replaced (fuzzy match)');
        } else {
          debugMessage('error', 'Replace failed: original text not found');
        }
      }
    } else if (el.isContentEditable && lastRange) {
      el.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(lastRange);

      // Use execCommand for undo support
      if (!document.execCommand('insertText', false, newText)) {
        lastRange.deleteContents();
        const lines = newText.split('\n');
        const frag = document.createDocumentFragment();
        lines.forEach((line, i) => {
          frag.appendChild(document.createTextNode(line));
          if (i < lines.length - 1) frag.appendChild(document.createElement('br'));
        });
        lastRange.insertNode(frag);
      }
      sel.collapseToEnd();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      debugMessage('ok', 'Text replaced in contenteditable');
    } else {
      debugMessage('error', 'Replace failed: no range for contenteditable');
    }
  }

  function showContextResultPopup(content, options = {}) {
    dismissContextPopup();

    const sel = window.getSelection();
    let rect;
    if (sel.rangeCount > 0 && !sel.isCollapsed) {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } else {
      // Fallback to center of viewport
      rect = { bottom: window.innerHeight / 2, left: window.innerWidth / 2 - 150, top: window.innerHeight / 2 - 100 };
    }

    contextPopup = document.createElement('div');
    contextPopup.className = 'gc-context-popup';

    let html = '';

    if (options.action === 'toneCheck') {
      // Tone check result card
      html = `
        <div class="gc-context-header">
          <span class="gc-badge gc-badge-llm">Tone Check</span>
        </div>
        <div class="gc-tone-result">
          <div class="gc-tone-label">Detected Tone</div>
          <div class="gc-tone-value">${escapeHtml(content.tone)}</div>
          <div class="gc-tone-score">Score: <strong>${content.score}/10</strong></div>
          ${content.notes ? `<div class="gc-tone-notes">${escapeHtml(content.notes)}</div>` : ''}
        </div>
        ${content.suggestion ? `
          <div class="gc-context-section">
            <div class="gc-context-label">Suggested rewrite:</div>
            <div class="gc-context-preview">${escapeHtml(content.suggestion)}</div>
            <button class="gc-popup-suggestion gc-context-apply" data-text="${escapeHtml(content.suggestion)}">Apply</button>
          </div>
        ` : ''}
        <button class="gc-popup-dismiss gc-context-close">Close</button>
      `;
    } else {
      // Text transformation result
      const actionLabels = {
        rewrite: 'Rewrite', reformat: 'Reformat', bulleted: 'Bulleted',
        elaborate: 'Elaborate', summarize: 'Summary', professional: 'Professional',
        friendly: 'Friendly', concise: 'Concise', grammar: 'Grammar Fix',
      };
      const label = actionLabels[options.action] || 'Result';

      // For grammar, show corrections info above the corrected text
      const infoHtml = options.info
        ? `<div class="gc-context-info">${escapeHtml(options.info)}</div>`
        : '';
      const countBadge = options.errorCount
        ? ` <span style="opacity:0.7">(${options.errorCount} fixes)</span>`
        : '';

      html = `
        <div class="gc-context-header">
          <span class="gc-badge gc-badge-llm">${escapeHtml(label)}${countBadge}</span>
        </div>
        ${infoHtml}
        <div class="gc-context-label">Corrected:</div>
        <div class="gc-context-preview">${escapeHtml(content)}</div>
        <div class="gc-context-actions">
          <button class="gc-popup-suggestion gc-context-apply" data-text="${escapeHtml(content)}">Replace</button>
          <button class="gc-context-copy" data-text="${escapeHtml(content)}">Copy</button>
          <button class="gc-popup-dismiss gc-context-close">Dismiss</button>
        </div>
      `;
    }

    contextPopup.innerHTML = html;

    // Position
    contextPopup.style.position = 'fixed';
    contextPopup.style.top = (rect.bottom + 8) + 'px';
    contextPopup.style.left = Math.max(8, rect.left) + 'px';
    document.body.appendChild(contextPopup);

    // Keep in viewport
    requestAnimationFrame(() => {
      const pr = contextPopup.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) {
        contextPopup.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
      }
      if (pr.bottom > window.innerHeight - 8) {
        contextPopup.style.top = Math.max(8, rect.top - pr.height - 8) + 'px';
      }
    });

    // Event handlers
    contextPopup.querySelectorAll('.gc-context-apply').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        replaceSelectedText(btn.dataset.text);
        dismissContextPopup();
      });
    });

    contextPopup.querySelectorAll('.gc-context-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(btn.dataset.text).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
      });
    });

    contextPopup.querySelectorAll('.gc-context-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissContextPopup();
      });
    });
  }

  function showErrorPopup(errorMsg) {
    dismissContextPopup();
    contextPopup = document.createElement('div');
    contextPopup.className = 'gc-context-popup gc-context-error';
    contextPopup.innerHTML = `
      <div class="gc-context-header"><span class="gc-badge gc-badge-rules">Error</span></div>
      <div class="gc-popup-message">${escapeHtml(errorMsg)}</div>
      <button class="gc-popup-dismiss gc-context-close">Close</button>
    `;
    contextPopup.style.position = 'fixed';
    contextPopup.style.top = '20px';
    contextPopup.style.right = '20px';
    document.body.appendChild(contextPopup);

    contextPopup.querySelector('.gc-context-close').addEventListener('click', () => dismissContextPopup());
    setTimeout(() => dismissContextPopup(), 5000);
  }

  // Listen for messages from background (context menu actions + keyboard shortcut)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Keyboard shortcut: open badge panel for focused element
    if (message.type === 'OPEN_BADGE_PANEL') {
      const focused = document.activeElement;
      if (focused && isCheckable(focused)) {
        const state = getState(focused);
        const badge = badgeMap.get(focused);
        if (badge) toggleBadgePanel(focused, state.mergedErrors || [], badge);
      }
      sendResponse({ received: true });
      return false;
    }

    // Only handle our messages
    if (!message.type || !message.type.startsWith('CONTEXT_ACTION')) return false;

    debugMessage('action', `Received: ${message.type}`, message.action || '');

    if (message.type === 'CONTEXT_ACTION_START') {
      showLoading();
      debugMessage('action', `Action started: ${message.action}`);
    } else if (message.type === 'CONTEXT_ACTION_RESULT') {
      dismissLoading();

      if (message.action === 'grammar') {
        if (message.errors.length === 0) {
          showContextResultPopup('No grammar errors found!', { action: 'grammar' });
        } else {
          // Build auto-corrected text by applying first suggestion for each error
          let corrected = message.originalText;
          const sorted = [...message.errors].sort((a, b) => b.start - a.start); // reverse order
          for (const err of sorted) {
            if (err.suggestions && err.suggestions.length > 0) {
              corrected = corrected.slice(0, err.start) + err.suggestions[0] + corrected.slice(err.end);
            }
          }

          const summary = message.errors.map(e =>
            `\u2022 "${e.original}" \u2192 ${e.suggestions.join(' / ')} (${e.message})`
          ).join('\n');

          // Show corrected text as replaceable, summary as info
          showContextResultPopup(corrected, {
            action: 'grammar',
            info: summary,
            errorCount: message.errors.length,
          });
        }
      } else if (message.action === 'toneCheck') {
        showContextResultPopup({
          tone: message.tone,
          score: message.score,
          notes: message.notes,
          suggestion: message.suggestion,
        }, { action: 'toneCheck' });
      } else {
        showContextResultPopup(message.result, { action: message.action });
      }
    } else if (message.type === 'CONTEXT_ACTION_ERROR') {
      dismissLoading();
      debugMessage('error', `Action error: ${message.error}`);
      showErrorPopup(message.error);
    }

    updateDebugStatus();
    sendResponse({ received: true });
    return false; // Synchronous response
  });

  // Cleanup resources for a removed element
  function cleanupElement(el) {
    const state = elementState.get(el);
    if (state) {
      if (state.resizeObserver) state.resizeObserver.disconnect();
      if (state._repositionHandler) window.removeEventListener('scroll', state._repositionHandler, true);
      if (state.overlay) state.overlay.remove();
    }
    const badge = badgeMap.get(el);
    if (badge) {
      if (badge._cleanup) badge._cleanup();
      badge.remove();
    }
  }

  // MutationObserver for dynamically added/removed elements
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Clean up removed elements
      for (const node of mutation.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (isCheckable(node)) cleanupElement(node);
        if (node.querySelectorAll) {
          node.querySelectorAll('textarea, input, [contenteditable="true"], [role="textbox"]').forEach(el => {
            if (isCheckable(el)) cleanupElement(el);
          });
        }
      }
      // Set up new elements
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // Check the node itself and its descendants
        const checkables = [];
        if (isCheckable(node)) checkables.push(node);
        if (node.querySelectorAll) {
          node.querySelectorAll('textarea, input, [contenteditable="true"], [role="textbox"]').forEach(el => {
            if (isCheckable(el)) checkables.push(el);
          });
        }
        // Set up focus listener for new elements
        for (const el of checkables) {
          const state = getState(el);
          if (!state.listening) {
            state.listening = true;
            el.addEventListener('focus', () => {
              const text = getText(el);
              if (text && text.trim().length >= 2) {
                handleInput(el);
              }
            }, { once: true });
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also handle already-existing textareas
  document.querySelectorAll('textarea, input, [contenteditable="true"], [role="textbox"]').forEach(el => {
    if (isCheckable(el)) {
      const state = getState(el);
      if (!state.listening) {
        state.listening = true;
        el.addEventListener('focus', () => {
          const text = getText(el);
          if (text && text.trim().length >= 2) {
            handleInput(el);
          }
        }, { once: true });
      }
    }
  });

  console.log('[GC] Local Grammar Checker loaded');
})();
