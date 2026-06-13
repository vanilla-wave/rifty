---
area: shell
status: parked
title: Execute node_modules/.bin launcher shims by command name (PATH lookup)
created: 2026-06-12
why: shell PATH-style `.bin` resolution + dispatch + a real host executor landed (ADR-0137); residual is browser-only verification + the `npm run` integration nicety, gated on M6 real-worker maturity
sources: [M11, ADR-0137, ADR-0050]
code: [packages/shell/src/bin-resolver.ts, packages/shell/src/shell.ts, apps/playground/src/glue/bin-executor.ts]
---

## Context

DELIVERED (ADR-0137): `bin-resolver.ts` walks up to the nearest
`node_modules/.bin/<name>` shim (registered cmds win → walk-up → miss); `Shell`
runs a resolved shim through an injected `BinExecutor` (exit 126 when no
executor is wired, never a silent stub); `which` reports shim paths; the
playground `createBinExecutor` spawns the shim as a `kind:'source'` kernel
Worker streaming stdio with SIGINT teardown. Bare installed CLIs (`eslint`,
`tsc`, …) are invokable by name.

## Options or Next (residual)

- Real-Worker e2e: prove an arbitrary installed `.bin` runs end-to-end in a COI
  Worker (the executor glue is unit-tested with an injected handle; arbitrary-bin
  execution shares M6 "real Worker per child" maturity — see
  `docs/backlog/kernel/process-equals-web-worker.md`).
- `npm run` script lines: route the script `command` through the shell so its
  argv-0 gets `.bin` resolution (npm semantics), replacing the host runner's
  hardcoded `vite`/dev-script switch in `App.tsx runTerminalScript`.

## Reversibility

REVERSIBLE residual. The delivered mechanism's public API (`BinExecutor`,
`ShellOptions.execBin`) is IRREVERSIBLE and recorded in ADR-0137.
