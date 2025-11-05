// Export Component Metadata – backend
// Focus: read Component Set (even if user selected an Instance/Component) and
// generate Markdown + JSON with Variant groups and Component Properties.
// UI contract: Generate/Copy are single-selection only. Full export runs ONLY on Export .md/.json clicks.
// 'selection-info', 'generation-result', 'status', and optional 'download'.

figma.showUI(__html__, { width: 820, height: 900 });
// Notify UI that backend is ready (for UIs that wait a ping)
try {
  figma.ui.postMessage({ type: 'backend-ready' });
  figma.ui.postMessage({ type: 'backendReady' }); // alias for older UIs
} catch { /* noop */ }

let __exportScanCache: ComponentSetNode[] = [];
let __exportScanFormat: 'md' | 'json' | null = null;
// Busy flag to freeze selection + UI during heavy export flows
let __busy = false;
// Gate: only allow full-file scans after user explicitly clicks Export .md/.json
let __scanAllowed = false;

// ---------- Types ----------

type PropKind = 'BOOLEAN' | 'TEXT' | 'NUMBER' | 'INSTANCE_SWAP' | 'VARIANT';

interface PropDefLite {
  name: string;
  type: PropKind;
  defaultValue?: unknown;
  preferredValuesCount?: number;
  preferredValuesRaw?: unknown[]; // raw values from preferredValues to resolve async
  preferredInstanceNames?: string[]; // (filled at format time)
  variantOptions?: string[]; // for VARIANT props
}

interface UIOptions {
  format: 'json' | 'md';
}

// A valid analysis target can be a Component Set or a single Component
type Target = { set: ComponentSetNode | null; component: ComponentNode | null };

type ProgressPayload = { current: number; total: number; label?: string };


// ---------- Helpers ----------

// Debug / logging helpers
const __DBG = true;
function log(...args: unknown[]): void {
  try { if (__DBG) console.log('[Backend]', ...args); } catch { /* noop */ }
}
function warn(...args: unknown[]): void {
  try { if (__DBG) console.warn('[Backend]', ...args); } catch { /* noop */ }
}
function err(...args: unknown[]): void {
  try { if (__DBG) console.error('[Backend]', ...args); } catch { /* noop */ }
}

// Simple timing helpers (console.time/timeEnd are not typed in Figma typings)
const __timers = new Map<string, number>();
function timeStart(label: string): void {
  if (!__DBG) return;
  try { __timers.set(label, Date.now()); } catch { /* noop */ }
}
function timeEnd(label: string): void {
  if (!__DBG) return;
  try {
    const t0 = __timers.get(label);
    if (typeof t0 === 'number') {
      const ms = Date.now() - t0;
      log(`${label}: ${ms.toFixed(2)} ms`);
      __timers.delete(label);
    }
  } catch { /* noop */ }
}

const NODE_RESOLVE_TIMEOUT_MS = 600; // avoid hangs on node lookups
function withTimeout<T>(p: Promise<T>, ms = NODE_RESOLVE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(undefined as unknown as T), ms);
    p.then((v) => { clearTimeout(t); resolve(v); })
     .catch(() => { clearTimeout(t); resolve(undefined as unknown as T); });
  });
}

function cleanPropName(key: string): string {
  const idx = key.indexOf('#');
  return idx >= 0 ? key.slice(0, idx) : key;
}

async function resolveSwapName(id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !id) return null;
  try {
    const node = await withTimeout(figma.getNodeByIdAsync(id));
    if (node && 'name' in node) return (node as BaseNode & { name: string }).name;
  } catch {
    // ignore lookup errors
  }
  return null;
}

function extractNodeIdFromPreferred(val: unknown): string | null {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.id === 'string') return obj.id;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.nodeId === 'string') return obj.nodeId;
  }
  return null;
}

async function resolvePreferredInstanceNames(pref: unknown): Promise<string[]> {
  if (!Array.isArray(pref)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of pref) {
    const id = extractNodeIdFromPreferred(item);
    if (!id) continue;
    try {
      const node = await withTimeout(figma.getNodeByIdAsync(id));
      const name = (node && 'name' in node) ? (node as BaseNode & { name: string }).name : null;
      if (name && !seen.has(name)) { seen.add(name); names.push(name); }
    } catch {
      // ignore unresolved preferred entries
    }
  }
  return names;
}

// ---------- Messaging helpers ----------

function post(type: string, payload: Record<string, unknown> = {}): void {
  const msg = { type, ...payload };
  log('post → UI', msg);
  try {
    figma.ui.postMessage(msg);
    // Also send camelCase alias for compatibility: e.g. 'scan-start' → 'scanStart'
    const alias = type.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    if (alias !== type) {
      const aliased = { type: alias, ...payload };
      log('post → UI (alias)', aliased);
      figma.ui.postMessage(aliased);
    }
  } catch { /* noop */ }
}

function reportStatus(message: string, notify = false): void {
  log('status:', message);
  post('status', { message });
  if (notify) {
    try { figma.notify(message, { timeout: 1800 }); } catch { /* ignore */ }
  }
}

