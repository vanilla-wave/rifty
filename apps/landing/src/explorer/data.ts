// Authoritative live architecture-graph data. Layout descends from the frozen
// design handoff; runtime copy follows the current public contracts.

export type Realm = 'page' | 'worker' | 'sw' | 'iframe' | 'ext';
export type Compat = 'ok' | 'warn' | 'no';
export type Kind = 'surface' | 'package' | 'tool' | 'runtime' | 'core' | 'io' | 'edge';
export type EdgeKind = 'import' | 'data' | 'control' | 'ipc';

export type NodeId =
  | 'playground'
  | 'workbench'
  | 'owner'
  | 'sdk'
  | 'sandboxvfs'
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
    role: 'SolidJS + Monaco + xterm IDE-in-a-tab. UI policy only; runtime authority lives behind Workbench.',
  },
  workbench: {
    label: '@riftydev/workbench',
    realm: 'page',
    compat: 'ok',
    role: 'Framework-free project, session, run, file, document, terminal and preview API.',
  },
  owner: {
    label: 'workspace owner',
    realm: 'worker',
    compat: 'ok',
    role: 'One owner Worker holds project, VFS, package, PTY and preview-producer state and supervises child Workers.',
  },
  sdk: {
    label: '@riftydev/sdk',
    realm: 'page',
    compat: 'ok',
    role: 'Umbrella front door. createSandbox() + a 6-feature capability probe. Framework-free.',
  },
  sandboxvfs: {
    label: 'standalone VFS init',
    realm: 'page',
    compat: 'ok',
    role: 'createSandbox() attempts caller-realm VFS init. PAGE callers fall back to memory because sync OPFS is Worker-only; the runtime Worker owns a separate backend.',
  },
  terminal: {
    label: 'terminal',
    realm: 'page',
    compat: 'ok',
    role: 'xterm.js wrapper — line editor, history, host-provided ghost-text completions. Dispatches through Workbench.',
  },
  shell: {
    label: 'shell',
    realm: 'worker',
    compat: 'ok',
    role: 'Bash-flavoured shell. Pure-JS coreutils over the VFS; .bin PATH; PTY.',
  },
  npm: {
    label: 'npm-client',
    realm: 'worker',
    compat: 'ok',
    role: 'In-browser npm: semver resolve, registry fetch, gunzip + tar, SHA verify, link.',
  },
  runtimejs: {
    label: 'runtime-js',
    realm: 'worker',
    compat: 'ok',
    role: 'Node-compatible JS runtime — CJS/ESM loader plus tested node: builtin subsets, driven in a Worker.',
  },
  runtimewasi: {
    label: 'runtime-wasi',
    realm: 'worker',
    compat: 'ok',
    role: 'Raw WASI preview1 runner. runWasi stays in-realm; createWasiProcess kernel-spawns a Worker with process-shaped stdio/exit and configured preopens.',
  },
  esbuild: {
    label: 'esbuild JS API',
    realm: 'worker',
    compat: 'warn',
    role: "npm esbuild@0.28.0 transform APIs use the registry-attested esbuild-wasm adapter. The esbuild CLI/bin throws NotImplementedError('esbuild.cli').",
  },
  vite: {
    label: 'vite dev server',
    realm: 'worker',
    compat: 'ok',
    role: 'Exact Vite 7.3.6 dev + HMR; opt-in Vite 8.0.16 dev/build/preview uses Rolldown with HMR disabled.',
  },
  kernel: {
    label: 'kernel',
    realm: 'worker',
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
    realm: 'worker',
    compat: 'ok',
    role: 'Memory + OPFS backends with sync mirrors. Standalone Workers use realm-local state; Workbench children reach the owner VFS through sync IPC.',
  },
  net: {
    label: 'net + port registry',
    realm: 'worker',
    compat: 'ok',
    role: 'node:net/http/ws over realm-local virtual port registries, with cross-realm bind claims and preview/loopback bridges.',
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
    role: 'Preview fetch-routing bridge. Intercepts /preview/<port>/ and routes to the in-tab server.',
  },
  preview: {
    label: 'preview iframe',
    realm: 'iframe',
    compat: 'ok',
    role: 'The sandboxed preview pane. Loads /preview/<port>/; renders the in-tab server response.',
  },
  registry: {
    label: 'registry proxy',
    realm: 'ext',
    compat: 'ok',
    role: 'npm egress through a configured CORS/CORP registry proxy; local development uses a same-origin path.',
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
    compat: 'warn',
    role: 'https.request/get use browser-validated fetch. TLS servers, custom Agents, and certificate controls throw loudly.',
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
    role: 'DatabaseSync subset over sql.js WASM — in-memory only.',
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
    role: '30s wall-clock force-kill — a deliberate, disclosed divergence from Node.',
  },
  {
    id: 'c_preview',
    label: 'cross-realm preview',
    compat: 'warn',
    role: 'Page preview buffers finite bodies; unbounded SSE/NDJSON fails loudly. Service-to-service loopback streams live.',
  },
];

