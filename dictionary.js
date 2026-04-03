// dictionary.js — Custom Dictionary management page

let allWords = [];      // { word, addedAt }
let sortMode = 'recent'; // 'alpha' | 'recent'
let searchQuery = '';

// ── Load ──────────────────────────────────────────────────────

function load() {
  chrome.storage.local.get(['customDictionary', 'customDictionaryMeta'], (data) => {
    const words = data.customDictionary || [];
    const meta  = data.customDictionaryMeta || {};

    allWords = words.map(w => ({
      word: w,
      addedAt: meta[w] || 0,
    }));

    render();
  });
}

// ── Save ──────────────────────────────────────────────────────

function save() {
  const words = allWords.map(w => w.word);
  const meta  = {};
  allWords.forEach(w => { meta[w.word] = w.addedAt; });
  chrome.storage.local.set({ customDictionary: words, customDictionaryMeta: meta });
}

// ── Add ───────────────────────────────────────────────────────

function addWord(raw) {
  const word = raw.trim().toLowerCase();
  if (!word) return;
  if (allWords.some(w => w.word === word)) {
    toast('Already in dictionary');
    return;
  }
  allWords.push({ word, addedAt: Date.now() });
  save();
  render();
  toast(`Added "${word}"`);
}

// ── Remove ────────────────────────────────────────────────────

function removeWord(word) {
  allWords = allWords.filter(w => w.word !== word);
  save();
  render();
}

// ── Render ────────────────────────────────────────────────────

function render() {
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentCount = allWords.filter(w => w.addedAt > oneWeekAgo).length;

  document.getElementById('totalCount').textContent = allWords.length;
  document.getElementById('recentCount').textContent = recentCount;

  // Filter
  let filtered = allWords;
  if (searchQuery) {
    filtered = filtered.filter(w => w.word.includes(searchQuery));
  }

  // Sort
  if (sortMode === 'alpha') {
    filtered = [...filtered].sort((a, b) => a.word.localeCompare(b.word));
  } else {
    filtered = [...filtered].sort((a, b) => b.addedAt - a.addedAt);
  }

  document.getElementById('shownCount').textContent = filtered.length;
  document.getElementById('listCountLabel').textContent =
    filtered.length === allWords.length
      ? `${allWords.length} word${allWords.length !== 1 ? 's' : ''}`
      : `${filtered.length} of ${allWords.length} words`;

  const grid = document.getElementById('wordGrid');

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">📖</div>
        <div class="empty-state-title">${allWords.length === 0 ? 'No words yet' : 'No matches'}</div>
        <div class="empty-state-sub">${allWords.length === 0
          ? 'Add technical terms, names, and acronyms that GramVault should ignore.'
          : 'Try a different search term.'}</div>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(({ word }) => `
    <div class="word-chip">
      <span title="${escHtml(word)}">${escHtml(word)}</span>
      <button class="word-remove" data-word="${escHtml(word)}" title="Remove">✕</button>
    </div>
  `).join('');

  grid.querySelectorAll('.word-remove').forEach(btn => {
    btn.addEventListener('click', () => removeWord(btn.dataset.word));
  });
}

// ── Toast ─────────────────────────────────────────────────────

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ── Helpers ───────────────────────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Event wiring ──────────────────────────────────────────────

document.getElementById('addBtn').addEventListener('click', () => {
  const input = document.getElementById('newWordInput');
  addWord(input.value);
  input.value = '';
  input.focus();
});

document.getElementById('newWordInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addWord(e.target.value);
    e.target.value = '';
  }
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  render();
});

document.getElementById('sortAlpha').addEventListener('click', () => {
  sortMode = 'alpha';
  document.getElementById('sortAlpha').style.background = '#ede9fe';
  document.getElementById('sortAlpha').style.borderColor = '#a5b4fc';
  document.getElementById('sortRecent').style.background = '';
  document.getElementById('sortRecent').style.borderColor = '';
  render();
});

document.getElementById('sortRecent').addEventListener('click', () => {
  sortMode = 'recent';
  document.getElementById('sortRecent').style.background = '#ede9fe';
  document.getElementById('sortRecent').style.borderColor = '#a5b4fc';
  document.getElementById('sortAlpha').style.background = '';
  document.getElementById('sortAlpha').style.borderColor = '';
  render();
});

document.getElementById('clearAll').addEventListener('click', () => {
  if (allWords.length === 0) return;
  if (!confirm(`Remove all ${allWords.length} words from the dictionary?`)) return;
  allWords = [];
  save();
  render();
  toast('Dictionary cleared');
});

document.getElementById('importBtn').addEventListener('click', () => {
  const text = document.getElementById('importArea').value;
  const words = text.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean);
  if (words.length === 0) return;
  let added = 0;
  words.forEach(w => {
    if (!allWords.some(x => x.word === w)) {
      allWords.push({ word: w, addedAt: Date.now() });
      added++;
    }
  });
  save();
  render();
  document.getElementById('importArea').value = '';
  toast(`Imported ${added} word${added !== 1 ? 's' : ''} (${words.length - added} already existed)`);
});

document.getElementById('exportBtn').addEventListener('click', () => {
  if (allWords.length === 0) { toast('Nothing to export'); return; }
  const text = allWords.map(w => w.word).sort().join('\n');
  navigator.clipboard.writeText(text).then(() => {
    toast(`Copied ${allWords.length} words to clipboard`);
  });
});

// ── Init ──────────────────────────────────────────────────────

// Set Recent as active by default
document.getElementById('sortRecent').style.background = '#ede9fe';
document.getElementById('sortRecent').style.borderColor = '#a5b4fc';

load();
