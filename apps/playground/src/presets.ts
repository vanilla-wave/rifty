/**
 * Preset programs for the playground gallery.
 *
 * Every preset here is grounded in a capability we traced through the rifty
 * source and (for REPL/fs/node-core) is covered by the e2e + conformance
 * suites — no preset demonstrates something that throws or fakes a result
 * (Hard rule: "no silent stubs"). Sources are kept short and friendly so a
 * first-time visitor can click one and immediately read what it does.
 *
 * Capability notes that shaped this menu:
 *  - REPL `require()` resolves Node core builtins (`node:path`, `util`, `fs`,
 *    events, buffer, …) but NOT bare npm specifiers (the REPL resolver roots
 *    at `/`, while shell installs land in `/workspace/node_modules`) — so we
 *    deliberately ship no "require an npm package from the REPL" preset.
 *  - A live HTTP/preview demo only works on the main thread (Dev / Real Vite),
 *    where the Service-Worker preview bridge is mounted; a Worker REPL has no
 *    `navigator.serviceWorker`, so an http-server-in-REPL preset would 503.
 *    The two "Live preview" presets cover that path honestly instead.
 */

export type PresetMode = 'repl' | 'dev' | 'real-vite';

export interface Preset {
  /** Stable id used for the active-selection highlight. */
  readonly id: string;
  /** Short gallery label. */
  readonly label: string;
  /** Grouping header in the gallery. */
  readonly category: string;
  /** Single glyph/emoji shown in the gallery tile. */
  readonly icon: string;
  /** Mode the preset runs in; selecting it transitions the mode machine. */
  readonly mode: PresetMode;
  /** One-line description shown under the label. */
  readonly blurb: string;
  /** Optional pill (e.g. "live", "~20s") shown next to the label. */
  readonly tag?: { readonly text: string; readonly tone: 'live' | 'slow' };
  /** Editor source loaded when the preset is selected. */
  readonly source: string;
}

/**
 * The default REPL program. Kept printing `worker alive` because the M1 e2e
 * ("Run button executes editor source and streams stdout") evaluates the
 * boot-time editor content and asserts that line — see tests/e2e/m1-repl.spec.ts.
 */
const WELCOME_SOURCE = `// ▶ Welcome to rifty — a Node-compatible runtime running in your browser.
// This evaluates in a Web Worker. Hit Run (top-right) and watch stdout below.

console.log('worker alive');

// Plain JS works out of the box — math, template literals, destructuring:
const area = Math.PI * 2 ** 2;
console.log(\`Circle area (r=2) = \${area.toFixed(4)}\`);

// console.error streams to stderr, just like Node:
console.error('(this line is stderr)');

// 👈 Pick a preset on the left to explore the event loop, Node core modules,
//    the virtual filesystem, a live dev server with HMR, or a real
//    \`npm install\` + Vite build.
`;

const EVENT_LOOP_SOURCE = `// rifty runs a real event loop inside the Worker.
// Predict the output order before you hit Run!

console.log('1 — sync');

// Microtask: a resolved-promise callback
Promise.resolve().then(() => console.log('2 — microtask'));

// Macrotask: a timer (fires after every microtask drains)
setTimeout(() => console.log('3 — timer'), 0);

// Another microtask, scheduled explicitly
queueMicrotask(() => console.log('4 — microtask'));

console.log('5 — sync');

// Rule: all sync code first, then the microtask queue, then timers.
`;

const NODE_CORE_SOURCE = `// rifty ships Node's core modules. require() is available in the REPL,
// and the 'node:' prefix is optional — both forms resolve identically.

const path = require('node:path');
const util = require('node:util');

// path: the full POSIX API (join, dirname, basename, extname, parse, …)
const p = path.join('/home', 'user', 'docs');
console.log('joined  :', p);
console.log('basename:', path.basename(p));
console.log('dirname :', path.dirname(p));

// util.format: printf-style %s / %d specifiers
console.log(util.format('%s has %d segments', p, p.split('/').filter(Boolean).length));

// Also bundled: events, buffer, assert, url, stream, crypto, os, and more.
`;

