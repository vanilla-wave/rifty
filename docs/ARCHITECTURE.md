# Architecture

Vision + system shape (grafted from original root CLAUDE.md; binding rules → `AGENTS.md`).

## Goals
- Understand WebContainers/StackBlitz-like systems under the hood
- Run real Node programs in browser (Express, pure-JS CLIs)
- Architecture practice: layers, isolation, contracts, system-API emulation
- WASI as separate module (esbuild/sqlite — real WASI binaries)

## Non-goals (first year)
- Full Node compat; node-gyp native modules; production perf
- All-browser support (fresh Chrome/Edge only — need OPFS SyncAccessHandle in Workers)
- Own JS engine (browser V8)

## Strategic decisions (D-001..D-006; D→ADR map: `docs/adr/README.md` Appendix B)
1. **Browser V8 = primary JS engine** — perf + tooling beat QuickJS-in-WASM
2. **WASI = separate runtime for native binaries** (esbuild/sqlite/python), not primary JS exec
3. **Web Workers as processes** — each Node "process" = Worker with own JS context
4. **Service Worker = virtual networking** — intercepts fetch, routes to listening workers
5. **OPFS = primary VFS storage** (sync in Workers via `FileSystemSyncAccessHandle`)
6. **VFS = clean interface** — in-memory backend for tests/dev, OPFS for prod

## Layers (top-down only; no reverse imports)
```
┌──────────────────────────────────────────┐
│  apps/playground  (UI: editor + term)     │
├──────────────────────────────────────────┤
│  shell, terminal, npm-client              │  ← high-level features
├──────────────────────────────────────────┤
│  runtime-js (Node API)   runtime-wasi     │  ← language runtimes
├──────────────────────────────────────────┤
│  kernel (processes, scheduling, IPC)      │  ← core
├──────────────────────────────────────────┤
│  vfs   io   net (+ service-worker)        │  ← system primitives
└──────────────────────────────────────────┘
```
Each layer: public API in `index.ts`. UI framework only `apps/playground/` (D-002).

## Isolation / contexts
- **Main thread:** UI, ProcessManager (PID table), SW management
- **Web Worker (per process):** runtime-js + user code + its modules
- **Service Worker:** fetch interceptor, RPC router requests↔workers
- **(later, optional) iframe:** app preview, safe user-HTML render

## Communication channels
- Main ↔ Worker: `MessageChannel` async; `SharedArrayBuffer` + `Atomics` sync (D-001)
- Worker ↔ Worker (pipes): `MessageChannel` via `Transferable`
- Main ↔ SW: `postMessage` + `MessageChannel`
- Browser → SW → Worker: fetch intercepted → RPC → response via `ReadableStream`

## Cross-origin isolation (D-001)
Playground must be `crossOriginIsolated === true` (`COOP: same-origin` + `COEP: credentialless`). Gives SAB + `Atomics.wait` in Workers — sync IPC foundation (M6+). All assets local or CORP-correct; third-party CDNs proxied through own origin.