function postProgress(p: ProgressPayload): void {
  log('progress:', `${p.current}/${p.total}`, p.label ?? '');
  post('progress', p as unknown as Record<string, unknown>);
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim();
}

// ---------- Streaming Scan & Generate All Helpers ----------

async function scanAllComponentSets(): Promise<ComponentSetNode[]> {
  // Ensure pages are loaded (inline call to satisfy linter rule)
  if ('loadAllPagesAsync' in figma) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (figma as unknown as { loadAllPagesAsync: () => Promise<void> }).loadAllPagesAsync();
  }
  // eslint-disable-next-line @figma/figma-plugins/dynamic-page-find-method-advice
  const sets = figma.root.findAll(n => n.type === 'COMPONENT_SET') as ComponentSetNode[];
  log('scanAllComponentSets →', sets.length);
  return sets;
}

async function streamScan(format: 'md' | 'json'): Promise<void> {
  timeStart('streamScan');
  log('streamScan start; format =', format);
  const sets = await scanAllComponentSets();
  __exportScanCache = sets;
  __exportScanFormat = format;
  post('scan-start', { total: sets.length });
  post('sets-count', { count: sets.length });
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    post('scan-tick', { index: i + 1, total: sets.length, name: s.name });
    // Avoid viewport jumps during export to reduce lag
  }
  post('scan-complete', { total: sets.length, format });
  log('streamScan complete; total =', sets.length);
  timeEnd('streamScan');
}

async function streamGenerateAll(format: 'md' | 'json'): Promise<void> {
  timeStart('streamGenerateAll');
  log('streamGenerateAll start; format =', format);
  const sets = __exportScanCache || [];
  post('gen-start', { total: sets.length });
  if (format === 'md') {
    const parts: string[] = [];
    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      post('gen-tick', { index: i + 1, total: sets.length, name: s.name });
      try {
        const md = await toMarkdownTarget({ set: s, component: null });
        parts.push(md);
        log('gen md ✓', s.name);
      } catch (e) {
        parts.push(`# ${s.name}\n\n> ⚠️ Failed to generate this Component Set. Skipped.`);
        warn('gen md ✗', s.name, e);
      }
    }
    const content = parts.join('\n\n---\n\n');
    const filename = safeName(`${figma.root.name || 'component-metadata'}-all.md`);
    post('gen-complete', { content, filename, mime: 'text/markdown', format: 'md' });
  } else {
    const items: unknown[] = [];
    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      post('gen-tick', { index: i + 1, total: sets.length, name: s.name });
      try {
        const jsonStr = await toJSONSummaryTarget({ set: s, component: null });
        try { items.push(JSON.parse(jsonStr)); }
        catch { items.push({ name: s.name, raw: jsonStr }); }
        log('gen json ✓', s.name);
      } catch (e) {
        items.push({ name: s.name, error: 'Failed to generate this Component Set' });
        warn('gen json ✗', s.name, e);
      }
    }
    const payload = { document: figma.root.name || 'Untitled', count: items.length, items };
    const content = JSON.stringify(payload, null, 2);
    const filename = safeName(`${figma.root.name || 'component-metadata'}-all.json`);
    post('gen-complete', { content, filename, mime: 'application/json', format: 'json' });
  }
  __exportScanFormat = null;
  log('streamGenerateAll complete.');
  timeEnd('streamGenerateAll');
}

// ---------- Selection resolution (normalize to Component Set or Component) ----------

async function resolveTargetFromNodeAsync(node: SceneNode | BaseNode | null): Promise<Target> {
  log('resolveTargetFromNodeAsync', (node as BaseNode | null)?.type ?? 'null');
  let cur: BaseNode | null = (node as BaseNode) || null;
  while (cur) {
    if (cur.type === 'COMPONENT_SET') {
      log('→ resolved', 'COMPONENT_SET');
      return { set: cur as ComponentSetNode, component: null };
    }
    if (cur.type === 'COMPONENT') {
      const p = (cur as ComponentNode).parent;
      if (p && p.type === 'COMPONENT_SET') {
        log('→ resolved', 'COMPONENT_SET');
        return { set: p as ComponentSetNode, component: null };
      }
      log('→ resolved', 'COMPONENT (loose)');
      return { set: null, component: cur as ComponentNode };
    }
    if (cur.type === 'INSTANCE') {
      const main = await (cur as InstanceNode).getMainComponentAsync();
      if (main) {
        const p = main.parent;
        if (p && p.type === 'COMPONENT_SET') {
          log('→ resolved', 'COMPONENT_SET (from instance main)');
          return { set: p as ComponentSetNode, component: null };
        }
        log('→ resolved', 'COMPONENT (loose)');
        return { set: null, component: main as ComponentNode };
      }
    }
    cur = (cur as BaseNode).parent as BaseNode | null;
  }
  warn('→ unresolved for node');
  return { set: null, component: null };
}

