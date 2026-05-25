# Architecture Decision Records

ADRs are immutable after merge. New decisions get new ADRs; supersedence is explicit (the new ADR cites and overrides the old).

| # | Title | Decision in PROJECT_PLAN.md |
|---|---|---|
| 0001 | Monorepo on pnpm workspaces | — |
| 0002 | Cross-origin isolation is mandatory | D-001 |
| 0003 | Playground UI on SolidJS, isolated from core | D-002 |
| 0004 | Module loader — hybrid `es-module-lexer` + own resolver | D-003 |
| 0005 | Dev proxy for npm registry via Vite | D-004 |
| 0006 | Shadow registry — layered strategy | D-005 |
| 0007 | Chrome-first with cross-browser infrastructure from M0 | D-006 |
| 0008 | Reversible decisions — agents don't block on every dilemma | D-007 |
| 0009 | AST-based ESM transform (supersedes ADR 0004 §"ESM loader") | — |
| 0010 | `node:https` registered as a loud-throw stub | — |
| 0011 | Sync IPC via SharedArrayBuffer + Atomics; Worker-as-process model | — |
| 0012 | `@rifty/io` owns shared primitives; `@rifty/kernel` owns processes | — |
| 0013 | OPFS as the primary VFS in browser deploys | — |
| 0014 | `getFsVfs()` and `syncMirror()` share one backing tree | — |
| 0015 | Shadow-registry consolidation under `tools/shadow-registry/` | — |
| 0016 | Service Worker source-of-truth lives in `@rifty/service-worker` | — |
| 0017 | `@rifty/net` scope statement and streaming rewrite deferral | — |
| 0018 | Expanded `@rifty/runtime-js` public surface via subpath exports | — |
| 0019 | `cwd` lives in `kernel.ProcessRecord` | — |
| 0020 | `Vfs.openReadable()` for true `createReadStream` | — |
| 0021 | Integration tests must use real `npm install` | — |
| 0022 | Parity and E2E coverage gates per milestone | — |
| 0023 | Lockfile reuse on subsequent `install()` | — |
| 0024 | File-size budget | — |
| 0025 | Toolchain dev servers run on the playground main thread | — |
| 0026 | `process.platform` / `process.arch` report honest values | — |
| 0027 | Per-file shim overlays live in the consuming adapter | — |
| 0028 | Vercel Edge Function proxies npm registry in production | closes Q4' |
| 0029 | `FsSync.utimes` (closes Q-2026-05-25-touch-utimes) | — |
| 0030 | `Buffer extends Uint8Array` (replaces symbol-bag brand) | — |
| 0031 | Every SW↔main wire frame carries `version`; receivers validate at decode (extends ADR-0016) | — |
| 0032 | SyncRpc protocol-version field in the SAB header | — |

For the broad rationale and trade-offs, read PROJECT_PLAN.md §8 first; ADRs are the durable spec.