export interface LayerDef {
  id: string;
  name: string;
  nodes: NodeId[];
}

export const LAYERS: LayerDef[] = [
  { id: 'playground', name: 'Playground', nodes: ['playground'] },
  {
    id: 'workbench',
    name: 'Workbench · SDK',
    nodes: ['workbench', 'owner', 'sdk', 'sandboxvfs'],
  },
  { id: 'tools', name: 'Tools', nodes: ['terminal', 'shell', 'npm'] },
  { id: 'runtimes', name: 'Runtimes', nodes: ['runtimejs', 'runtimewasi', 'esbuild', 'vite'] },
  { id: 'kernel', name: 'Kernel', nodes: ['kernel', 'sab'] },
  {
    id: 'primitives',
    name: 'vfs / io / net',
    nodes: ['sandboxvfs', 'vfs', 'net', 'httpserver'],
  },
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
    sub: 'UI · public façades',
    nodes: ['playground', 'workbench', 'sdk', 'sandboxvfs', 'terminal'],
  },
  {
    id: 'worker',
    name: 'WORKERS',
    sub: 'owner · supervised children',
    nodes: [
      'owner',
      'shell',
      'npm',
      'kernel',
      'vfs',
      'net',
      'runtimejs',
      'runtimewasi',
      'esbuild',
      'vite',
      'httpserver',
      'sab',
    ],
  },
  { id: 'sw', name: 'SERVICE WORKER', sub: 'fetch router', nodes: ['sw'] },
  { id: 'iframe', name: 'PREVIEW IFRAME', sub: 'sandboxed', nodes: ['preview'] },
  { id: 'ext', name: 'EXTERNAL', sub: 'configured egress', nodes: ['registry'] },
];

export interface EdgeDef {
  from: NodeId;
  to: NodeId;
  kind: EdgeKind;
}

