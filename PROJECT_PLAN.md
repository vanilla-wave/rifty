# WebContainer Clone — Project Plan

> Educational pet project: browser-based Node-compatible runtime + WASI runner for native binaries. Goal — deep understanding of how these systems work, a path to "Express + npm install in the browser" within ~a year of evening work.

---

## 1. Goals and non-goals

### Goals
- Understand how WebContainers/StackBlitz-like systems work under the hood
- Get a working runtime capable of running real Node programs (Express, CLI tools in pure JS)
- Level up architectural skills: layers, isolation, contracts, system API emulation
- Learn WASI as a separate module (running esbuild/sqlite — real WASI binaries; `@esbuild/wasi-preview1` imports only `wasi_snapshot_preview1` — see ADR-0047, reverses ADR-0044)
- Keep a devlog — a series of deep technical articles

### Non-goals (at least for the first year)
- Full Node compatibility (that's an endless path)
- Native module support via node-gyp
- Production-ready performance
- All-browser support (targeting fresh Chrome/Edge — need OPFS SyncAccessHandle in Workers)
- Own JS engine (using the browser's V8)

---

## 2. Architecture: core principles

### Strategic decisions
1. **Browser V8 as the primary JS engine** — the StackBlitz approach. Performance and tooling are incomparably better than QuickJS-in-WASM.
2. **WASI — a separate runtime for native binaries**, not for primary JS execution. Useful for esbuild/sqlite/python (esbuild publishes a real WASIp1 build `@esbuild/wasi-preview1` — see ADR-0047, reverses ADR-0044; Go-bridge `gojs` deferred for future Go guests, but no longer needed for esbuild).
3. **Web Workers as processes.** Each Node "process" = a separate Worker with its own JS context.
4. **Service Worker for virtual networking.** Intercepts fetch, routes to "listening" workers.
5. **OPFS (Origin Private File System) — primary storage backend** for VFS. Provides sync API in Workers via `FileSystemSyncAccessHandle`.
6. **VFS as a clean interface**, in-memory backend for tests and dev, OPFS for production.

### Layers
```
┌─────────────────────────────────────────┐
│  apps/playground  (UI: editor + term)   │
├─────────────────────────────────────────┤
│  shell, terminal, npm-client            │  ← high-level features
├─────────────────────────────────────────┤
│  runtime-js (Node API)  runtime-wasi    │  ← language runtimes
├─────────────────────────────────────────┤
│  kernel (processes, scheduling, IPC)    │  ← core
├─────────────────────────────────────────┤
│  vfs   io   net (+ service-worker)      │  ← system primitives
└─────────────────────────────────────────┘
```

**Dependency rule:** top-down only. No reverse imports. Each layer has a public API in `index.ts`.

**UI isolation rule (D-002):** UI framework is used only in `apps/playground/`. All packages in `packages/` are framework-agnostic. This allows replacing the UI without rewriting the core.

### Isolation and contexts
- **Main thread:** UI, process orchestrator, Process Manager (PID table), SW management
- **Web Worker (per process):** runtime-js + user code + its modules
- **Service Worker:** fetch interceptor, RPC router between requests and workers
- **(Optionally later) iframe:** app preview, safe rendering of user HTML

### Communication channels
- Main ↔ Worker: `MessageChannel` for async, `SharedArrayBuffer` + `Atomics` for synchronous calls (see D-001)
- Worker ↔ Worker (pipes): `MessageChannel` directly via `Transferable`
- Main ↔ Service Worker: `postMessage` + `MessageChannel`
- Browser → SW → Worker: fetch is intercepted, serialized into an RPC request, response returned via ReadableStream

### Environment requirement: cross-origin isolation
The playground page must be in `crossOriginIsolated === true` state (see **D-001**). This provides `SharedArrayBuffer` and `Atomics.wait` in Workers — the foundation for sync IPC (needed in M6+). All resources (xterm, Monaco, fonts) are local or have correct CORP headers. Third-party CDNs are proxied through own origin when needed.

---

## 3. Repository structure

```
webcontainer-clone/
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json                    # linting + formatting (or eslint+prettier)
├── vitest.workspace.ts
├── playwright.config.ts
├── README.md
├── CLAUDE.md                     # ⚡ instructions for the AI agent (see §6)
│
├── docs/
│   ├── adr/                      # Architecture Decision Records
│   │   ├── 0001-monorepo-pnpm.md
│   │   ├── 0002-opfs-as-primary-backend.md
│   │   └── ...
│   ├── devlog/                   # posts per milestone
│   └── compat/                   # compatibility matrix (generated from tests)
│
├── packages/
│   ├── vfs/                      # FS interface + backends
│   │   ├── src/
│   │   │   ├── types.ts          # VFS interface
│   │   │   ├── memory.ts         # in-memory backend
│   │   │   ├── opfs.ts           # OPFS backend
│   │   │   └── index.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── io/                       # streams, pipes, stdio abstractions
│   ├── kernel/                   # process manager, PID, signals, scheduling
│   ├── runtime-js/               # Node-compatible runtime on top of V8
│   │   ├── src/
│   │   │   ├── worker-entry.ts   # Worker entry point
│   │   │   ├── module-loader/    # CJS + ESM resolver
│   │   │   ├── globals/          # process, Buffer, console
│   │   │   ├── builtins/         # node:fs, node:path, node:http, ...
│   │   │   └── event-loop/       # nextTick, timers, microtasks
│   │   └── ...
│   ├── runtime-wasi/             # WASI preview1 shim
│   │   ├── src/
│   │   │   ├── shim.ts
│   │   │   ├── syscalls/
│   │   │   └── preopens.ts
│   │   └── ...
│   ├── net/                      # net.Socket, net.Server, http
│   ├── service-worker/           # SW: fetch interceptor, port registry
│   ├── npm-client/               # resolver, fetcher, unpacker, linker
│   ├── shell/                    # minimal bash-like shell
│   └── terminal/                 # xterm.js glue, PTY abstraction
│
├── apps/
│   ├── playground/               # main UI
│   └── benchmarks/               # benchmark harness
│
├── examples/                     # fixtures for the test-driven approach
│   ├── hello-c/                  # minimal WASI binary
│   ├── express-hello/            # target of milestone M7
│   ├── npm-pkg-fixtures/         # real packages (chalk, commander, ...)
│   └── vite-app/                 # target of M10
│
├── tools/
│   ├── shadow-registry/          # drop-in WASM builds of native packages
│   ├── registry-proxy/           # CORS proxy for npm registry (dev)
│   └── node-parity-runner/       # ⚡ runs code in real Node and in our runtime, diffs results (see §5)
│
└── tests/
    ├── conformance/              # ⚡ key Node API conformance tests
    │   ├── fs/
    │   ├── path/
    │   ├── http/
    │   └── ...
    ├── integration/              # running real npm packages
    ├── e2e/                      # playwright against playground
    └── harness/                  # utilities: parity-runner, diff, snapshot
```

### Conventions
- Each package in `packages/` exports via `src/index.ts`. Direct imports from `src/internal/*` are forbidden externally.
- Each package has a `README.md` describing the public API and a `CHANGELOG.md`.
- Tests co-located with code (`*.test.ts`) for unit, separate `tests/` folder for integration.
- TypeScript strict mode everywhere, `noUncheckedIndexedAccess: true`.
- No circular dependencies (enforced by `madge` in CI).

---

## 4. Roadmap and milestones

Structure: **milestone = group of stages ending with a demonstrable result**. Each milestone has an acceptance scenario (acceptance criteria) — what the test checks and what you can see with your eyes.

| # | Milestone | What works | Time |
|---|---|---|---|
| M0 | Foundation | Monorepo, UI, terminal, empty Worker, empty SW | 1-2 wks |
| M1 | JS Execution | `console.log('hi')` in Worker, REPL in xterm | 1-2 wks |
| M2 | Modules | `require('./other')` works, CJS + basic ESM | 2-3 wks |
| M3 | Node Core | process, timers, event loop, basic built-ins | 3-4 wks |
| M4 | FileSystem | fs API, OPFS backend, sync & async | 3-4 wks |
| M5 | Streams & IO | Streams work, pipes between processes | 2-3 wks |
| M6 | Processes | child_process.spawn, process tree, IPC | 3-4 wks |
| M7 | Network | net + http, Service Worker bridge, Express runs | 4-5 wks |
| M8 | WASI Runner | esbuild.wasm runs as a process via `@esbuild/wasi-preview1` (ADR-0047, reverses ADR-0044) | 2-3 wks |
| M9 | npm install | Real package installation from registry | 3-4 wks |
| M10 | Real Tooling | Vite-like dev server in browser; real express@4 + vite@5 run in-process (✅ ADR-0050) | 4-6 wks |
| M11 | post-M10 follow-ups | Vite-in-Worker (ADR-0043 ✅), nested install (ADR-0042 ✅), fork-IPC via Worker (ADR-0045 ✅), SW→Worker direct routing (A-023 / Q-2026-05-27-002), streaming cross-realm preview, lockfile reuse, esbuild.wasm vendoring (✅ ADR-0047), native-dep install policy (✅ ADR-0051) | 2-3 wks |
| M12 | opencode server facade (proposed) | Running anomalyco/opencode as a headless Effect server in rifty up to the tool-execution ceiling. **No-vendored-tree slice implemented and green** (TS-on-import ✅ ADR-0052/0053; Effect↔node:http ✅ ADR-0054; SSE-over-HTTP ✅ ADR-0055; F09 tool-ceiling marker). Rest blocked on vendoring opencode → Spike C → WASM-SQLite solution. See `docs/opencode/README.md` | TBD |

---

### M0 — Foundation
**Stages:** 0
**Done when:** there is a working dev server, a page with an editor (Monaco) and terminal (xterm.js) opens. Empty Web Worker starts on "Run" click, writes "worker alive" to the console. Service Worker is registered, does nothing.

**Acceptance:**
- [ ] `pnpm dev` brings up playground on localhost
- [ ] UI shows editor, terminal, "Run" button
- [ ] Clicking "Run" starts the Worker and it sends a message to the main thread
- [ ] Service Worker is registered (visible in DevTools → Application)
- [ ] CI run is green (lint + typecheck + empty tests)

**Infrastructure that appears:** pnpm workspace, TS, Vite, Vitest, Playwright, Biome, GitHub Actions, basic CLAUDE.md.

---

### M1 — JS Execution
**Stages:** 1
**Done when:** you can type a JS expression in the terminal and see the result. console.log/error is forwarded from the worker to xterm with stdout/stderr separation. Browser capabilities are detected on startup (see D-006).

**Acceptance:**
- [ ] `> 1 + 1` in the terminal → `2`
- [ ] `> console.log('hi'); console.error('err')` → both visible, different colors
- [ ] `> throw new Error('boom')` → traceback visible
- [ ] Worker restarts safely on `> .reset` command
- [ ] Output stream works (long `for` with console.log doesn't block UI)
- [ ] **Capabilities detection on startup:** checks `crossOriginIsolated`, `SharedArrayBuffer`, `FileSystemSyncAccessHandle`, `Atomics.waitAsync`; shows a clear message if anything is missing

**Tests:**
- Unit: execution context, capture console
- E2E (playwright): terminal input → expected output

---

### M2 — Modules
**Stages:** 2, 3, 4
**Done when:** you can place several files in VFS, the main file does `require('./util')` and gets the export. Node module resolution works (including `node_modules` walk-up). Basic ESM works.

**Loader architecture — see D-003:** shared CJS+ESM resolver, ESM parsing via `es-module-lexer`, execution via `new Function`/`async function`, module registry with live bindings.

**Acceptance:**
- [ ] CJS: `require('./other.js')`, `require('./other')` (no extension), `require('./dir')` (via index.js)
- [ ] Node algorithm: walk-up through `node_modules`
- [ ] `package.json` fields `main`, `exports` (conditional exports — at minimum `node`/`default`/`import`/`require`)
- [ ] ESM: static `import`, dynamic `import()`
- [ ] Top-level await works (module = async function)
- [ ] Live bindings: re-exported value sees updates (as in Node)
- [ ] Circular dependencies don't crash (for both CJS and ESM)
- [ ] CJS ↔ ESM interop: ESM can import CJS; CJS loads ESM only via `import()`
- [ ] **Test with real package:** `lodash` (CJS) and `nanoid` (ESM) load from fixtures

**Tests:**
- Conformance: 30+ resolution cases (see Node docs)
- Conformance: live bindings, top-level await, ESM↔CJS interop (parity-runner against Node)
- Integration: a couple of real packages from `examples/npm-pkg-fixtures/`

---

### M3 — Node Core
**Stages:** 5, 6, 7
**Done when:** `process.env.NODE_ENV`, `process.cwd()`, `setTimeout`, `setImmediate`, `process.nextTick` work with correct semantics. Basic built-ins connected.

**Acceptance:**
- [ ] `path`, `url`, `querystring`, `util`, `events`, `buffer`, `assert` — all main methods work
- [ ] `process.nextTick` executes BEFORE Promise.then (correct order)
- [ ] `setImmediate(fn)` executes after an I/O task but before setTimeout(fn, 0) in the typical case
- [ ] `EventEmitter` supports on/off/emit/once
- [ ] **Real-package test:** `chalk` works (`chalk.red('hi')` returns an ANSI string)

**Tests:**
- Parity-runner: 100+ cases per builtin, comparison with real Node
- Order tests on event loop: clear scenarios for "nextTick before Promise"

---

### M4 — FileSystem
**Stages:** 8 (partial), 9, 10
**Done when:** `fs.readFileSync`, `fs.writeFileSync`, `fs.promises.readFile`, `fs.readdirSync` work on top of OPFS. Persistent: after reload the files are still there.

**Acceptance:**
- [ ] Sync API via OPFS SyncAccessHandle (inside Worker)
- [ ] Async API + promises
- [ ] `mkdir -p` semantics for `fs.mkdir({ recursive: true })`
- [ ] `fs.stat` returns correct `size`, `isFile`, `isDirectory`
- [ ] **Persistent storage:** wrote a file → reloaded page → file is there
- [ ] Streams: `createReadStream`/`createWriteStream` via VFS

**Tests:**
- Conformance: duplicate 50+ tests from Node test suite for fs
- Persistence test (e2e): write → reload → read

---

### M5 — Streams & IO
**Stages:** 8 (complete)
**Done when:** readable-stream is integrated, pipes work, backpressure is correct.

**Acceptance:**
- [ ] `Readable`/`Writable`/`Duplex`/`Transform`
- [ ] `pipeline()` and `pipe()` with correct cleanup
- [ ] Async iterators: `for await (const chunk of readable)`
- [ ] Object mode
- [ ] Backpressure: writing a large file, seeing `drain` events
- [ ] **Real test:** `fs.createReadStream('big.txt').pipe(fs.createWriteStream('copy.txt'))`

---

### M6 — Processes
**Stages:** 11, 12, 13
**Done when:** one process can spawn another, pass arguments, read stdout, wait for exit code.

**Acceptance:**
- [ ] `child_process.spawn('node', ['script.js'])` — where 'node' is a special handler in our runtime
- [ ] Pipes: child's stdout/stderr readable from parent
- [ ] `exec(cmd, callback)` — wrapper with buffering
- [ ] `fork(modulePath)` with IPC via `process.send`/`message` event
- [ ] **Sync subprocess:** `execSync` works (via SharedArrayBuffer + Atomics)
- [ ] `worker_threads` — parallel implementation on Web Workers
- [ ] Process tree visible in DevTools/UI

**Tests:**
- Spawn 10 parallel processes, wait for all
- Pipe-chain: `a | b | c`
- Sync exec doesn't hang the UI (runs in worker, not main)

---

### M7 — Network
**Stages:** 14, 15, 16
**Done when:** Express application comes up, answers requests from the browser via Service Worker.

**Acceptance:**
- [ ] `net.createServer().listen(3000)` registers an endpoint in SW
- [ ] Open `https://<host>/preview/3000/` in a new tab → see response from user code
- [ ] HTTP methods: GET, POST with body, headers
- [ ] Chunked transfer encoding works (long-polling scenarios)
- [ ] `http.request` (outgoing) via proxy
- [ ] **Real test:** Express "hello world" → see page in browser
- [ ] **Real test:** Express app with middleware (body-parser, cors) handles POST with JSON

---

### M8 — WASI Runner
**Stages:** 17, 18, 19
**Done when:** you can run a WASI binary from shell like a normal program.

**Acceptance:**
- [ ] Minimal hello.c → hello.wasm → runs in playground, prints to stdout
- [x] esbuild.wasm: `esbuild --loader=ts` via `runWasi` works, transforms TS/JSX from stdin (ADR-0047; `tools/shadow-registry/src/esbuild-binding.ts`, integration `tests/integration/esbuild-wasi-transform.test.ts`)
- [x] esbuild sees preopens and cwd (`AT_FDCWD`) — ADR-0049, reverses ADR-0044 hypothesis about Go-runtime bridge (not needed for esbuild; `@esbuild/wasi-preview1` is a real WASI binary)
- [ ] WASI VFS integrated with main VFS (single source of truth)
- [ ] Binary sees preopens (e.g. `/workspace`)

**Tests:**
- Sanity: hello.wasm in our runtime and in `wasmtime` give the same stdout
- esbuild: transform small TS/JSX via `@esbuild/wasi-preview1` under `runWasi`, verify types are stripped and JSX is lowered (ADR-0047; esbuild returned as forcing consumer instead of swc)

---

### M9 — npm install
**Stages:** 20, 21, 22
**Done when:** `npm install express` in shell → package in node_modules → can require it.

**Registry proxy — see D-004:** dev via Vite proxy, prod via solution from Q4' (decided by end of milestone).

**Acceptance:**
- [ ] Semver resolver: correctly picks versions from ranges
- [ ] Downloads tarballs via configured registry URL (no hardcodes)
- [ ] `npm-client` tests go to a local mock-registry, not the real one
- [ ] Unpacks (pako + tar-stream) into VFS
- [ ] Builds correct node_modules structure with dedupe
- [ ] Lockfile (npm v3) is generated and reused
- [ ] Postinstall scripts via child_process (optional, many packages get by without)
- [ ] Shadow-registry: `npm install bcrypt` → installs `bcryptjs` (or WASM-bcrypt)
- [ ] **Prod proxy chosen and deployed** (closes Q4')

**Tests:**
- Clean install of a simple package (`chalk`) → require works
- Complex install (`express` with 20+ transitive dependencies) → app starts

---

### M10 — Real Tooling
**Stages:** 23, 24, 25
**Done when:** Vite dev server (or equivalent) starts, serves HMR to the iframe preview.

**Acceptance:**
- [ ] `npm install vite && npm run dev` starts Vite
- [ ] Vite calls esbuild.wasm via shadow-binding (TS/JSX transform; ADR-0047, reverses ADR-0044 — `@esbuild/wasi-preview1` under `runWasi`)
- [ ] HMR works via WebSocket tunnel
- [ ] Preview-iframe shows the app
- [ ] Edit in editor → see update in preview without reload

This is the final showcase scenario — "here it is, like StackBlitz".

---

### M11 — post-M10 follow-ups
**Stages:** 23.x, 24.x, 25.x (incremental refinements of M10 plus deferred items from M6/M8/M9)
**Done when:** all ADR-marked "open acceptance" items from M6–M10 are closed or explicitly deferred with a tracker.

Composition (as of 2026-05-28, audit 2026-05-27 confirmed discrepancy between ADR-layer reality and §4 table):
- ✅ **Vite-in-Worker** — ADR-0043 (landed 2026-05-27). Real Vite lives in a kernel-spawned Worker; the page becomes the coordinator. Part of M10 "Real Tooling" moved here for practical reasons (cross-origin isolation + heavy WASM didn't fit in the page realm).
- ✅ **Nested install for version conflicts** — ADR-0042 (landed 2026-05-27). First-wins flat + nest-on-conflict in `walkAndPin`; lockfile fast-path replay via `pinnedEntryForParent`.
- ✅ **Fork-IPC via Worker** — ADR-0045 (landed 2026-05-28). `WorkerProcessHandle.send`/`'message'`/`disconnect` via parent↔child `MessagePort`. Closes the "`fork()` returns IPC ✅" gap from M6 acceptance, which in the SAB path previously silently dropped messages.
- ⏳ **SW→Worker direct routing** — A-023 (tracker: `OPEN_QUESTIONS.md` Q-2026-05-27-002). When landed, `WorkerOwnerResolver` will replace `FirstWindowOwnerResolver` in `@riftydev/service-worker`, and SW-fetch for `/preview/<port>/*` will go directly to the worker realm.
- ⏳ **Streaming cross-realm preview** — `bridgeCrossRealmPreview` is currently buffered-only (`packages/net/src/cross-realm/preview-port.ts:24-29`). Will be upgraded once Real Vite starts serving large responses (vendor-prebundle, source maps). ADR-0046+ (TBD).
- ⏳ **Lockfile reuse on subsequent `install`** — M9 acceptance, ADR-0023 marked the tactic; code currently regenerates every time. Closed in a separate PR.
- ✅ **esbuild.wasm vendoring** — M8 acceptance. ADR-0047 reversed ADR-0044 (swc has no WASI build; `@esbuild/wasi-preview1` is a real WASIp1 binary). Vendored by build-time script `tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs` (pinned by version + integrity), shadow-binding runs real preopens/cwd through `runWasi` (ADR-0049).

Decision (2026-05-27): M11 — not a new phase of work, but a container for technical debt left from M6 / M8 / M9 / M10. The 2-3 week estimate covers only active work (SW→Worker — after fork-IPC); deferred items await a real triggering use case.

---

### M12 — opencode server facade (proposed)

**Goal:** run anomalyco/opencode (Effect/Bun TS source-graph, NOT the native npm `opencode-ai`) as a headless server facade "without tool execution" — boot ~40 Effect layers, serve trivial routes, create a session, make one LLM round-trip; spawn / shell / native git/ripgrep / PTY — hard browser/WASI ceiling (out of scope by design). Feasibility verdict: `feasible-with-major-work` (medium confidence).

**Status (2026-05-31): partially implemented.** The entire slice not requiring a vendored opencode tree is implemented and green:
- ✅ TS-on-import by module graph — ADR-0052 (transform hook) + ADR-0053 (`.ts`/`.tsx` first-class); gold multi-file `.ts` parity case is green (P0 language unit closed).
- ✅ Effect `@effect/platform-node` consumes rifty `node:http` AS-IS — ADR-0054 (additive shape-widening; pipe-sink deferred).
- ✅ SSE-over-streaming-HTTP, no `ws` shim (page-direct) — ADR-0055.
- ✅ F09 tool-ceiling marker — pure-JS `vfsGrep`, spawn-ceiling conformance, `docs/compat/opencode-tool-ceiling.md`.

**Spike C → WASM-SQLite re-cut in P2 (RATIFIED).** Spike C confirmed: `Server.listen` builds the layer-DAG eagerly and the real `Database` (`node:sqlite` `DatabaseSync`) opens+migrates on layer-build, so WASM-SQLite is moved from P4 to **P2 boot-prerequisite**. Engine fixed in **ADR-0065**: `sql.js` (pure-JS WASM SQLite, synchronous API, in-memory-first), registered as a rifty-builtin `node:sqlite` with `DatabaseSync`-compatible synchronous surface; OPFS persistence deferred. ADR-0065 supersedes decisions.md DRAFTS ADR-0055/0056 and corrects the `bun:sqlite`→`node:sqlite` skeleton.

**Blocked / deferred** (gates see `docs/opencode/README.md`; full text of ADR drafts — `docs/opencode/decisions.md`): headless boot (ADR-0058 draft); v3 SSE frame bump (ADR-0060 draft, conflicts with ADR-0048/0017); LLM round-trip + `node:https`→fetch (ADR-0061 draft, supersedes ADR-0010, after C1 https.Agent pre-flight). opencode is NOT vendored into the repository.

Critical path: **vendoring opencode ✅ → Spike C ✅ → WASM-SQLite `node:sqlite` shim (sql.js, ADR-0065) in P2**.

---

## 5. Verification strategy

This is **the most important part** when working with an AI agent. Without a rigid testing infrastructure the agent will do things that "look correct" but break in reality.

### 5.1 Testing levels

| Level | What it checks | Tool | When it runs |
|---|---|---|---|
| **Unit** | Isolated logic within a package | Vitest | On every save (watch) + pre-commit |
| **Parity (Node diff)** | Match with real Node API | Custom harness + Vitest | Pre-commit + CI |
| **Conformance** | Adherence to documented Node semantics | Vitest | CI |
| **Integration** | Real npm packages in the runtime | Vitest in Worker / Playwright | CI |
| **E2E** | Full playground through the browser | Playwright | CI (full run) |
| **Smoke** | Basic scenarios after build | Playwright | Pre-deploy |
| **Compat matrix** | Summary table "what works" | Auto-generated MD | After each CI |

### 5.2 Main weapon: Node Parity Runner

Key idea: **we have a reference — real Node**. Most implementation bugs can be caught automatically by running the same code in both environments and diffing the result.

```
tools/node-parity-runner/
├── src/
│   ├── run-in-node.ts        # runs code in a spawned Node
│   ├── run-in-runtime.ts     # runs code in our runtime (Worker)
│   ├── diff.ts               # normalization and comparison
│   └── cli.ts
└── cases/
    ├── fs/
    │   ├── readFile-basic.case.ts
    │   ├── readFile-encoding.case.ts
    │   └── ...
    └── timers/
        └── nexttick-order.case.ts
```

Example case:
```typescript
// fs/readFile-basic.case.ts
export const setup = {
  files: { '/work/hello.txt': 'world' },
}

export const code = `
  const fs = require('fs')
  const data = fs.readFileSync('/work/hello.txt', 'utf8')
  console.log(JSON.stringify({ data, type: typeof data }))
`

export const expected = { data: 'world', type: 'string' }
```

The harness runs `code` in Node (with a pre-setup directory) and in our runtime (with VFS preload), compares stdout. Any discrepancy is a bug.


**This is the gold standard for the AI agent:** the agent can't "cheat" because the reference is external.

### 5.3 Conformance tests

For cases where Node behavior can't/is hard to check with the parity-runner (async timers, event loop edge cases, errors), we write declarative tests for specific behavior:

```typescript
// tests/conformance/timers/order.test.ts
test('nextTick runs before resolved Promise.then', async () => {
  const order: string[] = []
  await runInRuntime(`
    Promise.resolve().then(() => order.push('promise'))
    process.nextTick(() => order.push('nextTick'))
  `)
  expect(order).toEqual(['nextTick', 'promise'])
})
```

Test sources:
- Node.js test suite (`test/parallel/`) — hundreds can be adapted
- WPT (Web Platform Tests) for web parts
- Own tests for edge cases we explicitly decided to support

### 5.4 Integration: real npm packages

`examples/npm-pkg-fixtures/` contains **pinned versions** of real packages that the runtime is tested against.

Strategy: **from simple to complex**, gradually expanding the list. Every package that successfully works is pinned with a regression test.

```
examples/npm-pkg-fixtures/
├── tier-0-utility/        # M3: chalk, kleur, picocolors, ms
├── tier-1-cli-pure/       # M3-M4: commander, yargs, mri
├── tier-2-streams/        # M5: through2, split2, csv-parse
├── tier-3-server/         # M7: express, koa, fastify
├── tier-4-tooling/        # M8-M10: esbuild, vite, swc
└── manifest.json          # table "package → tiers → expected behavior"
```

Each tier is a separate test suite that **can be green or red** at any moment. The summary table in `docs/compat/` shows progress.

### 5.5 E2E via Playwright

Full scenario: open playground → enter code in editor → click Run → check output in terminal. For M7+ — check preview-iframe.

```typescript
test('M7: express hello world', async ({ page }) => {
  await page.goto('/')
  await loadFixture(page, 'express-hello')
  await page.click('[data-action=run]')
  await expect(page.locator('xterm-screen')).toContainText('listening on 3000')

  const preview = await page.context().newPage()
  await preview.goto('/preview/3000/')
  await expect(preview.locator('body')).toContainText('Hello from Express')
})
```

### 5.6 Compat matrix

Auto-generated markdown from test results:

```markdown
# Compatibility Matrix

| Module | Method | Status | Notes |
|---|---|---|---|
| fs | readFileSync | ✅ |  |
| fs | readFile | ✅ |  |
| fs | watch | ⚠️ | polling-based, 200ms |
| fs | constants | ❌ | not implemented |
| http | Server | ✅ |  |
| http | request | ⚠️ | no keep-alive |
```

Updated on every CI run. Both user documentation and for the agent — a map of "where to dig next".

### 5.7 CI pipeline

```yaml
# .github/workflows/ci.yml (schema)
jobs:
  lint-and-typecheck:
    - biome check
    - tsc --noEmit (workspace)
    - madge --circular packages/

  unit:
    - vitest run packages/*

  parity:
    - node tools/node-parity-runner run --all
    # compares each case in Node vs our Worker

  conformance:
    - vitest run tests/conformance

  integration:
    - vitest run tests/integration

  e2e:
    - playwright test

  compat-report:
    - node tools/compat-matrix-generator
    - git diff --exit-code docs/compat/  # commit must include updated matrix
```

**Pre-commit hook (lefthook/husky):** lint + typecheck + unit + parity-quick (fast subset). Full run in CI.

### 5.8 Benchmarks and smoke

`apps/benchmarks/`:
- Boot time: milliseconds from page load to ready runtime
- `npm install lodash` end-to-end
- "Hello world" Express: requests/sec through SW
- VFS write/read throughput

Run once a week or manually, results in `docs/benchmarks/`.

---

## 6. AI agent: rules of the game

### 6.1 `CLAUDE.md` at root

This is context for the agent each session. Minimum:
- Link to this document
- Code conventions (see below)
- Current milestone and its acceptance criteria
- List of known issues and unresolved questions
- "Definition of done" for a PR

```markdown
# CLAUDE.md
You are working on a WebContainer-like project.
Read PROJECT_PLAN.md for the master plan.
Current milestone: M3 (Node Core).
Before considering any task done, ensure:
  1. All affected tests pass (unit + parity + relevant conformance)
  2. New behaviors have new tests (parity case preferred)
  3. Public API has TSDoc
  4. ADR is added if architectural decision was made
  5. compat-matrix is regenerated if any conformance/integration changed
```

### 6.2 Conventions that help the agent not break everything

1. **Strict TypeScript everywhere.** No `any`. No `@ts-ignore` without an explanatory comment and a ticket.
2. **Public API in `src/index.ts`, everything else internal.** Agent won't accidentally touch another package's internals.
3. **One change — one PR.** Agent works by milestones/stages.
4. **TSDoc on every public function.** Gives the agent context when reading code.
5. **Small files** (<300 lines). Large modules are split.
6. **Test first, then code** (test-driven). Easier for the agent to write a parity test alongside a feature than to find a regression after the fact.
7. **No "let's stub it for now"** in the main branch. Not implemented — `throw new NotImplementedError('fs.watch')` with registration in compat-matrix as `❌`.
8. **ADR for every architectural decision.** Both context for the agent and for you a year from now.

### 6.3 Definition of done (for a task/PR)

- [ ] All existing tests pass
- [ ] New behavior is covered by tests (minimum — parity case, if applicable)
- [ ] TypeScript strict without errors
- [ ] Lint without errors
- [ ] TSDoc on new public API
- [ ] CHANGELOG in affected package updated
- [ ] compat-matrix regenerated (if compatibility changed)
- [ ] ADR added (if an architectural decision was made)
- [ ] PR description links to stage/milestone

### 6.4 Workflow with the agent

Cycle that actually works:
1. **You:** "Taking stage X from milestone Y. Write tests for acceptance criteria."
2. **Agent:** writes tests, they're red.
3. **You:** "Implement to green, don't change the tests."
4. **Agent:** writes code, runs tests, iterates.
5. **You:** architecture review (agent may pick a suboptimal solution), fixes.
6. **Agent:** updates ADR, compat-matrix, CHANGELOG.
7. **Merge.**

Critical rule: **tests are written first and not edited to match implementation**. "Inconvenient" test — signal for an ADR discussion, not for tweaking.

### 6.5 Protection against typical agent mistakes

- **Silent stubs:** agent loves to return `null` or `''` instead of an implementation. Protection — strict types and mandatory `NotImplementedError` with registration.
- **Tests failing "for another reason":** agent may edit an unrelated test to make CI green. Protection — pre-commit hook compares diff: editing a test in a file where code wasn't changed requires the `--update-test` flag.
- **Going into `any`:** biome/eslint rule, ESLint error.
- **Direct import from `src/internal/*` of other packages:** ESLint rule `no-restricted-imports`.
- **Overwriting ADR:** ADR-files are immutable after merge (only new ADRs can override old ones, with a reference).

---

## 7. Starting checklist (M0)

Concrete steps for the first week:

1. [ ] `pnpm init` + `pnpm-workspace.yaml`
2. [ ] `tsconfig.base.json` with strict settings
3. [ ] Biome (or eslint+prettier) — choose and configure
4. [ ] Vitest workspace
5. [ ] **Playwright init with all-browser support** (see D-006):
    - [ ] `playwright.config.ts` with `chromium`, `firefox`, `webkit` projects
    - [ ] `postinstall` script installs all three browsers
    - [ ] npm-scripts: `test:e2e` (chromium-only), `test:e2e:all`, `test:e2e:firefox`, `test:e2e:webkit`
6. [ ] **GitHub Actions:**
    - [ ] `ci.yml` — on every PR: lint + typecheck + unit + parity + e2e:chromium
    - [ ] `ci-cross-browser.yml` — cron weekly + manual trigger: e2e:all + browser compat report
7. [ ] **Cross-origin isolation:**
    - [ ] Vite dev-server sends `COOP: same-origin` + `COEP: credentialless`
    - [ ] Headers configured for prod config too (`vercel.json` / `_headers` / etc — depending on chosen hosting)
    - [ ] All local assets (Monaco, xterm, fonts) load from same origin; no external CDN
    - [ ] Runtime-check in playground: on load verify `crossOriginIsolated === true`, otherwise show a clear error with instructions
    - [ ] E2E test in playwright: checks `crossOriginIsolated`, `typeof SharedArrayBuffer === 'function'`, that `new SharedArrayBuffer(8)` doesn't throw
8. [ ] `apps/playground` with skeleton (Vite + **SolidJS**, Monaco, xterm.js — see D-002)
9. [ ] `packages/terminal` — wrapper over xterm (framework-agnostic, no Solid)
10. [ ] Empty Service Worker in `packages/service-worker`, registered from playground
11. [ ] `packages/runtime-js` with worker-entry skeleton, loaded on Run click
12. [ ] **ESLint rule `no-restricted-imports`: `solid-js` forbidden outside `apps/playground/**`** (see D-002)
13. [ ] `CLAUDE.md` + ADR-0001 (pnpm + workspace) + ADR-0002 (cross-origin isolation, D-001) + ADR-0003 (UI framework, D-002)
14. [ ] **`OPEN_QUESTIONS.md` at root** + template + `pnpm adr:new` and `pnpm adr:promote` scripts (see D-007)
15. [ ] **CI check for `TODO(ADR):` markers** — collects count, outputs to report, does not block
16. [ ] README with roadmap link and status
17. [ ] First devlog post "why I'm doing this"

After this, M1 can begin.

---

## 8. Decisions log

Brief records of ratified architectural decisions. Detailed rationale in `docs/adr/`. This section grows as open questions are resolved.

### D-009: Inflections are not a reason to stop
**Decided:** 2026-05-31
**ADR:** `docs/adr/0064-no-stop-on-inflections.md` (extends ADR-0063)
**Related to:** D-008

**Problem:** Despite D-008 (record-and-continue), the agent would still pause to ask a human on "large inflections" — an unexpected result changes the plan; a previously deferred decision now has a confirmed need; an earlier assumption turned out to be stale. Exactly the friction D-008 was meant to remove.

**Decision:** An inflection is not a stop trigger. These don't pause work for a human question: a result/measurement that changes the plan or milestone order; a deferred decision whose gate ("no confirmed need") is closed by evidence → ratify it; discovering a stale assumption/spec/feasibility note → correct course; committing to a new external dependency after confirming need. Agent decides, records (new/superseding ADR; decision subagent when reconsidering something already recorded), re-cuts the plan, continues, and reports AFTER. Confirm-first remains only for actions outward-facing/destructive beyond the repo (publishing, deleting user data, spending, pushing to shared remotes) or a direction explicitly reserved by the user.

---

### D-008: Record-and-continue — agent doesn't stop on irreversible decisions
**Decided:** 2026-05-30
**ADR:** `docs/adr/0063-record-decisions-no-stop-on-irreversible.md` (supersedes ADR-0008)
**Related to:** D-007 (updates behavior)

**Problem:** Rule D-007 "IRREVERSIBLE → stop, question in PR, wait for human" in practice halted long autonomous sessions at routine forks — the main source of friction.

**Decision:** Agent no longer stops on irreversible decisions. The Reversibility checklist is retained but determines only **where** to record the decision, not whether to pause.
- Any new decision (reversible or irreversible): **decide, record, continue.** REVERSIBLE → `OPEN_QUESTIONS.md` + `TODO(ADR)`; IRREVERSIBLE → new inline ADR (agent ratifies), with options and trade-offs for auditability.
- **Reconsidering an already-recorded decision** (a merged ADR or provisional decision that other work now depends on) — the one case where we don't decide inline: an **explicit decision subagent** is launched, it evaluates and produces a superseding ADR (citing the old one — ADRs stay immutable).

**What does NOT change:** ADR immutable after merge; "never modify a test to make code pass" stays hard (correctness invariant, not a design fork); every irreversible decision is still **recorded**.

---

### D-007: Reversible decisions — agent doesn't block on design forks
**Decided:** 2026-05  
**ADR:** `docs/adr/0008-reversible-decisions.md`  
**Related to:** working with AI agent (§6)

**Problem:** The strict rule "design decision = ADR discussion" halts the agent's long autonomous sessions at every fork — kills productivity and provokes rule violations.

**Decision:** We differentiate decisions by reversibility. The agent may make reversible decisions autonomously, recording them in `OPEN_QUESTIONS.md` and marking code with `TODO(ADR)` markers. Only irreversible decisions and contradictions with existing ADRs interrupt work.

**Reversibility checklist (order matters — first "yes" determines classification):**

1. Does it touch the public API between packages? → **IRREVERSIBLE**
2. Does it require a new external dependency? → **IRREVERSIBLE**
3. Does it contradict an existing ADR? → **IRREVERSIBLE**
4. Would reverting require >100 lines or >2 files changed? → **IRREVERSIBLE**
5. Otherwise → **REVERSIBLE**

**Agent behavior:**

| Decision type | Action |
|---|---|
| Pure implementation (criteria are clear) | Does it |
| Local naming, file structure within a package | Decides alone, no recording |
| Internal API between modules of the same package | Decides alone, documents in TSDoc |
| REVERSIBLE design choice | Makes provisional decision, marks `TODO(ADR): Q-...`, logs to `OPEN_QUESTIONS.md`, continues work |
| IRREVERSIBLE design choice | Stops, explicitly asks in PR description |
| Contradiction with existing ADR | Stop, explicit question |

**Artifacts:**

1. **`OPEN_QUESTIONS.md`** at repo root — live buffer for provisional decisions. Entry format:
   ```markdown
   ## Q-YYYY-MM-DD-NNN: <Title>
   **Encountered in:** PR #X, while implementing Y
   **Context:** Brief description of the fork
   **Options considered:** A, B (with trade-offs)
   **Decision taken (provisional):** A
   **Code markers:** `TODO(ADR): Q-YYYY-MM-DD-NNN` in files X, Y
   **Reversibility justification:** why rollback is trivial
   **Needs human review by:** end of milestone M<N>
   ```

2. **Marker `TODO(ADR): Q-...`** in code — grep-friendly, separate from regular `TODO`. CI collects their count into a report, **does not block**.

3. **`pnpm adr:promote Q-YYYY-MM-DD-NNN`** — command to upgrade a confirmed question to an ADR. Removes corresponding `TODO(ADR)` markers from code.

**Review process:**
- At the end of each milestone (or more frequently as needed) — pass through `OPEN_QUESTIONS.md`.
- Each question: confirmed → promote to ADR; rejected → redo with new ADR; deferred → stays with updated `Needs human review by`.
- CI signals if `OPEN_QUESTIONS.md` contains questions older than two milestones — this is technical debt.

**What this gives:**
- Agent **keeps working** in most cases where it previously stalled.
- Forks are **visible and auditable** — nothing is lost.
- Genuinely critical decisions still stop work — where making an irreversible mistake otherwise.
- Count of `TODO(ADR)` — quantitative indicator of technical debt.

**Consequences for CLAUDE.md:**
- Adding section "Design decisions during work" with Reversibility checklist.
- Workflow gets step 0: classify the task before starting.
- Rule "Never modify a test to make code pass" stays hard — this is an irreversibility category.

---

### D-006: Chrome-first with infrastructure ready for other browsers
**Decided:** 2026-05  
**ADR:** `docs/adr/0007-browser-support.md`  
**Related to:** Q6 (closed)

**Decision:** Primary target — the Chromium family (Chrome/Edge/Arc/Brave). Firefox and WebKit/Safari supported best-effort: infrastructure for runs is ready from M0, but doesn't run in default CI. Testing in "other" browsers — one CLI call, not a separate project.

**Positioning strategy: Chrome-first, best-effort other browsers.**
- In Chromium everything must work as stated in acceptance criteria.
- In Firefox/WebKit — the app loads, basic scenarios work (or a clear message about why something doesn't work is shown).
- No vendor-prefixes and Chrome-only hacks "just because". Standard path if possible.

**Infrastructure for all browsers (prepared in M0, used on demand):**

1. **`playwright.config.ts` contains projects for all three engines** (`chromium`, `firefox`, `webkit`) from the start. Not one config for Chrome and a separate "someday" for the rest.

2. **CI matrix script handles any engine:**
   - Default `ci.yml` runs only `chromium`.
   - Parameterized workflow `ci-cross-browser.yml` runs **on cron (once a week)** + manual trigger via `workflow_dispatch`. Runs the full test pyramid on all three.
   - Results go into a separate report `docs/compat/browsers.md` (generated automatically).

3. **Local npm-scripts from day one:**
   - `pnpm test:e2e` → chromium (fast, default)
   - `pnpm test:e2e:all` → all three
   - `pnpm test:e2e:firefox`, `pnpm test:e2e:webkit` → separately
   - This includes installing browsers via `playwright install firefox webkit` in `postinstall`.

4. **Browser capabilities detection as a separate module** (`packages/runtime-js/src/env/capabilities.ts`):
   - On playground startup checks: `crossOriginIsolated`, `SharedArrayBuffer`, `FileSystemSyncAccessHandle` in Workers, `Atomics.waitAsync` (needed in M6), etc.
   - If something is missing — specific message in UI: "feature X doesn't work because your browser Y doesn't support it. Details: [link to caniuse]".
   - The same module logs capabilities in e2e tests — the compatibility report becomes data-driven, not "feelings".

5. **Browser-specific known issues table** (`docs/compat/browsers.md`):
   - Generated from CI cross-browser run results.
   - Each failing test → entry "test X fails in browser Y, reason Z (link to bug)".
   - Both user documentation and future "what to fix if we decide to achieve full cross-browser".

**What this gives:**
- "See how it looks in FF" — that's `pnpm test:e2e:firefox`, not "spend a day setting up".
- When (if) the project matures to a public audience — adding Firefox/Safari to default CI will be a one-line change in the workflow, not a week of work.
- Regular cross-browser sweep (once a week by cron) catches regressions before we remember about other browsers manually.
- Capabilities-detection — single source of truth about what works in which environment.

**CI configuration:**
```
.github/workflows/
├── ci.yml                    # on every PR: lint + unit + parity + e2e:chromium
├── ci-cross-browser.yml      # cron weekly + manual: e2e:all + report
└── nightly.yml               # on main nightly: benchmarks + integration full
```

**What we do NOT do:**
- Don't block PRs on cross-browser failure. This is best-effort.
- Don't write "workarounds" for unstable APIs in other browsers. Document as known issue, move on.
- Don't use browser-specific feature detection in product code (like `if (isFirefox)`). Only feature-detection via capabilities API.

**Deferred:**
- Mobile browsers (mobile Safari, Chrome Android) — separate question, not now. Playwright infrastructure supports device emulation; will add if/when relevant.
- Serious pixel-perfect cross-browser UI work — outside scope of a pet project.

---

### D-005: Shadow-registry — layered strategy relying on the ecosystem
**Decided:** 2026-05  
**ADR:** `docs/adr/0006-shadow-registry.md`  
**Related to:** Q5 (closed)

**Decision:** Replacing native and incompatible packages — at the module resolver level. Replacement sources — a layered structure relying on the existing ecosystem, not on homegrown solutions.

**Replacement mechanism:**
- Resolver level in module loader (D-003): before looking in `node_modules` we check the shadow-table.
- Reversible: can disable shadow-replacement via a flag for debugging.
- Tested: each replacement must pass a parity-test against the expected API of the replaced package (where applicable).

**Replacement sources (in order of priority):**

1. **Standard `overrides` from user's `package.json`** — user interface. We support the npm/yarn/pnpm format as-is. No proprietary inventions at this layer.

2. **`unenv` from the UnJS team** — base polyfill layer for stdlib modules (`crypto`, `os`, `tty`, `perf_hooks`, `process`, etc.). Used in production by Cloudflare Workers and esm.sh. Included as a `runtime-js` dependency. Covers a large portion of the utility tail in M3 and M11.

3. **`e18e/module-replacements`** — community-curated list of replacements for outdated npm packages with native/modern APIs. Imported as data, extended with our entries for native bindings.

4. **Ready-made WASM builds** for native packages from the public ecosystem:
   - `sqlite3`/`better-sqlite3` → `@sqlite.org/sqlite-wasm` or `node-sqlite3-wasm`
   - Image processing (`sharp`) → `@jsquash/*` family
   - Others — as they appear and are needed

5. **Own adapters in the monorepo** (`tools/shadow-registry/packages/*`) — only for API adaptation on top of ready-made WASM or for cases where no ecosystem solution exists. Minimize the count.

6. **Documented incompatibility** — `docs/compat/incompatible-packages.md`. On install attempt — clear error pointing to this document.

**WASM ecosystem assumptions:**
- Counting on growth of ready-made WASM builds (trend is stable: `wasm32-wasip2` Rust target, Component Model, active publishing of WASM ports).
- `.node` files from npm (native bindings) **will never magically work** — this is a fundamental limitation, not an ecosystem bug.
- Architecturally we're ready for WASI preview 2 advantages (sockets, http in standard): `runtime-wasi` — a separate plugin, migration == updating the shim.

**Process: Ecosystem Sweep**
- Once per quarter — pass through the "documented incompatible" list and check if a WASM alternative or upstream WASI build has appeared.
- Once per quarter — update `unenv` and `e18e/module-replacements` to fresh versions, run parity tests for regressions.
- Recorded in `docs/processes/ecosystem-sweep.md` as a checklist, executed manually or via cron-issue in GitHub.

**Risks and mitigations:**
- **`unenv` — external dependency, oriented toward CF Workers.** Some places may have stubs instead of implementations. Mitigation: each module from unenv goes through parity-runner before use; pin version; in extreme case fork it.
- **`e18e/module-replacements` oriented toward bundler optimization.** Some replacements will suit us, some won't. Mitigation: curate a subset, don't use everything indiscriminately.
- **API mismatch between replacement and original** (e.g. `bcryptjs` ≠ `bcrypt` 100%). Mitigation: paired tests, documenting known discrepancies in compat-matrix.

**Consequences:**
- `npm-client` (M9) implements the standard `overrides` mechanism.
- `runtime-js` (M3+) includes `unenv` as a dependency.
- Own packages in `tools/shadow-registry/` — minimum; the first one will be needed no sooner than a real need arises (likely M9-M10).
- No own mini-registry on CDN/CF — not necessary.

**Deferred:**
- Specific adapters for `bcrypt`/`sharp`/`better-sqlite3` — written as needed, not preemptively.
- Ability for user to specify custom shadow mappings via UI (in addition to `overrides` in package.json) — deferred until the need becomes obvious.

---

### D-004: Dev proxy for npm registry via Vite
**Decided:** 2026-05  
**ADR:** `docs/adr/0005-npm-registry-dev-proxy.md`  
**Related to:** Q4 (partially closed — prod moved to Q4'); directly affects M9

**Decision:** In the dev environment, a proxy to `registry.npmjs.org` is implemented via `server.proxy` in `vite.config.ts`. No separate infrastructure at the development stage. Prod-proxy decision deferred to Q4'.

**What is proxied:**
- Metadata: `GET /npm-registry/:pkg` → `registry.npmjs.org/:pkg`
- Tarballs: `GET /npm-registry/:pkg/-/:file.tgz` → corresponding tarball

**Convention on the `npm-client` side:**
- Registry base URL is configured via a variable (`REGISTRY_BASE_URL`).
- In dev = `/npm-registry` (relative, goes through Vite proxy).
- In prod will be the full URL of the prod-proxy (see Q4').
- In tests = mock-server raised by the harness, so tests are deterministic and don't depend on the network.

**Why this way:**
- Vite proxy — zero infrastructure. Vite is already there, we add a section to the config.
- Doesn't block M0-M8 — proxy is only needed in M9.
- By the time of prod-deploy there may be new options (CF limit changes, new services) — better to decide closer to the time.

**Consequences:**
- `npm-client` is designed around a configurable registry URL from the start. No hardcoded `registry.npmjs.org` in code.
- Tests for `npm-client` always go to a local mock — faster, more stable, and don't burden the real registry.
- Prod-proxy decision required by end of M9. Until then — open question.

**Deferred (Q4'):**
- Prod-proxy choice: Cloudflare Worker, separate VPS, something else.
- Tarball caching strategy (if any).
- Decided by end of M9.

---

### D-003: Module loader — hybrid es-module-lexer + own resolver/linker
**Decided:** 2026-05  
**ADR:** `docs/adr/0004-module-loader.md`  
**Related to:** Q3 (closed)

**Decision:** ESM modules are handled by a custom loader. Import/export parsing — via `es-module-lexer`. Resolver, dependency graph, execution — own code. We don't use the native browser `import()` with Blob URLs for user code.

**Loader architecture:**
1. Resolver (one for CJS and ESM) turns specifiers (`'react'`, `'./util'`) into absolute paths in VFS. Implements Node algorithm: walk-up through `node_modules`, fields `main`/`exports`/`imports`, conditional exports.
2. For an ESM module `es-module-lexer` finds all import/export. Graph built iteratively.
3. Transformation: imports replaced with accesses to module registry (`import x from 'y'` → access via registry with live binding via getter).
4. Execution: module wrapped in an `async function` (supports top-level await), called with context (`import.meta`, dynamic `import()`, registry).
5. CJS modules loaded synchronously via `new Function('module', 'exports', 'require', code)` — the base Node semantics.
6. CJS ↔ ESM interop: ESM can import CJS synchronously via a namespace wrapper; CJS can load ESM only via async `import()` (like in Node).

**Why this way:**
- **Control over the resolver** — we have Node semantics; browser native ESM knows nothing about package.json and conditional exports.
- **Unified CJS+ESM semantics** — one graph, one resolver, two execution strategies. This is the Vite path, proven at scale.
- **Transformations fit in naturally** — want TS/JSX in user code later, add a transform step between parsing and execution without refactoring.
- **Source maps and debug** — we control names/paths, can preserve meaningful information.
- **`es-module-lexer` is cheap** — ~5KB, fast, doesn't parse all JS.

**Alternatives and why rejected:**
- **Native browser ESM via Blob URLs + SW interception:** temptingly cheap, but we lose control at the most critical point (resolution and CJS-interop). Dynamic `import()` inside Worker may bypass SW depending on registration. CJS-interop would have to be written anyway.
- **Full parser (acorn):** excessive. For building the graph an import/export scanner is enough; full AST is only needed when adding transform steps (TS/JSX) — then we'll plug in a separate parser at that step.

**Consequences:**
- In M2 we build the resolver from the start as shared for CJS+ESM (not do CJS first, then a separate ESM).
- Module registry — a separate entity with live bindings via getters. This will also be useful for CJS (cycles).
- With M3+ TS support in user code = adding a transform step, not rewriting the loader.

**Deferred:**
- Support for `import` assertions / attributes (`import json from './x.json' with { type: 'json' }`) — will add when there's a real need.
- Worker modules (`new Worker(url, { type: 'module' })`) inside guest code — separate task in M6 (child_process / worker_threads).
- HMR — not part of M2-M9, will be considered in M10.

---

### D-002: Playground UI framework — SolidJS, isolated from core
**Decided:** 2026-05  
**ADR:** `docs/adr/0003-ui-framework-solid.md`  
**Related to:** Q2 (closed)

**Decision:** Playground is written in SolidJS. UI framework is used **only** in `apps/playground/` and nowhere else. All packages in `packages/` stay framework-agnostic (pure TS, without JSX and reactive dependencies).

**Why Solid:**
- Fine-grained reactivity maps naturally to our update character: streaming stdout to terminal, file watcher events, process statuses in real time.
- Small bundle — we already have a lot of weight without UI (Monaco, runtime, WASM binaries).
- JSX is familiar from React, gentle learning curve.
- Solid Stores fit well for global state (process manager, open files).

**Why it "doesn't grow in":**
- If in a year you want to replace the UI (rich IDE interface, mobile version, embed mode) — only `apps/playground/` is rewritten, not the whole project.
- This disciplines the architecture: the core API must be clean enough that any UI can consume it.

**Isolation rules:**
- `packages/*/src/**` — no `solid-js` imports, no JSX. TypeScript + Web APIs only.
- ESLint rule `no-restricted-imports`: `solid-js` forbidden everywhere except `apps/playground/**`.
- All events from core outward — via typed event emitters or async iterators, without Solid signals.
- Adapter "core → Solid Store" lives in `apps/playground/src/adapters/`, this is the only place they meet.

**Consequences:**
- When replacing UI only `apps/playground/` changes. All `packages/` untouched.
- Any future integration (VSCode-extension, CLI-demo, headless mode for tests) connects to the same core without refactoring.
- A little more code at start (adapter instead of direct Solid state in core), but this is a normal price for decoupling.

**Deferred:**
- Specific set of UI components (panels, tabs, file tree) — written as needed, not pulling in a UI kit at start.
- Theming — a single CSS-variable scheme, no design system at start.

---

### D-001: Cross-origin isolation required from M0
**Decided:** 2026-05  
**ADR:** `docs/adr/0002-cross-origin-isolation.md`  
**Related to:** Q1 (closed)

**Decision:** Playground works only in `crossOriginIsolated === true` mode. Server sends `COOP: same-origin` + `COEP: credentialless`.

**Why:**
- By M6 we need sync IPC between Workers (for `execSync`, synchronous file calls). The only viable mechanism — `SharedArrayBuffer` + `Atomics.wait`, which requires isolation.
- Alternative (fully async runtime + Asyncify-transformation of guest code) is many times more complex and slower.
- `credentialless` significantly eases COEP compared to `require-corp`: third-party resources can be embedded without a CORP header, at the cost of no credentials. Acceptable for our use case.

**Consequences:**
- Hosting: only those that allow custom headers (Vercel/Netlify/Cloudflare Pages — yes; GitHub Pages — no).
- All playground assets — local or proxied through own origin with CORP header added.
- iframe-preview for user apps (M10) will need to be designed with COEP in mind — separate task in M10.
- M0 includes runtime-check and e2e test guaranteeing isolation is actually active.

**Deferred:**
- Specific hosting (Vercel vs Netlify vs CF Pages) — chosen before first deploy, doesn't block development.
- iframe-preview strategy (M10) — will decide when we get there.

---

## 9. Open questions (for discussion)

These things should be resolved **before** the corresponding milestone begins:

*Q4' (prod proxy for npm registry) — reopened 2026-05-27.* Originally closed by ADR-0028 (Vercel Edge Function), but the 2026-05-27 audit revealed that the Edge Function code never appeared in the repo. ADR-0028 status changed to **Provisional**, live tracker — `OPEN_QUESTIONS.md` Q-2026-05-24-007 (Active). Finalization — by the first prod-deploy session of M9.

---

*This document is living. Updated on major decisions. Each milestone ends with a document review: what was confirmed, what was overestimated.*
