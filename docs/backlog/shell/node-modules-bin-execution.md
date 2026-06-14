---
area: shell
status: parked
title: Execute node_modules/.bin launcher shims by command name (PATH lookup)
created: 2026-06-12
why: shell PATH-style `.bin` resolution + dispatch + the execution MECHANISM (node-entry loader bootstrap) landed (ADR-0137, Opt-Y); a real CLI does NOT run end-to-end in the browser yet — the bin worker's VFS doesn't hold node_modules (BLOCKER); residual also covers execSync consistency + the `npm run` integration nicety
user_story: As a developer at the rifty shell prompt, I type a bare `vite`/`tsc` and want the installed CLI to actually run; today the shell resolves the shim and dispatches it to the loader mechanism, but the spawned worker can't read node_modules so no output appears yet — the worker-VFS transport is the remaining blocker.
sources: [M11, ADR-0137, ADR-0050]
code: [packages/shell/src/bin-resolver.ts, apps/playground/src/glue/bin-executor.ts, apps/playground/src/workers/node-entry-bootstrap.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/resolver.ts]
---

## Context

DELIVERED (ADR-0137, Opt-Y): `bin-resolver.ts` walks up to the nearest
`node_modules/.bin/<name>` shim (registered cmds win → walk-up → miss); `Shell`
runs a resolved shim through an injected `BinExecutor` (exit 126 when no
executor is wired, never a silent stub); `which` reports shim paths. The
playground `createBinExecutor` spawns the `kind:'url'` node-entry bootstrap,
which runs `runNodeEntry` in the worker: read shim → resolve its launcher
target → import it through the module loader (shebang stripped, relative
imports resolved vs VFS). The loader now strips shebangs (CJS+ESM) for Node
parity, and `child_process.spawn('node', …)` shares the same bootstrap. The
shell resolves a bare `eslint`/`tsc` to its shim and dispatches it to this
mechanism, which is proven by node unit tests + parity (`modules/{cjs,esm}-shebang`).
NOT YET end-to-end: the worker can't read node_modules (see residual blocker).

NOT the earlier broken approach: spawning the shim TEXT as `kind:'source'`
(`new AsyncFunction`) threw on the `#!` line and never routed the shim's
`import()` to the loader — see ADR-0137 §Rejected.

## Options or Next (residual)

- **Worker VFS transport — the bin worker can't see `node_modules` (BLOCKER for
  real end-to-end).** The spawned bin worker's `syncMirror()` is its own empty
  in-worker store, so `runNodeEntry` `ENOENT`s on the resolved shim
  (`/workspace/node_modules/.bin/<name>`). **CORRECTION (this bullet was wrong):**
  the shell's `npm install` writes to PAGE memory, NOT a worker/OPFS realm — there
  is no shared OPFS (ADR-0135 settled page↔worker shared-OPFS is impossible), and
  the playground's workers are all memory-backed (no `initBackend` on the
  kernel-worker path; `flushSyncMirror` no-ops on `MemoryFsSync`). So "init OPFS in
  `node-entry-bootstrap.ts` / share the install realm's VFS" CANNOT fix the shell
  flow — it conflated this with the preview/install flow (different owner). The
  real fork (B: SAB fs-proxy to PAGE vs D: single owner-worker), analysis, and
  recommendation (lean D, separate milestone) live in
  `shell/bin-worker-vfs-transport-b-vs-d.md`. The MECHANISM beneath (`runNodeEntry`
  + loader) is already node-tested + parity; only the TRANSPORT is dead.
- `execSync` shebang/relative-import via the node-entry bootstrap: `child_process.spawn`
  routes through it, but `execSync`'s recursive runner executes its spec in Node
  (conformance), where the `kind:'url'` bootstrap can't load — so the handler
  stays on `kind:'source'`. See `// TODO(backlog: runtime-js/execsync-node-entry-loader)`.
- `npm run` script lines: route the script `command` through the shell so its
  argv-0 gets `.bin` resolution (npm semantics), replacing the host runner's
  hardcoded `vite`/dev-script switch in `App.tsx runTerminalScript`.

## Reversibility

REVERSIBLE residual. The delivered mechanism's public API (`BinExecutor`,
`ShellOptions.execBin`) is IRREVERSIBLE and recorded in ADR-0137.
