# Local Grammar Checker

Chrome extension for real-time grammar checking powered by local or cloud LLMs. Works like Grammarly but your text stays private.

## Features

- **Two-tier checking**: Instant rule-based checks (150ms) + LLM deep analysis (configurable)
- **Floating badge**: Grammarly-style error count badge on every text field — click to fix
- **Quick actions**: Rewrite, Professional, Friendly, Concise, Elaborate, Summarize, Bullets, Tone Check — all from the badge panel
- **Right-click menu**: Select text and use Grammar Checker context menu for any action
- **Fix all**: One-click to apply all grammar fixes at once
- **Tone check**: Detects tone with score bar and rewrite suggestions
- **Multi-provider**: Ollama, LM Studio, OpenAI, Anthropic, Gemini, OpenRouter
- **Local first**: Prioritizes local providers, small models sorted by speed
- **Debug panel**: Floating log panel for troubleshooting (toggle in settings)

## Setup

### 1. Install the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder

### 2. Set up a local LLM (recommended)

**Ollama:**
```bash
# Install from https://ollama.com
ollama pull gemma3:1b    # Fast, good for grammar
ollama serve

# Allow Chrome extension access
launchctl setenv OLLAMA_ORIGINS '*'
# Then restart Ollama
```

**LM Studio:**
1. Download from https://lmstudio.ai
2. Load any model
3. Enable the local server (localhost:1234)

### 3. Configure

Click the extension icon to open settings:
- **Provider**: Choose Ollama, LM Studio, or a cloud provider
- **Model**: Auto-detected from your provider, small models recommended
- **LLM Frequency**: How often the LLM runs (on pause, on sentence end, manual, or disabled)
- **API Key**: Required for cloud providers only

## Usage

### Automatic checking
Type in any text field — rule-based errors appear instantly (red outline), LLM errors follow based on your frequency setting.

### Badge panel
Click the floating badge (bottom-right of text fields) to:
- See all errors with one-click fix buttons
- Run quick actions (Rewrite, Professional, Tone, etc.)
- Fix all issues at once

### Right-click menu
Select text, right-click > **Grammar Checker** for:
- Check Grammar (with auto-correct)
- Rewrite / Make Professional / Make Friendly / Make Concise
- Elaborate / Summarize / Convert to Bullets / Reformat
- Tone Check

## Recommended models (by speed on Apple Silicon)

| Model | Size | Notes |
|---|---|---|
| gemma3:1b | 1B | Fastest, good for basic grammar |
| llama3.2:3b | 3B | Solid balance |
| qwen3:1.7b | 1.7B | Good small model |
| phi4-mini | 3.8B | Strong reasoning |
| gemma3:4b | 4B | Good quality |
| qwen3:8b | 8B | Best quality under 8B |

## Rule-based checks (no LLM needed)

These run instantly with zero latency:
- Double words ("the the")
- A/an misuse ("a apple")
- Common misspellings (~200 words)
- Missing capitalization after periods
- Double spaces
- Missing space after punctuation
- Subject-verb agreement (simple cases)
- Unclosed quotes
- Common confusions (its/it's)

## Files

```
manifest.json    — Chrome extension config (Manifest V3)
background.js    — Service worker: multi-provider API, context menus
content.js       — Content script: detection, badge, overlays, popups
content.css      — All visual styling
rules.js         — Fast rule-based grammar checker
popup.html/js/css — Settings UI
icons/           — Extension icons
```
