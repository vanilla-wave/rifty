// Graph node elements. Plain nodes = .exp-node pills (realm left-border, realm
// dot + kind icon, label + kind sublabel). Rich nodes: playground = mini
// code-editor card, preview = localhost:3000 browser card. Both per-scenario.

import { KINDS, KIND_OF, NODES, type NodeId, REALM_COL, type ScenarioId } from './data';

export const RICH_NODES: ReadonlySet<NodeId> = new Set<NodeId>(['playground', 'preview']);

function kindSvg(paths: string, size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// per-scenario surface content for the two rich nodes (editor + preview body).
interface Surface {
  file: string;
  code: string;
  pv: string;
}

const SURF: Record<ScenarioId, Surface> = {
  express: {
    file: 'server.js',
    code:
      '<span style="color:var(--syn-kw)">const</span> app = <span style="color:var(--syn-fn)">express</span>()\n' +
      'app.<span style="color:var(--syn-fn)">get</span>(<span style="color:var(--syn-str)">\'/\'</span>, (req, res) =>\n' +
      '  res.<span style="color:var(--syn-fn)">send</span>(<span style="color:var(--syn-str)">\'It works.\'</span>))\n' +
      'app.<span style="color:var(--syn-fn)">listen</span>(<span style="color:var(--syn-num)">3000</span>)',
    pv:
      '<div style="font-weight:700; font-size:14px;">It works.</div>' +
      '<div style="font-size:9.5px; color:#4b5563; margin-top:3px;">Served by Express · in this tab</div>',
  },
  vite: {
    file: 'main.js',
    code:
      '<span style="color:var(--syn-kw)">import</span> <span style="color:var(--syn-str)">\'./style.css\'</span>\n' +
      '<span style="color:var(--syn-kw)">export function</span> <span style="color:var(--syn-fn)">App</span>() {\n' +
      '  count++\n' +
      '  <span style="color:var(--syn-kw)">return</span> <span style="color:var(--syn-str)">`Counter: ${count}`</span>\n}',
    pv:
      '<div style="font-weight:700; font-size:14px;">Counter: 3</div>' +
      '<div style="font-size:9.5px; color:#15803d; margin-top:3px;">● HMR applied · state kept</div>',
  },
  wasi: {
    file: 'build.sh',
    code:
      '<span style="color:var(--syn-com)">$</span> esbuild entry.ts \\\n' +
      '  --bundle --outfile=out.js\n' +
      '<span style="color:#8FD98F">✓</span> built 41ms <span style="color:var(--syn-com)">(WASI)</span>',
    pv:
      '<div style="font-weight:700; font-size:13px;">out.js · 18 kb</div>' +
      '<div style="font-size:9.5px; color:#4b5563; margin-top:3px;">esbuild.wasm bundled in-tab</div>',
  },
  boot: {
    file: 'sandbox.js',
    code:
      '<span style="color:var(--syn-kw)">const</span> box = <span style="color:var(--syn-kw)">await</span>\n' +
      '  <span style="color:var(--syn-fn)">createSandbox</span>({\n' +
      '    workerUrl,\n    serviceWorkerUrl })',
    pv:
      '<div style="font-size:12px; color:#374151;">createSandbox()</div>' +
      '<div style="font-size:9.5px; color:#4b5563; margin-top:3px;">Sandbox returned · runtime boots asynchronously</div>',
  },
  npm: {
    file: 'package.json',
    code:
      '{\n  <span style="color:var(--syn-str)">"dependencies"</span>: {\n' +
      '    <span style="color:var(--syn-str)">"express"</span>: <span style="color:var(--syn-str)">"^4"</span>\n  } }',
    pv:
      '<div style="font-size:12px; color:#15171D; font-weight:600;">node_modules/</div>' +
      '<div style="font-size:9.5px; color:#4b5563; margin-top:3px;">Dependencies linked to the VFS</div>',
  },
  sync: {
    file: 'app.js',
    code:
      '<span style="color:var(--syn-kw)">const</span> buf =\n' +
      '  fs.<span style="color:var(--syn-fn)">readFileSync</span>(\n' +
      '    <span style="color:var(--syn-str)">\'/app.js\'</span>)\n' +
      '<span style="color:var(--syn-com)">// blocks via SAB</span>',
    pv:
      '<div style="font-weight:700; font-size:13px;">It works.</div>' +
      '<div style="font-size:9.5px; color:#4b5563; margin-top:3px;">sync fs over SharedArrayBuffer</div>',
  },
};

function editorShell(rc: string): string {
  const surfIcon = kindSvg(KINDS.surface.icon, 13);
  return `<div class="exp-rich-bar"><span class="exp-lights"><span class="exp-light" style="background:#FF5F57"></span><span class="exp-light" style="background:#FEBC2E"></span><span class="exp-light" style="background:#28C840"></span></span><span class="exp-ed-file" data-ed-file>server.js</span><span class="exp-ed-ico" style="color:${rc}">${surfIcon}</span></div><div class="exp-ed-body"><div class="exp-ed-title">Playground · editor</div><pre class="exp-ed-code" data-ed-code></pre></div>`;
}

function previewShell(): string {
  return (
    '<div class="exp-rich-bar exp-pv-bar">' +
    '<span class="exp-lights"><span class="exp-light exp-light-sm"></span>' +
    '<span class="exp-light exp-light-sm"></span></span>' +
    '<span class="exp-pv-url">localhost:3000</span>' +
    '</div>' +
    '<div class="exp-pv-body" data-pv-body></div>'
  );
}

export interface NodeHandlers {
  onPointerDown: (id: NodeId, e: PointerEvent) => void;
  onEnter: (id: NodeId) => void;
  onLeave: (id: NodeId) => void;
  onClick: (id: NodeId) => void;
}

// Build a single graph node element (plain pill or rich card).
export function createNodeEl(id: NodeId, handlers: NodeHandlers): HTMLDivElement {
  const meta = NODES[id];
  const rc = REALM_COL[meta.realm];
  const kind = KINDS[KIND_OF[id]];
  const el = document.createElement('div');
  el.className = 'exp-node';
  el.setAttribute('data-node', id);
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', meta.label);
  el.setAttribute('aria-pressed', 'false');
  el.style.setProperty('--rc', rc);

  if (RICH_NODES.has(id)) {
    el.classList.add('exp-node-rich');
    el.classList.add(id === 'playground' ? 'exp-node-editor' : 'exp-node-preview');
    el.innerHTML = id === 'playground' ? editorShell(rc) : previewShell();
  } else {
    el.classList.add('exp-node-pill');
    el.innerHTML = `<span class="exp-node-ico" style="color:${rc}; background:rgb(from ${rc} r g b / 0.12)">${kindSvg(kind.icon, 15)}</span><span class="exp-node-txt"><span class="exp-node-label">${meta.label}</span><span class="exp-node-kind">${kind.label}</span></span>`;
  }

  el.addEventListener('pointerdown', (e) => handlers.onPointerDown(id, e));
  el.addEventListener('pointerenter', () => handlers.onEnter(id));
  el.addEventListener('pointerleave', () => handlers.onLeave(id));
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onClick(id);
  });
  el.addEventListener('keydown', (e) => {
    if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.stopPropagation();
    handlers.onClick(id);
  });
  return el;
}

// Update the per-scenario surfaces (editor file/code + preview body).
export function updateSurfaces(world: HTMLElement, scn: ScenarioId | 'none'): void {
  const surf = scn === 'none' ? SURF.express : SURF[scn];
  const ed = world.querySelector<HTMLElement>('[data-node="playground"]');
  if (ed) {
    const f = ed.querySelector<HTMLElement>('[data-ed-file]');
    if (f) f.textContent = surf.file;
    const c = ed.querySelector<HTMLElement>('[data-ed-code]');
    if (c) c.innerHTML = surf.code;
  }
  const pv = world.querySelector<HTMLElement>('[data-node="preview"] [data-pv-body]');
  if (pv) pv.innerHTML = surf.pv;
}