// Selected runtime topology (persistent edges, drawn at all times).
export const EDGES: EdgeDef[] = [
  { from: 'playground', to: 'workbench', kind: 'import' },
  { from: 'terminal', to: 'workbench', kind: 'control' },
  { from: 'workbench', to: 'owner', kind: 'ipc' },
  { from: 'sdk', to: 'sandboxvfs', kind: 'data' },
  { from: 'sdk', to: 'sw', kind: 'control' },
  { from: 'sdk', to: 'runtimejs', kind: 'control' },
  { from: 'owner', to: 'shell', kind: 'control' },
  { from: 'owner', to: 'npm', kind: 'control' },
  { from: 'owner', to: 'kernel', kind: 'control' },
  { from: 'owner', to: 'vfs', kind: 'data' },
  { from: 'owner', to: 'net', kind: 'control' },
  { from: 'workbench', to: 'net', kind: 'data' },
  { from: 'shell', to: 'npm', kind: 'control' },
  { from: 'shell', to: 'vfs', kind: 'import' },
  { from: 'npm', to: 'vfs', kind: 'data' },
  { from: 'npm', to: 'registry', kind: 'data' },
  { from: 'kernel', to: 'runtimejs', kind: 'control' },
  { from: 'kernel', to: 'runtimewasi', kind: 'control' },
  { from: 'runtimejs', to: 'owner', kind: 'ipc' },
  { from: 'runtimejs', to: 'net', kind: 'data' },
  { from: 'runtimejs', to: 'vfs', kind: 'data' },
  { from: 'runtimejs', to: 'sab', kind: 'ipc' },
  { from: 'runtimewasi', to: 'vfs', kind: 'data' },
  { from: 'vite', to: 'esbuild', kind: 'control' },
  { from: 'vite', to: 'net', kind: 'data' },
  { from: 'net', to: 'preview', kind: 'ipc' },
  { from: 'sab', to: 'owner', kind: 'ipc' },
  { from: 'net', to: 'httpserver', kind: 'control' },
  { from: 'preview', to: 'sw', kind: 'data' },
  { from: 'sw', to: 'workbench', kind: 'ipc' },
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
        t: 'createSandbox() probes COI, SAB, Atomics.waitAsync, OPFS sync access, Service Worker and Worker',
      },
      {
        node: 'sandboxvfs',
        t: 'Attempt caller-realm VFS init; PAGE falls back to memory because sync OPFS is Worker-only',
      },
      { node: 'sw', t: 'Register the service worker (skippable; a failure is non-fatal)' },
      {
        node: 'runtimejs',
        t: 'Spawn a dedicated runtime Worker; return Sandbox while Sandbox.runtime reports its lifecycle',
      },
    ],
  },
  npm: {
    label: 'npm install express',
    cmd: 'npm install express',
    steps: [
      { node: 'terminal', t: 'Submit npm install express through the Workbench terminal' },
      { node: 'owner', t: 'The workspace owner executes the shell command' },
      { node: 'npm', t: 'Resolve the graph — semver picks the best version per package' },
      {
        node: 'registry',
        t: 'Fetch packuments + tarballs through the configured CORS/CORP registry proxy',
      },
      { node: 'npm', t: 'gunzip (DecompressionStream) + JS tar extract + SHA integrity verify' },
      {
        node: 'vfs',
        t: 'Link the resolved dependency tree onto the VFS — flat-first-wins, nested on conflict',
      },
    ],
  },
  express: {
    label: 'Express server + live preview',
    cmd: 'node server.js',
    steps: [
      { node: 'runtimejs', t: 'node server.js runs in a supervised child — app.listen(3000)' },
      { node: 'net', t: 'http.createServer publishes port 3000 to the virtual port registry' },
      { node: 'preview', t: 'The preview iframe requests /preview/3000/' },
      {
        node: 'sw',
        t: 'The service worker intercepts the fetch and resolves the current page registration',
      },
      {
        node: 'workbench',
        t: 'The page-side Workbench preview bridge routes the request to the child HTTP server',
      },
      { node: 'httpserver', t: 'Express writes the finite HTML response' },
      {
        node: 'preview',
        t: 'The Worker/page bridge buffers the finite body; the Service Worker returns it to the iframe',
      },
    ],
  },
  vite: {
    label: 'Vite dev server + HMR',
    cmd: 'vite  (then edit src/main.js)',
    steps: [
      { node: 'playground', t: 'Edit src/main.js in Monaco and save' },
      { node: 'vite', t: 'The real Vite 7 worker re-transforms the changed module' },
      {
        node: 'esbuild',
        t: 'Vite 7 uses the registry-attested esbuild JS adapter; there is no host WASM URL',
      },
      { node: 'net', t: 'HMR payload rides RFC6455 frames over the BroadcastChannel WS bridge' },
      {
        node: 'preview',
        t: '@vite/client applies the update — the module hot-swaps, state survives',
      },
    ],
  },
  wasi: {
    label: 'Run a raw WASI guest',
    cmd: 'createWasiProcess({ wasm })',
    steps: [
      {
        node: 'runtimewasi',
        t: 'createWasiProcess receives raw wasi_snapshot_preview1 module bytes',
      },
      {
        node: 'kernel',
        t: 'The kernel spawns a WASI Worker and returns its ProcessHandle',
      },
      {
        node: 'runtimewasi',
        t: 'The Worker instantiates the guest with wasi_snapshot_preview1 imports',
      },
      {
        node: 'vfs',
        t: "Guest syscalls use that Worker's realm-local synchronous mirror and supplied preopen mappings",
      },
      {
        node: 'runtimewasi',
        t: 'stdout, stderr and the honest exit code propagate through ProcessHandle',
      },
    ],
  },
  sync: {
    label: 'Workbench child sync fs',
    cmd: 'fs.readFileSync("/app.js")',
    steps: [
      { node: 'runtimejs', t: 'A supervised child calls fs.readFileSync — a blocking syscall' },
      { node: 'sab', t: 'The remote sync client writes a SAB request and waits with Atomics.wait' },
      {
        node: 'owner',
        t: 'The owner dispatcher handles the request and replies with Atomics.notify',
      },
      { node: 'vfs', t: 'The owner VFS reads and returns the bytes' },
      {
        node: 'runtimejs',
        t: 'Atomics.wait returns; the child unblocks and returns synchronously',
      },
    ],
  },
};

