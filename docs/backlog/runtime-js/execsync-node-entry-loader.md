---
area: runtime-js
status: active
title: Route execSync's child through the node-entry bootstrap (shebang + relative imports)
created: 2026-06-14
why: child_process.spawn('node', …) is wired to the node-entry bootstrap (ADR-0137) so a shebang'd / relative-import script goes through the module loader, while execSync's recursive runner still builds a raw kind:'source' spec — inconsistent dispatch. (Both worker-spawn paths also share the worker-VFS transport blocker tracked in shell/node-modules-bin-execution.)
user_story: As a developer whose code calls `execSync('node script.js')` on a script with a shebang or relative imports, I want it to run like `child_process.spawn` does (via the module loader), but today execSync's recursive runner still uses the raw kind:'source' path so it breaks on the shebang.
sources: [ADR-0137, ADR-0143, M11]
code: [packages/runtime-js/src/ipc/handlers.ts, packages/runtime-js/src/ipc/recursive-runner.ts]
---

## Context

`installRuntimeJsExecSyncHandler` (`ipc/handlers.ts`) builds
`{ kind:'source', code, sourceUrl }` and hands it to the recursive runner. In
the browser that spawns a kernel Worker whose `kind:'source'` path
(`new AsyncFunction`) throws on a `#!` line and never routes the script's
relative `import()` to the VFS loader — the exact gap ADR-0137 fixed for
`child_process.spawn` and the shell `.bin` executor by routing through the
`kind:'url'` node-entry bootstrap.

Blocked from a straight flip: the conformance recursive-runner
(`tests/conformance/builtins/child_process.test.ts`) executes the handler's spec
in **Node**, where there is no kernel Worker / `kind:'url'` bootstrap to load —
flipping the kind to `'url'` breaks that suite (it expects to run the source
directly). The fix needs the recursive runner to own the entry-kind decision
(browser → node-entry bootstrap; Node → loader-run the source), not the handler.

## Options or Next

- **CORRECTION (2026-06-14):** an earlier draft of this item called the entry-kind
  flip "the SAFE REVERSIBLE increment, landable NOW on unit/conformance alone." That
  is wrong for the PRODUCTION path. Today `execSync` works end-to-end in COI because
  the handler builds `kind:'source'` carrying the script BYTES in the spec (`handlers.ts`
  resolves them on PAGE; the child worker never reads a file). Flipping the browser
  path to `kind:'url'` (node-entry bootstrap) makes the child read `entryPath` from its
  OWN empty store → ENOENT → it **regresses the passing COI e2e
  `tests/e2e/execsync-sab.spec.ts`** (and `exec-sync-worker.test.ts` in a real COI run).
  The flip is transport-independent ONLY for the stubbed unit/conformance suites
  (`handlers.test.ts` / `child_process.test.ts` substitute `runWorker` and never read a
  file). So the flip is NOT a standalone increment.
- The worker-VFS transport is **DECIDED → D (owner-worker), ADR-0143**. The entry-kind
  flip lands WITH D: once `execSync` runs in the owner-worker (files local), `kind:'url'`
  reads succeed for plain AND shebang/relative-import scripts, and `execsync-sab.spec.ts`
  passes through the loader path instead of regressing. Until then `execSync` stays on
  `kind:'source'` (no behavior change) and shebang/relative `execSync` remains the gap.
- The shebang/relative-import gap is loud, not silent: `// TODO` at `ipc/handlers.ts`
  (the `kind:'source'` spec-build site), this item, and ADR-0143's phasing.

## Reversibility

REVERSIBLE — internal execSync dispatch; no public API change.
