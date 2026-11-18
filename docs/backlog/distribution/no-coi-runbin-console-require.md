---
area: distribution
status: draft
title: "No-COI runBin and startBin programs see no rifty console `require`"
created: 2026-11-18
why: a no-COI `runBin` program reads rifty's console `require` as a global (`typeof require` `'function'` in an ES module; Node `'undefined'`); project commands hide it since PR #408, the sibling in-place hosts do not
sources: [docs/public/compat/process.md, docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, docs/backlog/distribution/reference/pr-408-final-green.json]
code: [packages/workbench/src/workers/no-coi-toolchain-owner.ts, packages/workbench/src/workers/no-coi-project-command.ts, packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/worker-entry.ts]
---

## Context

PR #408 outside finding 1. The toolchain Worker mirrors its console `require`
onto `self.require` at boot (`runtime-js/src/worker-entry.ts:188-194`).
`executeNode` (project commands) hides it for each `node` with
`captureNodeProcessGlobals` and puts it back afterwards (ADR-0418 correction
2026-11-18). `runInstalledBin` (`no-coi-toolchain-owner.ts`, `runBin`) runs
`runNodeEntry` in place without it (so does `startInstalledBin`, code read): a
PR #408 review probe ran `sandbox.toolchain.runBin` and printed `typeof require`
/ `typeof globalThis.require` → `function function`, Node `undefined undefined`
(recorded in `reference/pr-408-final-green.json`; not a committed carrier).
Declared in compat process.md "Shared realm across no-COI `node` invocations".
`startBin` (resident) is unmeasured. Same in-place-host drift as
`distribution/no-coi-sibling-hosts-sync-fatal` (sync fatal terminal). Rifty's
`__rifty` and `__riftyImport` globals are visible to every no-COI `node`
(declared; Node has neither). Fault: `sibling-drift` between in-place hosts.

## Next

Owner distribution (workbench toolchain). Probe `startBin`; extend
`tests/no-coi/no-coi-shared-realm.spec.ts` with `runBin`/`startBin` rows vs live
Node; choose with `no-coi-sibling-hosts-sync-fatal` whether the in-place hosts
share one invocation wrapper (§Class-kill) before changing either. Whether
`__rifty` / `__riftyImport` should also be hidden from guest processes is a
design question for the same owner (console eval relies on `__riftyImport`).