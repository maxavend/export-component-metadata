// Export Component Metadata – backend
// Focus: read Component Set (even if user selected an Instance/Component) and
// generate Markdown + JSON with Variant groups and Component Properties.
// UI contract: receives 'ui-ready', 'ui-generate', 'ui-export'; sends back
// 'selection-info', 'generation-result' (one per format), 'status' and 'download'.

figma.showUI(__html__, { width: 820, height: 900 });

// ---------- Types ----------

interface PropDefLite {
  name: string;
  type: ComponentPropertyType;
  defaultValue?: unknown;
  defaultInstanceName?: string; // INSTANCE_SWAP: name of the default component
  preferredValuesCount?: number;
  preferredValuesRaw?: InstanceSwapPreferredValue[];
  preferredInstanceNames?: string[]; // resolved from preferredValues keys
  variantOptions?: string[]; // for VARIANT props
}

// A valid analysis target can be a Component Set or a single (non-variant) Component
type Target = ComponentSetNode | ComponentNode;

type PrettyProp = {
  name: string;
  type: string;
  default?: unknown;
  preferredInstancesCount?: number;
  preferredInstances?: string[];
  values?: string[];
};

// ---------- Helpers ----------

function cleanPropName(key: string): string {
  const idx = key.indexOf('#');
  return idx >= 0 ? key.slice(0, idx) : key;
}

function variantCountOf(target: Target): number {
  return target.type === 'COMPONENT_SET' ? target.children.filter((n) => n.type === 'COMPONENT').length : 1;
}

function toFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return safe || 'component-metadata';
}

async function resolveNodeName(id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !id) return null;
  try {
    const node = await figma.getNodeByIdAsync(id);
    if (node && 'name' in node) return node.name;
  } catch (_) {
    // ignore lookup errors, return null
  }
  return null;
}

// preferredValues reference components by key (not node id). Local components are
// looked up in the document; published library components are imported by key.
// The key → name map is built lazily, once per generation.
let localNamesByKey: Promise<Map<string, string>> | null = null;

async function buildLocalNamesByKey(): Promise<Map<string, string>> {
  await figma.loadAllPagesAsync();
  const map = new Map<string, string>();
  for (const n of figma.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] })) {
    map.set(n.key, n.name);
  }
  return map;
}

async function resolvePreferredName(pref: InstanceSwapPreferredValue): Promise<string | null> {
  if (!localNamesByKey) localNamesByKey = buildLocalNamesByKey();
  const local = (await localNamesByKey).get(pref.key);
  if (local) return local;
  try {
    const node = pref.type === 'COMPONENT_SET'
      ? await figma.importComponentSetByKeyAsync(pref.key)
      : await figma.importComponentByKeyAsync(pref.key);
    return node.name;
  } catch (_) {
    // not local and not published: leave unresolved
    return null;
  }
}

async function resolvePreferredInstanceNames(prefs: InstanceSwapPreferredValue[]): Promise<string[]> {
  const names: string[] = [];
  for (const pref of prefs) {
    const name = await resolvePreferredName(pref);
    if (name) names.push(name);
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
    try { figma.notify(message, { timeout: 1800 }); } catch (_) { /* ignore */ }
  }
}

function errorMessage(e: unknown): string {
  return (e && typeof e === 'object' && 'message' in e) ? (e as Error).message : String(e);
}

// ---------- Selection resolution (normalize to Component Set or Component) ----------

async function resolveTargetFromNodeAsync(node: BaseNode | null): Promise<Target | null> {
  let cur: BaseNode | null = node;
  while (cur) {
    if (cur.type === 'COMPONENT_SET') return cur;
    if (cur.type === 'COMPONENT') {
      return cur.parent && cur.parent.type === 'COMPONENT_SET' ? cur.parent : cur;
    }
    if (cur.type === 'INSTANCE') {
      const main = await cur.getMainComponentAsync();
      if (main) return main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : main;
    }
    cur = cur.parent;
  }
  return null;
}