async function resolveFromSelectionAsync(): Promise<Target> {
  const sel = figma.currentPage.selection;
  log('resolveFromSelectionAsync → selection length', sel?.length ?? 0);
  if (!sel || sel.length === 0) return { set: null, component: null };
  for (const n of sel) {
    const t = await resolveTargetFromNodeAsync(n);
    if (t.set || t.component) return t;
  }
  warn('resolveFromSelectionAsync → no valid target in selection');
  return { set: null, component: null };
}


// ---------- Data collectors ----------

function collectPropsFromComponent(comp: ComponentNode): { defs: Record<string, PropDefLite>, order: string[] } {
  const out: Record<string, PropDefLite> = {};
  const order: string[] = [];
  const defs = comp.componentPropertyDefinitions as ComponentPropertyDefinitions | undefined;
  if (!defs) return { defs: out, order };
  const rawKeys = Object.keys(defs);
  // Heuristic: VARIANT first (rare on single component), then pair "Has X" → "X"
  const items = rawKeys.map((k) => ({ key: k, type: (defs[k].type as PropKind), name: cleanPropName(k) }));
  const variantKeys = items.filter((i) => i.type === 'VARIANT').map((i) => i.key);
  const others = items.filter((i) => i.type !== 'VARIANT');
  const hasMap = new Map<string, string>();
  for (const it of others) if (it.name.slice(0,4)==='Has ') hasMap.set(it.name.slice(4), it.key);
  const taken = new Set<string>();
  const orderedOthers: string[] = [];
  for (const it of others) {
    if (taken.has(it.key)) continue;
    const base = it.name;
    const hasKey = hasMap.get(base);
    if (hasKey && !taken.has(hasKey)) { orderedOthers.push(hasKey); taken.add(hasKey); }
    orderedOthers.push(it.key); taken.add(it.key);
  }
  const keys = variantKeys.concat(orderedOthers);
  for (const key of keys) {
    const d = defs[key];
    const type = d.type as PropKind;
    order.push(key);
    let defDefaultValue: unknown = undefined;
    if ('defaultValue' in d) defDefaultValue = (d as { defaultValue?: unknown }).defaultValue;
    if (type === 'VARIANT') defDefaultValue = undefined;
    out[key] = {
      name: cleanPropName(key),
      type,
      defaultValue: defDefaultValue,
      preferredValuesCount: undefined,
      preferredValuesRaw: undefined,
      preferredInstanceNames: undefined,
      variantOptions: ((): string[] | undefined => {
        const maybe = (d as { variantOptions?: unknown }).variantOptions;
        return Array.isArray(maybe) ? (maybe as string[]).slice() : undefined;
      })(),
    };
    if ('preferredValues' in d) {
      const pv = (d as { preferredValues?: unknown }).preferredValues;
      if (Array.isArray(pv)) {
        out[key].preferredValuesCount = pv.length;
        out[key].preferredValuesRaw = pv as unknown[];
      }
    }
  }
  return { defs: out, order };
}

