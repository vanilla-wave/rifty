// Authoritative live architecture-graph data. Layout descends from the frozen
// design handoff; runtime copy follows the current public contracts.

export type Realm = 'page' | 'worker' | 'sw' | 'iframe' | 'ext';
export type Compat = 'ok' | 'warn' | 'no';
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
    role: "Generic createSandbox() selects the caller-realm VFS backend: PAGE callers get memory because sync OPFS is Worker-only; vfs.reason appears only on a real OPFS init failure. The runtime Worker owns its own backend; the no-COI toolchain tier skips page init and reports that Worker's backend.",
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
    role: "The same-origin preview pane. Loads /preview/<port>/ through the page's Service Worker and renders the in-tab server response.",
  },
  registry: {
    label: 'registry proxy',
    realm: 'ext',
    compat: 'ok',
    role: 'npm egress through a configured CORS/CORP registry proxy; local development uses a same-origin path.',
  },
};

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
  { id: 'iframe', name: 'PREVIEW IFRAME', sub: 'same-origin', nodes: ['preview'] },
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
        t: 'Select the caller-realm VFS backend; PAGE gets memory because sync OPFS is Worker-only',
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
      {
        node: 'net',
        t: "HMR payload crosses the BroadcastChannel WS bridge as decoded messages; RFC6455 framing stays in-Worker between Vite's ws server and the virtual upgrade socket",
      },
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

export const REALM_COL: Record<Realm, string> = {
  page: '#7AA2FF',
  worker: '#3BD6C6',
  sw: '#B58BFF',
  iframe: '#F2B95C',
  ext: '#8A93A6',
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
  { id: 'iframe', name: 'PREVIEW IFRAME', sub: 'same-origin', x: 870, w: 170, col: '#F2B95C' },
  { id: 'ext', name: 'EXTERNAL', sub: 'configured egress', x: 1040, w: 140, col: '#8A93A6' },
];