async function resolveFromSelectionAsync(): Promise<Target | null> {
  for (const n of figma.currentPage.selection) {
    const t = await resolveTargetFromNodeAsync(n);
    if (t) return t;
  }
  return null;
}

// ---------- Data collectors ----------

// Figma doesn't expose the panel order of properties. Heuristic: VARIANT first,
// then the rest in definition order, keeping each "Has X" right before "X".
function orderPropKeys(defs: ComponentPropertyDefinitions): string[] {
  const keys = Object.keys(defs);
  const variantKeys = keys.filter((k) => defs[k].type === 'VARIANT');
  const others = keys.filter((k) => defs[k].type !== 'VARIANT');
  const keyByName = new Map<string, string>();
  for (const k of others) keyByName.set(cleanPropName(k), k);

  const ordered: string[] = [];
  const taken = new Set<string>();
  const take = (k: string | undefined) => {
    if (k && !taken.has(k)) { taken.add(k); ordered.push(k); }
  };
  for (const k of others) {
    const name = cleanPropName(k);
    if (name.startsWith('Has ')) {
      take(k);
      take(keyByName.get(name.slice(4)));
    } else {
      take(keyByName.get(`Has ${name}`));
      take(k);
    }
  }
  return variantKeys.concat(ordered);
}

async function collectProps(target: Target): Promise<PropDefLite[]> {
  const defs = target.componentPropertyDefinitions;
  const props: PropDefLite[] = [];
  for (const key of orderPropKeys(defs)) {
    const d = defs[key];
    const prop: PropDefLite = { name: cleanPropName(key), type: d.type, defaultValue: d.defaultValue };
    if (d.type === 'VARIANT' && Array.isArray(d.variantOptions)) {
      prop.variantOptions = d.variantOptions.slice();
    }
    if (d.type === 'INSTANCE_SWAP') {
      const defaultName = await resolveNodeName(d.defaultValue);
      if (defaultName) prop.defaultInstanceName = defaultName;
      if (Array.isArray(d.preferredValues)) {
        prop.preferredValuesCount = d.preferredValues.length;
        prop.preferredValuesRaw = d.preferredValues.slice();
        prop.preferredInstanceNames = await resolvePreferredInstanceNames(d.preferredValues);
      }
    }
    props.push(prop);
  }
  return props;
}

// ---------- Formatting ----------

function preferredSummary(d: PropDefLite, quote: (s: string) => string): string | null {
  const total = d.preferredValuesCount || 0;
  if (!total) return null;
  const names = d.preferredInstanceNames || [];
  let line = `Preferred Instances (${total})`;
  if (names.length) line += `: ${names.map(quote).join(', ')}`;
  if (names.length < total) line += ` (${total - names.length} not resolved)`;
  return line;
}

function toMarkdown(name: string, variantCount: number, props: PropDefLite[]): string {
  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push('');
  lines.push('## Overview');
  lines.push(`- Variants: ${variantCount}`);
  lines.push(`- Component Properties: ${props.length}`);
  lines.push('');

  lines.push('## Component Props');
  for (const d of props) {
    // Each line of a prop block ends with two spaces → Markdown hard line break
    const block: string[] = [`[${d.type.replace('_', ' ')}] **${d.name}**`];
    if (d.type === 'BOOLEAN') {
      block.push('Values: True / False');
      if (typeof d.defaultValue === 'boolean') block.push(`Default: ${String(d.defaultValue)}`);
    } else if (d.type === 'TEXT') {
      if (typeof d.defaultValue === 'string' && d.defaultValue !== '') block.push(`Default: ${d.defaultValue}`);
    } else if (d.type === 'INSTANCE_SWAP') {
      const def = d.defaultInstanceName || (typeof d.defaultValue === 'string' ? d.defaultValue : '');
      if (def) block.push(`Default: ${def}`);
      const pref = preferredSummary(d, (s) => `\`${s}\``);
      if (pref) block.push(pref);
    } else if (d.type === 'VARIANT') {
      if (d.variantOptions && d.variantOptions.length) block.push(`Values: ${d.variantOptions.join(', ')}`);
      if (typeof d.defaultValue === 'string' && d.defaultValue !== '') block.push(`Default: ${d.defaultValue}`);
    }
    lines.push(block.join('  \n'));
    lines.push('');
  }
  return lines.join('\n');
}