function collectComponentPropsWithOrder(set: ComponentSetNode): { defs: Record<string, PropDefLite>, order: string[] } {
  const out: Record<string, PropDefLite> = {};
  const order: string[] = [];
  const defsSet = set.componentPropertyDefinitions as ComponentPropertyDefinitions | undefined;
  // No official panel order in the API — force heuristic order only

  if (defsSet) {
    const rawKeys = Object.keys(defsSet);

    // Heuristic order only: VARIANT first, then pair "Has X" before "X"
    const items = rawKeys.map((k) => ({ key: k, type: (defsSet[k].type as PropKind), name: cleanPropName(k) }));
    const variantKeys = items.filter((i) => i.type === 'VARIANT').map((i) => i.key);
    const others = items.filter((i) => i.type !== 'VARIANT');

    const hasMap = new Map<string, string>(); // baseName -> hasKey
    for (const it of others) {
      if (it.name.slice(0, 4) === 'Has ') {
        hasMap.set(it.name.slice(4), it.key);
      }
    }
    const taken = new Set<string>();
    const orderedOthers: string[] = [];
    for (const it of others) {
      if (taken.has(it.key)) continue;
      const base = it.name;
      const hasKey = hasMap.get(base);
      if (hasKey && !taken.has(hasKey)) { orderedOthers.push(hasKey); taken.add(hasKey); }
      orderedOthers.push(it.key); taken.add(it.key);
    }
    const keys = variantKeys.concat(orderedOthers);

    for (const key of keys) {
      const d = defsSet[key];
      const type = d.type as PropKind;
      order.push(key);
      let defDefaultValue: unknown = undefined;
      if ('defaultValue' in d) defDefaultValue = (d as { defaultValue?: unknown }).defaultValue;
      if (type === 'VARIANT') defDefaultValue = undefined; // set-level only; no instance default
      out[key] = {
        name: cleanPropName(key),
        type,
        defaultValue: defDefaultValue,
        preferredValuesCount: undefined,
        preferredValuesRaw: undefined,
        preferredInstanceNames: undefined,
        variantOptions: undefined
      };
      if ('preferredValues' in d) {
        const pv = (d as { preferredValues?: unknown }).preferredValues;
        if (Array.isArray(pv)) {
          out[key].preferredValuesCount = pv.length;
          out[key].preferredValuesRaw = pv as unknown[];
        }
      }
      if (type === 'VARIANT' && 'variantOptions' in d) {
        const vo = (d as { variantOptions?: string[] }).variantOptions;
        if (Array.isArray(vo)) out[key].variantOptions = vo.slice();
      }
    }
    return { defs: out, order };
  }
  // Fallback for legacy files: merge props across child components
  const seen = new Set<string>();
  const comps = set.children.filter((n): n is ComponentNode => n.type === 'COMPONENT');

  for (const c of comps) {
    const defs = (c as ComponentNode).componentPropertyDefinitions as ComponentPropertyDefinitions | undefined;
    if (!defs) continue;
    const rawKeys = Object.keys(defs);
    // Heuristic order only: VARIANT first, then pair "Has X" before "X"
    const items = rawKeys.map((k) => ({ key: k, type: (defs[k].type as PropKind), name: cleanPropName(k) }));
    const variantKeys = items.filter((i) => i.type === 'VARIANT').map((i) => i.key);
    const others = items.filter((i) => i.type !== 'VARIANT');
    const hasMap = new Map<string, string>();
    for (const it of others) {
      if (it.name.slice(0, 4) === 'Has ') {
        hasMap.set(it.name.slice(4), it.key);
      }
    }
    const taken = new Set<string>();
    const orderedOthers: string[] = [];
    for (const it of others) {
      if (taken.has(it.key)) continue;
      const base = it.name;
      const hasKey = hasMap.get(base);
      if (hasKey && !taken.has(hasKey)) { orderedOthers.push(hasKey); taken.add(hasKey); }
      orderedOthers.push(it.key); taken.add(it.key);
    }
    const keys = variantKeys.concat(orderedOthers);
    for (const key of keys) {
      const d = defs[key];
      const type = d.type as PropKind;
      if (!seen.has(key)) { seen.add(key); order.push(key); }
      let defDefaultValue: unknown = undefined;
      if ('defaultValue' in d) defDefaultValue = (d as { defaultValue?: unknown }).defaultValue;
      if (type === 'VARIANT') defDefaultValue = undefined;
      if (!out[key]) {
        out[key] = {
          name: cleanPropName(key),
          type,
          defaultValue: defDefaultValue,
          preferredValuesCount: undefined,
          preferredValuesRaw: undefined,
          preferredInstanceNames: undefined,
          variantOptions: undefined
        };
        if ('preferredValues' in d) {
          const pv = (d as { preferredValues?: unknown }).preferredValues;
          if (Array.isArray(pv)) {
            out[key].preferredValuesCount = pv.length;
            out[key].preferredValuesRaw = pv as unknown[];
          }
        }
        if (type === 'VARIANT' && 'variantOptions' in d) {
          const vo = (d as { variantOptions?: string[] }).variantOptions;
          if (Array.isArray(vo)) out[key].variantOptions = vo.slice();
        }
      }
    }
  }
  return { defs: out, order };
}


// ---------- Export All (with progress) ----------

async function exportAllMarkdown(): Promise<void> {
  timeStart('exportAllMarkdown');
  log('exportAllMarkdown start');
  // Ensure pages are loaded (inline call to satisfy linter rule)
  if ('loadAllPagesAsync' in figma) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (figma as unknown as { loadAllPagesAsync: () => Promise<void> }).loadAllPagesAsync();
  }
  // eslint-disable-next-line @figma/figma-plugins/dynamic-page-find-method-advice
  const sets = figma.root.findAll(n => n.type === 'COMPONENT_SET') as ComponentSetNode[];
  if (sets.length === 0) {
    reportStatus('⚠️ No Component Sets found.', true);
    post('download-text', { filename: safeName(`${figma.root.name || 'component-metadata'}-all.md`), mime: 'text/markdown', content: '' });
    log('exportAllMarkdown complete');
    timeEnd('exportAllMarkdown');
    return;
  }
  reportStatus(`⏳ Generating Markdown for ${sets.length} sets…`);
  post('progress', { current: 0, total: sets.length, label: 'Initializing…' });
  const parts: string[] = [];
  const total = sets.length;
  let current = 0;
  for (const set of sets) {
    current += 1;
    postProgress({ current, total, label: set.name });
    try {
      const md = await toMarkdownTarget({ set, component: null });
      parts.push(md);
    } catch (e) {
      parts.push(`# ${set.name}\n\n> ⚠️ Failed to generate this Component Set. Skipped.`);
      reportStatus(`⚠️ Skipped: ${set.name}`);
    }
  }
  const allMd = parts.join(`\n\n---\n\n`);
  const filename = safeName(`${figma.root.name || 'component-metadata'}-all.md`);
  figma.ui.postMessage({ type: 'download-text', filename, mime: 'text/markdown', content: allMd });
  reportStatus('✅ Markdown ready.');
  log('exportAllMarkdown complete');
  timeEnd('exportAllMarkdown');
}

