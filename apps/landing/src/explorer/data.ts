// Authoritative architecture-graph data. Ported VERBATIM from the design handoff
// (docs/landing/handoff/Rifty Architecture.dc.html). Do not paraphrase values.

export type Realm = 'page' | 'worker' | 'sw' | 'iframe' | 'ext';
export type Compat = 'ok' | 'warn' | 'no';
export type Kind = 'surface' | 'package' | 'tool' | 'runtime' | 'core' | 'io' | 'edge';
export type EdgeKind = 'import' | 'data' | 'control' | 'ipc';

export type NodeId =
  | 'playground'
  | 'sdk'
  | 'terminal'
  | 'shell'
  | 'npm'
  | 'runtimejs'
  | 'runtimewasi'
  | 'esbuild'
  | 'vite'
  | 'kernel'
  | 'sab'
  | 'vfs'
  | 'net'
  | 'httpserver'
  | 'sw'
  | 'preview'
  | 'registry';

export interface NodeDef {
  label: string;
  realm: Realm;
  compat: Compat;
  role: string;
}

export const NODES: Record<NodeId, NodeDef> = {
  playground: {
    label: 'Playground UI',
    realm: 'page',
    compat: 'ok',
    role: 'SolidJS + Monaco + xterm IDE-in-a-tab. The demo product; the only place solid-js may appear.',
  },
  sdk: {
    label: '@riftydev/sdk',
    realm: 'page',
    compat: 'ok',
    role: 'Umbrella front door. createSandbox() + a 6-feature capability probe. Framework-free.',
  },
  terminal: {
    label: 'terminal',
    realm: 'page',
    compat: 'ok',
    role: 'xterm.js wrapper — line editor, history, host-provided ghost-text completions. Dispatches to the shell.',
  },
  shell: {
    label: 'shell',
    realm: 'page',
    compat: 'ok',
    role: 'Bash-flavoured shell. Pure-JS coreutils over the VFS; .bin PATH; PTY.',
  },
  npm: {
    label: 'npm-client',
    realm: 'page',
    compat: 'ok',
    role: 'In-browser npm: semver resolve, registry fetch, gunzip + tar, SHA verify, link.',
  },
  runtimejs: {
    label: 'runtime-js',
    realm: 'worker',
    compat: 'ok',
    role: 'Node-compatible JS runtime — CJS/ESM loader + ~50 node: builtins, driven in a Worker.',
  },
  runtimewasi: {
    label: 'runtime-wasi',
    realm: 'worker',
    compat: 'ok',
    role: 'WASI preview1 runner. Runs .wasm guests against the shared VFS; kernel ProcessHandle.',
  },
  esbuild: {
    label: 'esbuild.wasm',
    realm: 'worker',
    compat: 'ok',
    role: 'Vendored 19 MB Go-compiled WASI binary — the real WASI-forcing consumer.',
  },
  vite: {
    label: 'vite dev server',
    realm: 'worker',
    compat: 'ok',
    role: 'The unmodified vite@5.4 in a Worker. Real module graph + native HMR payloads.',
  },
  kernel: {
    label: 'kernel',
    realm: 'page',
    compat: 'ok',
    role: 'Process / scheduling / IPC core. Worker-as-process over SAB + Atomics. Node-API-agnostic.',
  },
  sab: {
    label: 'SAB ring + Atomics',
    realm: 'worker',
    compat: 'ok',
    role: 'SharedArrayBuffer ring + Atomics.wait/notify — the synchronous cross-thread substrate.',
  },
  vfs: {
    label: 'virtual FS',
    realm: 'page',
    compat: 'ok',
    role: 'Memory + OPFS backends with a synchronous mirror. One filesystem, one source of truth.',
  },
  net: {
    label: 'net + port registry',
    realm: 'page',
    compat: 'ok',
    role: 'node:net/http/ws over a per-realm port registry. HTTP servers/clients, WS bridge.',
  },
  httpserver: {
    label: 'http server',
    realm: 'worker',
    compat: 'ok',
    role: 'http.createServer/listen — registers a port handler, emits request/upgrade/close.',
  },
  sw: {
    label: 'service worker',
    realm: 'sw',
    compat: 'ok',
    role: 'Preview/HMR fetch-routing bridge. Intercepts /preview/<port>/ and routes to the in-tab server.',
  },
  preview: {
    label: 'preview iframe',
    realm: 'iframe',
    compat: 'ok',
    role: 'The sandboxed preview pane. Loads /preview/<port>/; renders the in-tab server response.',
  },
  registry: {
    label: 'npmjs registry',
    realm: 'ext',
    compat: 'ok',
    role: 'The real npm registry, reached through a same-origin proxy (egress).',
  },
};

