import '@rogieking/figui3/fig.css';
import '@rogieking/figui3/fig.js';
import './styles.css';
import { icons } from './icons.js';

// UI contract (see code.ts)
//   UI → plugin: 'ui-ready' {}, 'ui-generate' {}, 'ui-export' { payload: string }
//   plugin → UI: 'selection-info' { name, variantCount, propsCount },
//                'generation-result' { format: 'md' | 'json', output },
//                'status' { message }, 'download' { filename, content }

const $ = (id) => document.getElementById(id);
const els = {
  selection: $('selection'),
  selectionIcon: $('selectionIcon'),
  selectionName: $('selectionName'),
  miniSummary: $('miniSummary'),
  format: $('format'),
  outputs: { md: $('output-md'), json: $('output-json') },
  status: $('status'),
  exportBtn: $('exportBtn'),
  copyBtn: $('copyBtn'),
  generateBtn: $('generateBtn'),
};
els.selectionIcon.innerHTML = icons.component; // static, trusted markup

const state = { format: 'md', generating: false };

function send(type, payload = {}) {
  parent.postMessage({ pluginMessage: { type, ...payload } }, '*');
}

function setDisabled(btn, disabled) {
  btn.toggleAttribute('disabled', disabled);
  btn.setAttribute('aria-disabled', String(disabled));
}

const isDisabled = (btn) => btn.hasAttribute('disabled');

function setStatus(message, tone) {
  els.status.textContent = message;
  if (tone) els.status.dataset.tone = tone;
  else delete els.status.dataset.tone;
}

function toneOf(message) {
  if (/^✅/.test(message)) return 'ok';
  if (/^⚠️/.test(message)) return 'warn';
  if (/^❌/.test(message)) return 'err';
  return undefined;
}

function updateButtons() {
  setDisabled(els.copyBtn, !els.outputs[state.format].value.trim());
  setDisabled(els.exportBtn, !els.outputs.json.value.trim());
}

function setGenerating(generating) {
  state.generating = generating;
  setDisabled(els.generateBtn, generating);
  els.generateBtn.setAttribute('aria-busy', String(generating));
  els.generateBtn.textContent = generating ? 'Generating…' : 'Generate';
}

function setFormat(format) {
  if (!(format in els.outputs)) return;
  state.format = format;
  for (const [key, area] of Object.entries(els.outputs)) area.hidden = key !== format;
  updateButtons();
}

function setSelection({ name, variantCount, propsCount }) {
  const empty = !variantCount && !propsCount && /^(No selection|Unreadable)/.test(name || '');
  els.selection.dataset.empty = String(!name || empty);
  els.selectionName.textContent = name || 'No selection detected';
  els.selectionName.title = name || '';
  els.miniSummary.textContent = `Variants: ${variantCount || 0} · Component Props: ${propsCount || 0}`;
}

// Copy: the Clipboard API is blocked in Figma's plugin iframe, so copy via a
// textarea selection first and only fall back to navigator.clipboard.
function copyFromTextarea(area) {
  area.focus();
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  area.setSelectionRange(0, 0);
  return ok;
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Controls ----------

els.format.addEventListener('change', (e) => setFormat(e.currentTarget.value));

els.generateBtn.addEventListener('click', () => {
  if (isDisabled(els.generateBtn)) return;
  setGenerating(true);
  setStatus('⚙️ Generating…');
  send('ui-generate');
});

els.copyBtn.addEventListener('click', async () => {
  if (isDisabled(els.copyBtn)) return;
  const area = els.outputs[state.format];
  let ok = copyFromTextarea(area);
  if (!ok && navigator.clipboard) {
    try { await navigator.clipboard.writeText(area.value); ok = true; } catch (_) { ok = false; }
  }
  setStatus(ok ? '📋 Copied to clipboard' : '❌ Copy failed', ok ? 'ok' : 'err');
});

els.exportBtn.addEventListener('click', () => {
  if (isDisabled(els.exportBtn)) return;
  const json = els.outputs.json.value;
  try {
    JSON.parse(json);
  } catch (_) {
    setStatus('⚠️ Nothing valid to export. Generate first.', 'warn');
    return;
  }
  send('ui-export', { payload: json });
});

// ---------- Plugin messages ----------

window.addEventListener('message', (event) => {
  const msg = (event.data && event.data.pluginMessage) || {};
  switch (msg.type) {
    case 'selection-info':
      setSelection(msg);
      break;
    case 'generation-result':
      if (msg.format in els.outputs) els.outputs[msg.format].value = msg.output || '';
      // code.ts always answers md then json, on success and on error
      if (msg.format === 'json') setGenerating(false);
      updateButtons();
      break;
    case 'status': {
      const text = msg.message || '';
      setStatus(text, toneOf(text));
      break;
    }
    case 'download':
      try {
        downloadFile(msg.filename || 'component-metadata.json', msg.content || '');
        setStatus(`💾 Saved ${msg.filename}`, 'ok');
      } catch (_) {
        setStatus('❌ Export failed', 'err');
      }
      break;
    default:
      break;
  }
});

setFormat('md');
send('ui-ready');