async function exportAllJSON(): Promise<void> {
  timeStart('exportAllJSON');
  log('exportAllJSON start');
  // Ensure pages are loaded (inline call to satisfy linter rule)
  if ('loadAllPagesAsync' in figma) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (figma as unknown as { loadAllPagesAsync: () => Promise<void> }).loadAllPagesAsync();
  }
  // eslint-disable-next-line @figma/figma-plugins/dynamic-page-find-method-advice
  const sets = figma.root.findAll(n => n.type === 'COMPONENT_SET') as ComponentSetNode[];
  if (sets.length === 0) {
    reportStatus('⚠️ No Component Sets found.', true);
    post('download-text', { filename: safeName(`${figma.root.name || 'component-metadata'}-all.json`), mime: 'application/json', content: JSON.stringify({ document: figma.root.name || 'Untitled', count: 0, items: [] }, null, 2) });
    log('exportAllJSON complete');
    timeEnd('exportAllJSON');
    return;
  }
  reportStatus(`⏳ Generating JSON for ${sets.length} sets…`);
  post('progress', { current: 0, total: sets.length, label: 'Initializing…' });
  const items: unknown[] = [];
  const total = sets.length;
  let current = 0;
  for (const set of sets) {
    current += 1;
    postProgress({ current, total, label: set.name });
    try {
      const jsonStr = await toJSONSummaryTarget({ set, component: null });
      try { items.push(JSON.parse(jsonStr)); }
      catch { items.push({ name: set.name, raw: jsonStr }); }
    } catch (e) {
      items.push({ name: set.name, error: 'Failed to generate this Component Set' });
      reportStatus(`⚠️ Skipped: ${set.name}`);
    }
  }
  const payload = {
    document: figma.root.name || 'Untitled',
    count: items.length,
    items
  };
  const filename = safeName(`${figma.root.name || 'component-metadata'}-all.json`);
  figma.ui.postMessage({ type: 'download-text', filename, mime: 'application/json', content: JSON.stringify(payload, null, 2) });
  reportStatus('✅ JSON ready.');
  log('exportAllJSON complete');
  timeEnd('exportAllJSON');
}

// ---------- Formatting ----------

type PrettyProp = {
  name: string;
  type: string;
  default?: unknown;
  preferredInstancesCount?: number;
  preferredInstances?: string[];
  values?: string[];
};

async function toMarkdownTarget(target: Target): Promise<string> {
  const isSet = !!target.set;
  const name = isSet ? target.set!.name : target.component!.name;
  log('toMarkdownTarget →', name, isSet ? '(set)' : '(component)');
  const collected = isSet ? collectComponentPropsWithOrder(target.set!) : collectPropsFromComponent(target.component!);
  const { defs, order } = collected;
  const variantCount = isSet ? target.set!.children.filter((n) => n.type === 'COMPONENT').length : 1;
  const propsCount = order.length;
  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push('');
  lines.push('## Overview');
  lines.push(`- Variants: ${variantCount}`);
  lines.push(`- Component Properties: ${propsCount}`);
  lines.push('');

  lines.push('## Component Props');
  for (const key of order) {
    const d = defs[key];
    if (!d || !d.type) { continue; }
    try {
      const kind = d.type;
      const title = `[${kind.replace('_', ' ')}] **${d.name}**`;
      lines.push(title + '  ');
      if (kind === 'BOOLEAN') {
        lines.push('Values: True / False');
        if (typeof d.defaultValue === 'boolean') lines.push(`Default: ${String(d.defaultValue)}`);
      } else if (kind === 'TEXT' || kind === 'NUMBER') {
        if (d.defaultValue !== undefined && d.defaultValue !== null && `${d.defaultValue}` !== '') {
          lines.push(`Default: ${String(d.defaultValue)}`);
        }
      } else if (kind === 'INSTANCE_SWAP') {
        const resolved = await resolveSwapName(d.defaultValue);
        if (resolved) {
          lines.push(`Default: ${resolved}`);
        } else if (typeof d.defaultValue === 'string' && d.defaultValue) {
          lines.push(`Default: ${d.defaultValue}`);
        }
        let prefNames: string[] = [];
        if (Array.isArray(d.preferredInstanceNames) && d.preferredInstanceNames.length > 0) {
          prefNames = d.preferredInstanceNames;
        } else if (Array.isArray(d.preferredValuesRaw)) {
          prefNames = await resolvePreferredInstanceNames(d.preferredValuesRaw);
        }
        if (prefNames.length > 0) {
          lines.push(`Preferred Instances (${prefNames.length}): ${prefNames.join(', ')}`);
        } else if (typeof d.preferredValuesCount === 'number') {
          lines.push(`Preferred Instances (${d.preferredValuesCount})`);
        }
      } else if (kind === 'VARIANT') {
        const vals = d.variantOptions && Array.isArray(d.variantOptions) ? d.variantOptions : [];
        if (vals.length) {
          lines.push(`Values: ${vals.join(', ')}`);
        }
      }
      lines.push('');
    } catch (err) {
      // Skip problematic prop but continue
    }
  }
  log('toMarkdownTarget ✓', name);
  return lines.join('\n');
}