export interface CeilDef {
  id: string;
  label: string;
  compat: Compat;
  role: string;
}

// Honest ceiling — gaps that loud-throw rather than fake success. Keep visible.
export const CEIL: CeilDef[] = [
  {
    id: 'c_https',
    label: 'node:https',
    compat: 'no',
    role: 'Imports fine — every call throws. No in-browser TLS stack.',
  },
  {
    id: 'c_tcp',
    label: 'net.connect (raw TCP)',
    compat: 'no',
    role: 'Raw sockets throw. The HttpFramedSocket is HTTP-framed only.',
  },
  {
    id: 'c_native',
    label: 'native modules',
    compat: 'no',
    role: 'cpu-pinned non-WASM aborts with ENATIVEUNSUPPORTED. e.g. better-sqlite3 → use sql.js.',
  },
  {
    id: 'c_sqlite',
    label: 'node:sqlite',
    compat: 'warn',
    role: 'DatabaseSync over sql.js WASM — works, but in-memory only.',
  },
  {
    id: 'c_vm',
    label: 'node:vm',
    compat: 'warn',
    role: 'Real realm via QuickJS-WASM — about ES2023, not V8 parity.',
  },
  {
    id: 'c_drain',
    label: 'event-loop drain',
    compat: 'warn',
    role: '30s wall-clock force-kill — the one deliberate, disclosed divergence from Node.',
  },
  {
    id: 'c_preview',
    label: 'cross-realm preview',
    compat: 'warn',
    role: 'Buffered (M12). Streaming over SSE loud-throws rather than faking it.',
  },
];

export interface LayerDef {
  id: string;
  name: string;
  nodes: NodeId[];
}

export const LAYERS: LayerDef[] = [
  { id: 'playground', name: 'Playground · SDK', nodes: ['playground', 'sdk'] },
  { id: 'tools', name: 'Tools', nodes: ['terminal', 'shell', 'npm'] },
  { id: 'runtimes', name: 'Runtimes', nodes: ['runtimejs', 'runtimewasi', 'esbuild', 'vite'] },
  { id: 'kernel', name: 'Kernel', nodes: ['kernel', 'sab'] },
  { id: 'primitives', name: 'vfs / io / net', nodes: ['vfs', 'net', 'httpserver'] },
];

export interface RealmDef {
  id: Realm;
  name: string;
  sub: string;
  nodes: NodeId[];
}

export const REALMS: RealmDef[] = [
  {
    id: 'page',
    name: 'PAGE',
    sub: 'main thread · owner',
    nodes: ['playground', 'sdk', 'terminal', 'shell', 'npm', 'kernel', 'vfs', 'net', 'registry'],
  },
  {
    id: 'worker',
    name: 'WORKERS',
    sub: 'Worker-as-process',
    nodes: ['runtimejs', 'runtimewasi', 'esbuild', 'vite', 'httpserver', 'sab'],
  },
  { id: 'sw', name: 'SERVICE WORKER', sub: 'fetch router', nodes: ['sw'] },
  { id: 'iframe', name: 'PREVIEW IFRAME', sub: 'sandboxed', nodes: ['preview'] },
];

export interface EdgeDef {
  from: NodeId;
  to: NodeId;
  kind: EdgeKind;
}

// structural dependency graph (persistent edges, drawn at all times)
export const EDGES: EdgeDef[] = [
  { from: 'playground', to: 'sdk', kind: 'import' },
  { from: 'playground', to: 'terminal', kind: 'import' },
  { from: 'sdk', to: 'kernel', kind: 'control' },
  { from: 'terminal', to: 'shell', kind: 'control' },
  { from: 'shell', to: 'npm', kind: 'control' },
  { from: 'shell', to: 'vfs', kind: 'import' },
  { from: 'npm', to: 'vfs', kind: 'data' },
  { from: 'npm', to: 'registry', kind: 'data' },
  { from: 'runtimejs', to: 'kernel', kind: 'import' },
  { from: 'runtimejs', to: 'net', kind: 'import' },
  { from: 'runtimejs', to: 'vfs', kind: 'import' },
  { from: 'runtimejs', to: 'sab', kind: 'ipc' },
  { from: 'runtimewasi', to: 'kernel', kind: 'import' },
  { from: 'runtimewasi', to: 'vfs', kind: 'data' },
  { from: 'esbuild', to: 'runtimewasi', kind: 'ipc' },
  { from: 'vite', to: 'esbuild', kind: 'control' },
  { from: 'vite', to: 'net', kind: 'data' },
  { from: 'kernel', to: 'sab', kind: 'data' },
  { from: 'net', to: 'httpserver', kind: 'control' },
  { from: 'net', to: 'registry', kind: 'data' },
  { from: 'preview', to: 'sw', kind: 'data' },
  { from: 'sw', to: 'net', kind: 'ipc' },
];