const FS_SOURCE = `// rifty has a full virtual filesystem. The fs module is require()'d
// (it is not a global). Everything below runs against an in-browser VFS.

const fs = require('fs');

// Create a directory tree:
fs.mkdirSync('/demo', { recursive: true });

// Write text, then read it back:
fs.writeFileSync('/demo/hello.txt', 'fs works in the browser!');
console.log('read back:', fs.readFileSync('/demo/hello.txt', 'utf8'));

// Write binary data (a Uint8Array), then list the directory:
fs.writeFileSync('/demo/data.bin', new Uint8Array([72, 105]));
console.log('dir:', fs.readdirSync('/demo').join(', '));

// Stat a file:
const st = fs.statSync('/demo/hello.txt');
console.log(\`stat: size=\${st.size}, isFile=\${st.isFile()}\`);
`;

const DEV_SOURCE = `// Dev Mode starts a Vite-like dev server (port 3000) and opens a live
// preview. This code is your app entry — written to /workspace/src/main.js
// and served to the iframe. Edit the text, save, and the preview reloads.

document.getElementById('app').textContent =
  'Hello from rifty — edit me, save, and watch the preview reload. ⚡';

document.body.style.margin = '0';
document.body.style.minHeight = '100vh';
document.body.style.display = 'grid';
document.body.style.placeItems = 'center';
document.body.style.background = '#0f1115';
document.body.style.color = '#c4f042';
document.body.style.font = '600 22px/1.4 ui-monospace, monospace';
`;

const REAL_VITE_SOURCE = `// Real Vite mode installs the ACTUAL vite@^5 from npm into a worker-local
// node_modules, boots a real Vite dev server, and previews it live.
// First run takes ~20s (npm install + boot); later runs reuse the cache.
//
// This is your app entry, served by Vite at /src/main.js.

document.getElementById('app').innerHTML =
  '<h1>Real Vite, in your browser.</h1>' +
  '<p>This page is served by an actual Vite dev server — installed from npm,' +
  ' running in a Worker, previewed through the rifty SW bridge.</p>';

document.body.style.margin = '0';
document.body.style.padding = '3rem';
document.body.style.background = '#0f1115';
document.body.style.color = '#e6e6e6';
document.body.style.fontFamily = 'ui-monospace, monospace';
`;

const WELCOME_PRESET: Preset = {
  id: 'welcome',
  label: 'Welcome',
  category: 'REPL',
  icon: '▶',
  mode: 'repl',
  blurb: 'Run JavaScript instantly in a browser-side Node-like REPL.',
  source: WELCOME_SOURCE,
};

export const PRESETS: readonly Preset[] = [
  WELCOME_PRESET,
  {
    id: 'event-loop',
    label: 'Event loop order',
    category: 'REPL',
    icon: '🔄',
    mode: 'repl',
    blurb: 'Watch sync, microtasks and timers interleave exactly like Node.',
    source: EVENT_LOOP_SOURCE,
  },
  {
    id: 'node-core',
    label: 'Node core modules',
    category: 'Node core',
    icon: '📦',
    mode: 'repl',
    blurb: "require('node:path') and friends — real built-ins, no install.",
    source: NODE_CORE_SOURCE,
  },
  {
    id: 'filesystem',
    label: 'Virtual filesystem',
    category: 'Filesystem',
    icon: '🗂️',
    mode: 'repl',
    blurb: 'Write, read and stat files with the real fs API on an in-browser VFS.',
    source: FS_SOURCE,
  },
  {
    id: 'dev-hmr',
    label: 'Dev server + HMR',
    category: 'Live preview',
    icon: '⚡',
    mode: 'dev',
    blurb: 'A Vite-like dev server with live reload, previewed in an iframe.',
    tag: { text: 'live', tone: 'live' },
    source: DEV_SOURCE,
  },
  {
    id: 'real-vite',
    label: 'Real Vite + npm',
    category: 'Live preview',
    icon: '🚀',
    mode: 'real-vite',
    blurb: 'Installs real Vite from npm and runs an actual dev server.',
    tag: { text: '~20s', tone: 'slow' },
    source: REAL_VITE_SOURCE,
  },
];

/** The preset selected at boot. Its source is the default editor content. */
export const DEFAULT_PRESET: Preset = WELCOME_PRESET;

/** Category render order in the gallery. */
export const CATEGORY_ORDER: readonly string[] = [
  'REPL',
  'Node core',
  'Filesystem',
  'Live preview',
];