async function toJSONSummaryTarget(target: Target): Promise<string> {
  const isSet = !!target.set;
  const name = isSet ? target.set!.name : target.component!.name;
  log('toJSONSummaryTarget →', name, isSet ? '(set)' : '(component)');
  const collected = isSet ? collectComponentPropsWithOrder(target.set!) : collectPropsFromComponent(target.component!);
  const { defs, order } = collected;
  const variantCount = isSet ? target.set!.children.filter((n) => n.type === 'COMPONENT').length : 1;
  const props: PropDefLite[] = order.map((k) => defs[k]);
  const payload = {
    name: name,
    overview: { variantsCount: variantCount, componentPropsCount: order.length },
    componentProps: props,
  };
  const prettyProps: PrettyProp[] = [];
  for (const k of order) {
    const d = defs[k];
    const pretty: PrettyProp = { name: d?.name ?? k, type: (d?.type as string) ?? 'UNKNOWN' };
    try {
      if (d?.type === 'BOOLEAN' || d?.type === 'TEXT' || d?.type === 'NUMBER') {
        if (d.defaultValue !== undefined) pretty.default = d.defaultValue;
      } else if (d?.type === 'INSTANCE_SWAP') {
        const resolved = await resolveSwapName(d.defaultValue);
        pretty.default = resolved || (typeof d.defaultValue === 'string' ? d.defaultValue : null);
        if (typeof d.preferredValuesCount === 'number') pretty.preferredInstancesCount = d.preferredValuesCount;
        let prefNames: string[] = [];
        if (Array.isArray(d.preferredInstanceNames)) prefNames = d.preferredInstanceNames;
        else if (Array.isArray(d.preferredValuesRaw)) prefNames = await resolvePreferredInstanceNames(d.preferredValuesRaw);
        if (prefNames.length > 0) pretty.preferredInstances = prefNames;
      } else if (d?.type === 'VARIANT') {
        if (Array.isArray(d.variantOptions)) pretty.values = d.variantOptions;
      }
    } catch (_) {
      // best-effort only
    }
    prettyProps.push(pretty);
  }
  const resultPayload = {
    ...payload,
    pretty: { componentProps: prettyProps }
  };
  log('toJSONSummaryTarget ✓', name);
  return JSON.stringify(resultPayload, null, 2);
}

// ---------- Selection info push ----------

async function sendSelectionInfoAsync(): Promise<void> {
  log('sendSelectionInfoAsync');
  if (__busy) {
    // Skip selection pushes while exporting to avoid UI lag
    return;
  }
  const t = await resolveFromSelectionAsync();
  if (!t.set && !t.component) {
    post('selection-info', { name: 'No selection detected', variantCount: 0, propsCount: 0 });
    post('selectionInfo', { name: 'No selection detected', variantCount: 0, propsCount: 0 });
    reportStatus('⚠️ No valid selection. Select a Component, Instance or Component Set.');
    return;
  }
  const isSet = !!t.set;
  const name = isSet ? t.set!.name : t.component!.name;
  log('selection →', name, isSet ? '(set)' : '(component)');
  const collected = isSet ? collectComponentPropsWithOrder(t.set!) : collectPropsFromComponent(t.component!);
  const variantCount = isSet ? t.set!.children.filter((n)=>n.type==='COMPONENT').length : 1;
  post('selection-info', { name, variantCount, propsCount: collected.order.length });
  post('selectionInfo', { name, variantCount, propsCount: collected.order.length });
  reportStatus('✅ Selection detected.');
}

// ---------- UI events ----------