function toJSONSummary(name: string, variantCount: number, props: PropDefLite[]): string {
  const prettyProps: PrettyProp[] = props.map((d) => {
    const pretty: PrettyProp = { name: d.name, type: d.type };
    if (d.type === 'INSTANCE_SWAP') {
      pretty.default = d.defaultInstanceName || (typeof d.defaultValue === 'string' ? d.defaultValue : null);
      if (typeof d.preferredValuesCount === 'number') pretty.preferredInstancesCount = d.preferredValuesCount;
      if (d.preferredInstanceNames && d.preferredInstanceNames.length) pretty.preferredInstances = d.preferredInstanceNames;
    } else {
      if (d.defaultValue !== undefined) pretty.default = d.defaultValue;
      if (d.type === 'VARIANT' && d.variantOptions) pretty.values = d.variantOptions;
    }
    return pretty;
  });
  const payload = {
    name,
    overview: { variantsCount: variantCount, componentPropsCount: props.length },
    componentProps: props,
    pretty: { componentProps: prettyProps },
  };
  return JSON.stringify(payload, null, 2);
}

// ---------- Selection info push ----------

async function sendSelectionInfoAsync(): Promise<void> {
  try {
    const t = await resolveFromSelectionAsync();
    if (!t) {
      post('selection-info', { name: 'No selection detected', variantCount: 0, propsCount: 0 });
      reportStatus('⚠️ No valid selection. Select a Component, Instance or Component Set.');
      return;
    }
    const propsCount = Object.keys(t.componentPropertyDefinitions).length;
    post('selection-info', { name: t.name, variantCount: variantCountOf(t), propsCount });
    reportStatus('✅ Selection detected.');
  } catch (e) {
    post('selection-info', { name: 'Unreadable selection', variantCount: 0, propsCount: 0 });
    reportStatus(`❌ Could not read the selection: ${errorMessage(e)}`);
  }
}

// ---------- UI events ----------

figma.ui.onmessage = async (msg: { type: string; payload?: string }) => {
  switch (msg.type) {
    case 'ui-ready': {
      await sendSelectionInfoAsync();
      break;
    }
    case 'ui-generate': {
      try {
        reportStatus('⚙️ Generating…');
        const t = await resolveFromSelectionAsync();
        if (!t) {
          post('generation-result', { format: 'md', output: '' });
          post('generation-result', { format: 'json', output: '' });
          reportStatus('⚠️ Please select a Component, Instance or Component Set.', true);
          return;
        }
        localNamesByKey = null; // names may have changed since the last run
        const props = await collectProps(t);
        const variantCount = variantCountOf(t);
        post('generation-result', { format: 'md', output: toMarkdown(t.name, variantCount, props) });
        post('generation-result', { format: 'json', output: toJSONSummary(t.name, variantCount, props) });
        reportStatus('✅ Generated.');
      } catch (e) {
        post('generation-result', { format: 'md', output: '' });
        post('generation-result', { format: 'json', output: '' });
        console.error('Generation error:', e);
        reportStatus(`❌ Error while generating: ${errorMessage(e)}`, true);
      }
      break;
    }
    case 'ui-export': {
      const content = msg.payload || '';
      // Name the file after the exported content, not the current selection
      let name = 'component-metadata';
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.name === 'string') name = parsed.name;
      } catch (_) {
        // keep the fallback name
      }
      // The UI saves the file and reports the status
      post('download', { filename: `${toFileName(name)}.json`, content });
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
