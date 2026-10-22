// Mount the real plugin UI (dist/ui.html) in a Figma-style window and drive it with plugin messages.
const MD = `# Button

## Overview
- Variants: 12
- Component Properties: 5

## Component Props
[VARIANT] **Size**  
Values: L, M, S  
Default: M

[VARIANT] **State**  
Values: Default, Hover, Pressed, Disabled  
Default: Default

[BOOLEAN] **Has Left Icon**  
Values: True / False  
Default: false

[INSTANCE SWAP] **Left Icon**  
Default: icon/plus  
Preferred Instances (3): \`icon/plus\`, \`icon/arrow-left\`, \`icon/check\`

[TEXT] **Label**  
Default: Button
`;
const PRETTY = [
  { name: 'Size', type: 'VARIANT', default: 'M', values: ['L', 'M', 'S'] },
  { name: 'State', type: 'VARIANT', default: 'Default', values: ['Default', 'Hover', 'Pressed', 'Disabled'] },
  { name: 'Has Left Icon', type: 'BOOLEAN', default: false },
  { name: 'Left Icon', type: 'INSTANCE_SWAP', default: 'icon/plus', preferredInstancesCount: 3, preferredInstances: ['icon/plus', 'icon/arrow-left', 'icon/check'] },
  { name: 'Label', type: 'TEXT', default: 'Button' },
];
const JSON_OUT = JSON.stringify({
  name: 'Button',
  overview: { variantsCount: 12, componentPropsCount: 5 },
  componentProps: [
    { name: 'Size', type: 'VARIANT', defaultValue: 'M', variantOptions: ['L', 'M', 'S'] },
    { name: 'State', type: 'VARIANT', defaultValue: 'Default', variantOptions: ['Default', 'Hover', 'Pressed', 'Disabled'] },
    { name: 'Has Left Icon', type: 'BOOLEAN', defaultValue: false },
    { name: 'Left Icon', type: 'INSTANCE_SWAP', defaultValue: '10:1', defaultInstanceName: 'icon/plus', preferredValuesCount: 3, preferredInstanceNames: ['icon/plus', 'icon/arrow-left', 'icon/check'] },
    { name: 'Label', type: 'TEXT', defaultValue: 'Button' },
  ],
  pretty: { componentProps: PRETTY },
}, null, 2);

const CLOSE = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M8.5 8.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1" fill="none"/></svg>';

function pluginWindow(o) {
  const w = document.createElement('div');
  w.className = 'win' + (o.theme === 'dark' ? ' dark' : '');
  w.style.left = o.x + 'px'; w.style.top = o.y + 'px';
  w.style.transform = `scale(${o.scale || 1})`;
  w.innerHTML = `<div class="bar"><img src="../../brand/icon/icon-default-rounded.svg" alt="">Export Component Metadata<span class="x">${CLOSE}</span></div>
    <iframe src="../../../dist/ui.html" style="height:${o.height || 560}px"></iframe>`;
  document.body.appendChild(w);
  const f = w.querySelector('iframe');
  f.addEventListener('load', () => {
    const d = f.contentDocument, win = f.contentWindow;
    d.documentElement.classList.add(o.theme === 'dark' ? 'figma-dark' : 'figma-light');
    const st = d.createElement('style');
    const font = (w) => new URL(`inter-latin-${w}-normal.woff`, document.baseURI); // resolve from this page, not the iframe
    st.textContent = `@font-face{font-family:Inter;font-weight:400;src:url(${font(500)})}
      @font-face{font-family:Inter;font-weight:500;src:url(${font(500)})}
      @font-face{font-family:Inter;font-weight:600;src:url(${font(600)})}
      :root{--font-family:Inter}` + (o.css || '');
    d.head.appendChild(st);
    const send = (m) => win.postMessage({ pluginMessage: m }, '*');
    send({ type: 'scan-all-result', setCount: 24, componentCount: 3 });
    if (o.state === 'empty') {
      send({ type: 'selection-info', name: 'No selection detected', variantCount: 0, propsCount: 0 });
    } else {
      send({ type: 'selection-info', name: 'Button', variantCount: 12, propsCount: 5 });
      send({ type: 'generation-result', format: 'md', output: MD });
      send({ type: 'generation-result', format: 'json', output: JSON_OUT });
      send({ type: 'status', message: o.status || '✅ Generated.' });
    }
    if (o.format === 'json') setTimeout(() => d.querySelector('fig-segment[value="json"]').click(), 60);
    if (o.exportAll) setTimeout(() => {
      d.getElementById('includeHidden')?.toggleAttribute('checked', !!o.hidden);
      d.getElementById(o.exportAll === 'json' ? 'exportAllJsonBtn' : 'exportAllMdBtn').click();
      setTimeout(() => send({ type: 'export-all-progress', current: 18, total: 27, name: 'Text Field' }), 60);
    }, 120);
  });
  return w;
}