figma.ui.onmessage = async (msg: { type: string; options?: UIOptions; payload?: string }) => {
  log('onmessage ←', msg.type, msg);
  switch (msg.type) {
    case 'ui-ready': {
      await sendSelectionInfoAsync();
      post('status', { message: '🟢 Backend ready' });
      break;
    }
    case 'uiReady': { // alias
      await sendSelectionInfoAsync();
      post('status', { message: '🟢 Backend ready' });
      break;
    }
    case 'ui-scan': {
      // Ignore UI-driven scans unless explicitly enabled by an Export action
      if (!__scanAllowed) {
        log('ui-scan ignored (scan not allowed yet)');
        break;
      }
      try {
        __busy = true;
        post('busy', { value: true });
        const fmt = (msg as unknown as { format?: 'md'|'json' }).format || 'md';
        await streamScan(fmt);
      } catch (e) {
        err('ui-scan error', e);
        const errMsg = (e && typeof e === 'object' && 'message' in e) ? (e as Error).message : String(e);
        reportStatus(`❌ Scan failed: ${errMsg}`, true);
      } finally {
        __busy = false;
        post('busy', { value: false });
      }
      break;
    }
    case 'uiScan': { // alias
      if (!__scanAllowed) {
        log('uiScan ignored (scan not allowed yet)');
        break;
      }
      try {
        __busy = true;
        post('busy', { value: true });
        const fmt = (msg as unknown as { format?: 'md'|'json' }).format || 'md';
        await streamScan(fmt);
      } catch (e) {
        err('ui-scan error', e);
        const errMsg = (e && typeof e === 'object' && 'message' in e) ? (e as Error).message : String(e);
        reportStatus(`❌ Scan failed: ${errMsg}`, true);
      } finally {
        __busy = false;
        post('busy', { value: false });
      }
      break;
    }
    case 'ui-generate-all': {
      try {
        __busy = true;
        post('busy', { value: true });
        const fmt = (msg as unknown as { format?: 'md'|'json' }).format || __exportScanFormat || 'md';
        await streamGenerateAll(fmt);
      } catch (e) {
        err('ui-generate-all error', e);
        const errMsg = (e && typeof e === 'object' && 'message' in e) ? (e as Error).message : String(e);
        reportStatus(`❌ Generate failed: ${errMsg}`, true);
      } finally {
        __busy = false;
        __scanAllowed = false;
        post('busy', { value: false });
      }
      break;
    }
    case 'uiGenerateAll': { // alias
      try {
        __busy = true;
        post('busy', { value: true });
        const fmt = (msg as unknown as { format?: 'md'|'json' }).format || __exportScanFormat || 'md';
        await streamGenerateAll(fmt);
      } catch (e) {
        err('ui-generate-all error', e);
        const errMsg = (e && typeof e === 'object' && 'message' in e) ? (e as Error).message : String(e);
        reportStatus(`❌ Generate failed: ${errMsg}`, true);
      } finally {
        __busy = false;
        __scanAllowed = false;
        post('busy', { value: false });
      }
      break;
    }
    case 'ui-generate': {
      try {
        const fmtTop = (msg as unknown as { format?: 'md'|'json' }).format || msg.options?.format;
        // Si venimos del flujo masivo (hay cache del scan), genera todos
        if (__exportScanCache && __exportScanCache.length > 0 && fmtTop) {
          await streamGenerateAll(fmtTop);
          break;
        }
        reportStatus('⚙️ Generating…');
        const t = await resolveFromSelectionAsync();
        if (!t.set && !t.component) {
          post('generation-result', { format: fmtTop, output: '' });
          reportStatus('⚠️ Please select a Component, Instance or Component Set.', true);
          return;
        }
        if (fmtTop === 'md' || !fmtTop) {
          const out = await toMarkdownTarget(t);
          post('generation-result', { format: 'md', output: out });
        }
        if (fmtTop === 'json' || !fmtTop) {
          const out = await toJSONSummaryTarget(t);
          post('generation-result', { format: 'json', output: out });
        }
        reportStatus('✅ Generated.');
      } catch (e) {
        post('generation-result', { format: (msg as unknown as { format?: string }).format || msg.options?.format, output: '' });
        const errMsg = (e && typeof e === 'object' && 'message' in e) ? (e as Error).message : String(e);
        console.error('Generation error:', e);
        reportStatus(`❌ Error while generating: ${errMsg}`, true);
      }
      break;
    }
    case 'uiGenerate': { // alias
      try {
        const fmtTop = (msg as unknown as { format?: 'md'|'json' }).format || msg.options?.format;
        if (__exportScanCache && __exportScanCache.length > 0 && fmtTop) {
          await streamGenerateAll(fmtTop);
          break;
        }
        reportStatus('⚙️ Generating…');
        const t = await resolveFromSelectionAsync();
        if (!t.set && !t.component) {
          post('generation-result', { format: fmtTop, output: '' });
          reportStatus('⚠️ Please select a Component, Instance or Component Set.', true);
          return;
        }
        if (fmtTop === 'md' || !fmtTop) {
          const out = await toMarkdownTarget(t);
          post('generation-result', { format: 'md', output: out });
        }
        if (fmtTop === 'json' || !fmtTop) {
          const out = await toJSONSummaryTarget(t);
          post('generation-result', { format: 'json', output: out });
        }
        reportStatus('✅ Generated.');
      } catch (e) {
        post('generation-result', { format: (msg as unknown as { format?: string }).format || msg.options?.format, output: '' });
        const errMsg = (e && typeof e === 'object' && 'message' in e) ? (e as Error).message : String(e);
        console.error('Generation error:', e);
        reportStatus(`❌ Error while generating: ${errMsg}`, true);
      }
      break;
    }
    case 'ui-export': {
      const content = msg.payload || '';
      const t = await resolveFromSelectionAsync();
      const name = t.set ? t.set.name : (t.component ? t.component.name : 'component-metadata');
      figma.ui.postMessage({ type: 'download-text', filename: `${safeName(name)}.json`, mime: 'application/json', content });
      reportStatus('💾 Export ready (JSON).');
      break;
    }
    case 'uiExport': { // alias
      const content = msg.payload || '';
      const t = await resolveFromSelectionAsync();
      const name = t.set ? t.set.name : (t.component ? t.component.name : 'component-metadata');
      figma.ui.postMessage({ type: 'download-text', filename: `${safeName(name)}.json`, mime: 'application/json', content });
      reportStatus('💾 Export ready (JSON).');
      break;
    }
    case 'ui-export-all-md': {
      await exportAllMarkdown();
      break;
    }
    case 'uiExportAllMd': { // alias
      await exportAllMarkdown();
      break;
    }
    case 'ui-export-all-json': {
      await exportAllJSON();
      break;
    }
    case 'uiExportAllJson': { // alias
      await exportAllJSON();
      break;
    }
    // --- Compatibility shims (UI variants) ---
    case 'generate':
    case 'Generate': {
      // default: generate Markdown for current selection
      await (async () => {
        try {
          const out = await toMarkdownTarget(await resolveFromSelectionAsync());
          post('generation-result', { format: 'md', output: out });
          reportStatus('✅ Generated (MD).');
        } catch (e) {
          reportStatus('❌ Failed to generate (MD).', true);
        }
      })();
      break;
    }
    case 'generate-md': {
      await (async () => {
        try {
          const t = await resolveFromSelectionAsync();
          if (!t.set && !t.component) {
            reportStatus('⚠️ Select a Component / Instance / Component Set.', true);
            post('generation-result', { format: 'md', output: '' });
            return;
          }
          const out = await toMarkdownTarget(t);
          post('generation-result', { format: 'md', output: out });
          reportStatus('✅ Generated (MD).');
        } catch (e) {
          reportStatus('❌ Failed to generate (MD).', true);
        }
      })();
      break;
    }
    case 'generate-json': {
      await (async () => {
        try {
          const t = await resolveFromSelectionAsync();
          if (!t.set && !t.component) {
            reportStatus('⚠️ Select a Component / Instance / Component Set.', true);
            post('generation-result', { format: 'json', output: '' });
            return;
          }
          const out = await toJSONSummaryTarget(t);
          post('generation-result', { format: 'json', output: out });
          reportStatus('✅ Generated (JSON).');
        } catch (e) {
          reportStatus('❌ Failed to generate (JSON).', true);
        }
      })();
      break;
    }
    case 'export-md':
    case 'Export .md': {
      try {
        __busy = true;
        __scanAllowed = true;
        post('busy', { value: true });
        await streamScan('md');
        await streamGenerateAll('md');
      } catch (e) {
        reportStatus('❌ Export .md failed.', true);
      } finally {
        __busy = false;
        __scanAllowed = false;
        post('busy', { value: false });
      }
      break;
    }
    case 'export-json':
    case 'Export .json': {
      try {
        __busy = true;
        __scanAllowed = true;
        post('busy', { value: true });
        await streamScan('json');
        await streamGenerateAll('json');
      } catch (e) {
        reportStatus('❌ Export .json failed.', true);
      } finally {
        __busy = false;
        __scanAllowed = false;
        post('busy', { value: false });
      }
      break;
    }
    case 'copy':
    case 'Copy':
    case 'ui-copy-request': {
      try {
        const t = await resolveFromSelectionAsync();
        if (!t.set && !t.component) {
          reportStatus('⚠️ Nothing to copy: no selection.', true);
          post('copy-payload', { md: '', json: '' });
          break;
        }
        const md = await toMarkdownTarget(t);
        const json = await toJSONSummaryTarget(t);
        post('copy-payload', { md, json });
        reportStatus('📋 Copy payload ready.');
      } catch (e) {
        reportStatus('❌ Copy failed.', true);
      }
      break;
    }
    case 'copyRequest': { // alias
      try {
        const t = await resolveFromSelectionAsync();
        if (!t.set && !t.component) {
          reportStatus('⚠️ Nothing to copy: no selection.', true);
          post('copy-payload', { md: '', json: '' });
          break;
        }
        const md = await toMarkdownTarget(t);
        const json = await toJSONSummaryTarget(t);
        post('copy-payload', { md, json });
        reportStatus('📋 Copy payload ready.');
      } catch (e) {
        reportStatus('❌ Copy failed.', true);
      }
      break;
    }
    default:
      break;
  }
};

// Push selection info when selection changes
figma.on('selectionchange', async () => {
  if (__busy) return; // freeze selection updates while exporting
  log('event: selectionchange');
  reportStatus('🔄 Selection changed');
  await sendSelectionInfoAsync();
});
// ---------- Page loading utility ----------

// Note: we still provide ensurePagesLoaded(), but to satisfy the linter's static analysis
// we also call loadAllPagesAsync() inline right before each findAll() site above.
let __pagesLoaded = false;
async function ensurePagesLoaded(): Promise<void> {
  if (!__pagesLoaded && 'loadAllPagesAsync' in figma) {
    log('ensurePagesLoaded → loading…');
    try {
      await (figma as unknown as { loadAllPagesAsync: () => Promise<void> }).loadAllPagesAsync();
      log('ensurePagesLoaded ✓');
    } catch (_) {
      warn('ensurePagesLoaded ✗ (ignored)');
    }
    __pagesLoaded = true;
  }
}