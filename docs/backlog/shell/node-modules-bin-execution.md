---
area: shell
status: parked
title: Execute node_modules/.bin launcher shims by command name (PATH lookup)
created: 2026-06-12
why: shell PATH-style `.bin` resolution + dispatch + a WORKING host executor landed (ADR-0137, Opt-Y); residual is COI-only e2e + execSync consistency + the `npm run` integration nicety
user_story: As a developer at the rifty shell prompt, I type a bare `vite`/`tsc` and the installed CLI runs (delivered, ADR-0137); the residual is a COI browser e2e of the worker transport plus running the same CLI inside `npm run` script lines.
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
parity, and `child_process.spawn('node', …)` shares the same bootstrap. Bare
installed CLIs (`eslint`, `tsc`, …) are invokable by name; the mechanism is
proven by node unit tests + parity (`modules/{cjs,esm}-shebang`).

NOT the earlier broken approach: spawning the shim TEXT as `kind:'source'`
(`new AsyncFunction`) threw on the `#!` line and never routed the shim's
`import()` to the loader — see ADR-0137 §Rejected.

## Options or Next (residual)

- **Worker VFS transport — the bin worker must see `node_modules` (BLOCKER for
  real end-to-end).** A draft COI e2e (`#test=bin-exec`, since removed) exposed
  it: the spawned bin worker's `syncMirror()` is an empty in-worker
  `MemoryBackend`, so `runNodeEntry` `ENOENT`s on the resolved shim
  (`/workspace/node_modules/.bin/<name>`). After ADR-0135, `install()` writes
  `node_modules` in the WORKER/OPFS realm — the bin worker needs to read THAT
  shared VFS (OPFS-backed `syncMirror`, like the install/real-vite worker), not a
  fresh memory mirror. Next: init the OPFS backend in `node-entry-bootstrap.ts`
  (or otherwise share the install realm's VFS), then a real e2e that
  `npm install <pkg-with-bin>` → runs the bin (NOT page-mirror seeding). The
  MECHANISM beneath (`runNodeEntry` + loader) is already node-tested + parity.
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
