// Export Component Metadata – backend
// Focus: read Component Set (even if user selected an Instance/Component) and
// generate Markdown + JSON with Variant groups and Component Properties.
// UI contract: receives 'ui-ready', 'ui-generate', 'ui-export'; sends back
// 'selection-info', 'generation-result', 'status', and optional 'download'.

figma.showUI(__html__, { width: 820, height: 900 });

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

// ---------- Helpers ----------

function cleanPropName(key: string): string {
  const idx = key.indexOf('#');
  return idx >= 0 ? key.slice(0, idx) : key;
}

async function resolveSwapName(id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !id) return null;
  try {
    const node = await figma.getNodeByIdAsync(id);
    if (node && 'name' in node) return (node as BaseNode & { name: string }).name;
  } catch (e) {
    // ignore lookup errors, return null
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
  for (const item of pref) {
    const id = extractNodeIdFromPreferred(item);
    if (id) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (node && 'name' in node) names.push((node as BaseNode & { name: string }).name);
      } catch (_) {
        // ignore this preferred entry if it can't be resolved
      }
    }
  }
  return names;
}

// ---------- Messaging helpers ----------

function post(type: string, payload: Record<string, unknown> = {}): void {
  figma.ui.postMessage({ type, ...payload });
}

function reportStatus(message: string, notify = false): void {
  post('status', { message });
  if (notify) {
    try { figma.notify(message, { timeout: 1800 }); } catch (e) { /* ignore */ }
  }
}

// ---------- Selection resolution (normalize to Component Set or Component) ----------

async function resolveTargetFromNodeAsync(node: SceneNode | BaseNode | null): Promise<Target> {
  let cur: BaseNode | null = (node as BaseNode) || null;
  while (cur) {
    if (cur.type === 'COMPONENT_SET') return { set: cur as ComponentSetNode, component: null };
    if (cur.type === 'COMPONENT') {
      const p = (cur as ComponentNode).parent;
      if (p && p.type === 'COMPONENT_SET') return { set: p as ComponentSetNode, component: null };
      return { set: null, component: cur as ComponentNode };
    }
    if (cur.type === 'INSTANCE') {
      const main = await (cur as InstanceNode).getMainComponentAsync();
      if (main) {
        const p = main.parent;
        if (p && p.type === 'COMPONENT_SET') return { set: p as ComponentSetNode, component: null };
        return { set: null, component: main as ComponentNode };
      }
    }
    cur = (cur as BaseNode).parent as BaseNode | null;
  }
  return { set: null, component: null };
}

async function resolveFromSelectionAsync(): Promise<Target> {
  const sel = figma.currentPage.selection;
  if (!sel || sel.length === 0) return { set: null, component: null };
  for (const n of sel) {
    const t = await resolveTargetFromNodeAsync(n);
    if (t.set || t.component) return t;
  }
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
      variantOptions: Array.isArray((d as any).variantOptions) ? (d as any).variantOptions.slice() : undefined,
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
  const orderHint: string[] | null = null;

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

  // No legacy order hint — use heuristic below
  const legacyOrderHint: string[] | null = null;

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
  return lines.join('\n');
}

async function toJSONSummaryTarget(target: Target): Promise<string> {
  const isSet = !!target.set;
  const name = isSet ? target.set!.name : target.component!.name;
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
  return JSON.stringify(resultPayload, null, 2);
}

// ---------- Selection info push ----------

async function sendSelectionInfoAsync(): Promise<void> {
  const t = await resolveFromSelectionAsync();
  if (!t.set && !t.component) {
    post('selection-info', { name: 'No selection detected', variantCount: 0, propsCount: 0 });
    reportStatus('⚠️ No valid selection. Select a Component, Instance or Component Set.');
    return;
  }
  const isSet = !!t.set;
  const name = isSet ? t.set!.name : t.component!.name;
  const collected = isSet ? collectComponentPropsWithOrder(t.set!) : collectPropsFromComponent(t.component!);
  const variantCount = isSet ? t.set!.children.filter((n)=>n.type==='COMPONENT').length : 1;
  post('selection-info', { name, variantCount, propsCount: collected.order.length });
  reportStatus('✅ Selection detected.');
}

// ---------- UI events ----------

figma.ui.onmessage = async (msg: { type: string; options?: UIOptions; payload?: string }) => {
  switch (msg.type) {
    case 'ui-ready': {
      await sendSelectionInfoAsync();
      break;
    }
    case 'ui-generate': {
      try {
        reportStatus('⚙️ Generating…');
        const t = await resolveFromSelectionAsync();
        if (!t.set && !t.component) {
          post('generation-result', { format: msg.options?.format, output: '' });
          reportStatus('⚠️ Please select a Component, Instance or Component Set.', true);
          return;
        }
        const fmt = msg.options?.format;
        if (fmt === 'md') {
          const out = await toMarkdownTarget(t);
          post('generation-result', { format: 'md', output: out });
        } else if (fmt === 'json') {
          const out = await toJSONSummaryTarget(t);
          post('generation-result', { format: 'json', output: out });
        }
        reportStatus('✅ Generated.');
      } catch (e) {
        post('generation-result', { format: msg.options?.format, output: '' });
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
      // Ask UI to download a file (UI should handle this message)
      figma.ui.postMessage({ type: 'download', filename: `${name}.json`, content });
      reportStatus('💾 Export ready (JSON).');
      break;
    }
    default:
      break;
  }
};

// Push selection info when selection changes
figma.on('selectionchange', async () => {
  reportStatus('🔄 Selection changed');
  await sendSelectionInfoAsync();
});