export const SCN_NONE: Scenario = { label: 'Whole schema', cmd: '', steps: [] };

// second axis: WHAT a node is (orthogonal to WHERE it runs)
export const KIND_OF: Record<NodeId, Kind> = {
  playground: 'surface',
  workbench: 'package',
  owner: 'core',
  sdk: 'package',
  sandboxvfs: 'io',
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
    label: 'coordination core',
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

// free-form layout (view 1 — Schema) — world 1180 x 680
export const DEFPOS: Record<NodeId, Pos> = {
  playground: [140, 100],
  workbench: [390, 85],
  sdk: [610, 85],
  sandboxvfs: [830, 85],
  terminal: [140, 225],
  registry: [1080, 210],
  owner: [390, 210],
  shell: [610, 210],
  npm: [830, 210],
  runtimejs: [150, 350],
  runtimewasi: [370, 350],
  esbuild: [590, 350],
  vite: [810, 350],
  sw: [1070, 310],
  kernel: [250, 480],
  sab: [470, 480],
  net: [700, 480],
  httpserver: [900, 480],
  vfs: [470, 620],
  preview: [1060, 600],
};

// realm-grouped layout (view 3 — Hybrid) — world 1180 x 720
export const HPOS: Record<NodeId, Pos> = {
  playground: [135, 110],
  workbench: [90, 225],
  terminal: [180, 300],
  sdk: [90, 390],
  sandboxvfs: [180, 480],
  owner: [395, 105],
  kernel: [635, 105],
  vfs: [395, 200],
  sab: [635, 200],
  shell: [395, 295],
  npm: [635, 295],
  runtimejs: [395, 390],
  runtimewasi: [635, 390],
  esbuild: [395, 485],
  vite: [635, 485],
  net: [395, 580],
  httpserver: [635, 580],
  sw: [810, 335],
  preview: [955, 430],
  registry: [1110, 230],
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
  { id: 'page', name: 'PAGE', sub: 'UI · public façades', x: 0, w: 270, col: '#7AA2FF' },
  {
    id: 'worker',
    name: 'WORKERS',
    sub: 'owner · supervised children',
    x: 270,
    w: 480,
    col: '#3BD6C6',
  },
  { id: 'sw', name: 'SERVICE WORKER', sub: 'fetch router', x: 750, w: 120, col: '#B58BFF' },
  { id: 'iframe', name: 'PREVIEW IFRAME', sub: 'sandboxed', x: 870, w: 170, col: '#F2B95C' },
  { id: 'ext', name: 'EXTERNAL', sub: 'configured egress', x: 1040, w: 140, col: '#8A93A6' },
];