export interface ScnStep {
  node: NodeId;
  t: string;
}

export interface Scenario {
  label: string;
  cmd: string;
  steps: ScnStep[];
}

export type ScenarioId = 'boot' | 'npm' | 'express' | 'vite' | 'wasi' | 'sync';

export const SCN: Record<ScenarioId, Scenario> = {
  boot: {
    label: 'Boot a sandbox',
    cmd: 'await createSandbox({ workerUrl, serviceWorkerUrl })',
    steps: [
      {
        node: 'sdk',
        t: 'createSandbox() probes capabilities — COI, SAB, OPFS-sync, Atomics, Service Worker',
      },
      { node: 'vfs', t: 'Bring up the VFS — OPFS storage, non-fatally falling back to memory' },
      { node: 'sw', t: 'Register the service worker (skippable; a failure is non-fatal)' },
      { node: 'kernel', t: 'Spawn the runtime worker over SharedArrayBuffer + Atomics' },
      { node: 'runtimejs', t: 'The worker posts ready → a live RuntimeController is returned' },
    ],
  },
  npm: {
    label: 'npm install express',
    cmd: 'npm install express',
    steps: [
      { node: 'terminal', t: 'Type npm install express in the terminal' },
      { node: 'npm', t: 'Resolve the graph — semver picks the best version per package' },
      {
        node: 'registry',
        t: 'Fetch packuments + tarballs from npmjs through the same-origin proxy',
      },
      { node: 'npm', t: 'gunzip (DecompressionStream) + JS tar extract + SHA integrity verify' },
      { node: 'vfs', t: 'Link 86 packages onto the VFS — flat-first-wins, nested on conflict' },
    ],
  },
  express: {
    label: 'Express server + live preview',
    cmd: 'node server.js',
    steps: [
      { node: 'runtimejs', t: 'node server.js runs — app.listen(3000)' },
      { node: 'net', t: 'http.createServer registers port 3000 in the port registry' },
      { node: 'preview', t: 'The preview iframe requests /preview/3000/' },
      { node: 'sw', t: 'The service worker intercepts the fetch and resolves the owning realm' },
      { node: 'httpserver', t: 'Routed to the in-tab HTTP server → Express writes the HTML' },
      { node: 'preview', t: 'Body stream transferred with CORP/COEP → the site renders live' },
    ],
  },
  vite: {
    label: 'Vite dev server + HMR',
    cmd: 'vite  (then edit src/main.js)',
    steps: [
      { node: 'playground', t: 'Edit src/main.js in Monaco and save' },
      { node: 'vite', t: 'The real vite@5.4 worker re-transforms the changed module' },
      { node: 'esbuild', t: 'esbuild.wasm bundles it; Vite computes the module-graph delta' },
      { node: 'net', t: 'HMR payload rides RFC6455 frames over the BroadcastChannel WS bridge' },
      {
        node: 'preview',
        t: '@vite/client applies the update — the module hot-swaps, state survives',
      },
    ],
  },
  wasi: {
    label: 'Run esbuild.wasm (WASI)',
    cmd: 'esbuild entry.ts --bundle',
    steps: [
      {
        node: 'shell',
        t: 'A build invokes esbuild — shadow-registry already redirected it to WASI',
      },
      { node: 'runtimewasi', t: 'createWasiProcess spawns a WASI worker (a kernel ProcessHandle)' },
      { node: 'esbuild', t: 'esbuild.wasm runs syscall-faithfully against the WASI shim' },
      { node: 'sab', t: 'Synchronous fd reads ride the SAB ring — Atomics.wait on the worker' },
      { node: 'vfs', t: 'Syscalls write through to the same VFS your JS code sees → exit 0' },
    ],
  },
  sync: {
    label: 'Synchronous fs call (SAB)',
    cmd: 'fs.readFileSync("/app.js")',
    steps: [
      { node: 'runtimejs', t: 'Guest code calls fs.readFileSync — a blocking syscall' },
      { node: 'sab', t: 'sync-client writes the request; Atomics.wait freezes the worker thread' },
      { node: 'kernel', t: 'The owner dispatcher wakes sub-millisecond via Atomics.notify' },
      { node: 'vfs', t: 'Reads the bytes from the synchronous FS mirror' },
      {
        node: 'runtimejs',
        t: 'Atomics.wait returns — the worker unblocks and returns synchronously',
      },
    ],
  },
};

export const SCN_NONE: Scenario = { label: 'Whole schema', cmd: '', steps: [] };

// second axis: WHAT a node is (orthogonal to WHERE it runs)
export const KIND_OF: Record<NodeId, Kind> = {
  playground: 'surface',
  sdk: 'package',
  terminal: 'surface',
  shell: 'tool',
  npm: 'tool',
  runtimejs: 'runtime',
  runtimewasi: 'runtime',
  esbuild: 'runtime',
  vite: 'runtime',
  kernel: 'core',
  sab: 'core',
  vfs: 'io',
  net: 'io',
  httpserver: 'io',
  sw: 'edge',
  preview: 'surface',
  registry: 'edge',
};

export interface KindDef {
  label: string;
  // inner SVG markup for a 0 0 24 24 viewBox, stroke=currentColor
  icon: string;
}

export const KINDS: Record<Kind, KindDef> = {
  surface: {
    label: 'UI surface',
    icon: '<rect x="3" y="5" width="18" height="11" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
  },
  package: {
    label: 'package · API',
    icon: '<path d="M12 3l8 4v8l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v8"/>',
  },
  tool: {
    label: 'dev tool',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  },
  runtime: {
    label: 'runtime engine',
    icon: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3"/>',
  },
  core: {
    label: 'kernel core',
    icon: '<rect x="3.5" y="3.5" width="11" height="11" rx="1.5"/><rect x="9.5" y="9.5" width="11" height="11" rx="1.5"/>',
  },
  io: {
    label: 'fs / net I/O',
    icon: '<ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
  },
  edge: {
    label: 'bridge · external',
    icon: '<path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 1 1 6 6l-1 1"/><path d="M13 18l-1 1a4 4 0 1 1-6-6l1-1"/>',
  },
};

export const REALM_COL: Record<Realm, string> = {
  page: '#7AA2FF',
  worker: '#3BD6C6',
  sw: '#B58BFF',
  iframe: '#F2B95C',
  ext: '#8A93A6',
};

export const COMPAT_COL: Record<Compat, string> = {
  ok: 'var(--ac)',
  warn: 'var(--warn)',
  no: 'var(--no)',
};

export type Pos = readonly [number, number];

// free-form layout (view 1 — Schema) — world 1120 x 640
export const DEFPOS: Record<NodeId, Pos> = {
  playground: [320, 96],
  sdk: [548, 74],
  terminal: [150, 208],
  shell: [348, 208],
  npm: [548, 208],
  registry: [980, 110],
  runtimejs: [256, 332],
  runtimewasi: [482, 332],
  esbuild: [672, 332],
  vite: [846, 332],
  sw: [998, 240],
  kernel: [348, 452],
  sab: [566, 452],
  preview: [998, 478],
  vfs: [228, 578],
  net: [472, 578],
  httpserver: [692, 578],
};

// realm-grouped layout (view 3 — Hybrid) — world 1120 x 680
export const HPOS: Record<NodeId, Pos> = {
  playground: [150, 116],
  sdk: [322, 96],
  terminal: [86, 218],
  shell: [242, 218],
  npm: [112, 304],
  registry: [302, 304],
  kernel: [196, 414],
  vfs: [102, 556],
  net: [292, 556],
  runtimejs: [492, 132],
  runtimewasi: [666, 132],
  esbuild: [492, 252],
  vite: [672, 252],
  sab: [582, 384],
  httpserver: [582, 512],
  sw: [857, 300],
  preview: [1032, 432],
};

export interface ZoneDef {
  id: Realm;
  name: string;
  sub: string;
  x: number;
  w: number;
  col: string;
}

export const ZONES: ZoneDef[] = [
  { id: 'page', name: 'PAGE', sub: 'main thread · owner', x: 0, w: 402, col: '#7AA2FF' },
  { id: 'worker', name: 'WORKERS', sub: 'Worker-as-process', x: 402, w: 368, col: '#3BD6C6' },
  { id: 'sw', name: 'SERVICE WORKER', sub: 'fetch router', x: 770, w: 175, col: '#B58BFF' },
  { id: 'iframe', name: 'PREVIEW IFRAME', sub: 'sandboxed', x: 945, w: 175, col: '#F2B95C' },
];
