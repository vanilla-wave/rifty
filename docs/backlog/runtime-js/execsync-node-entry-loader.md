---
area: runtime-js
status: active
title: Route execSync's child through the node-entry bootstrap (shebang + relative imports)
created: 2026-06-14
why: child_process.spawn('node', …) is wired to the node-entry bootstrap (ADR-0137) so a shebang'd / relative-import script goes through the module loader, while execSync's recursive runner still builds a raw kind:'source' spec — inconsistent dispatch. (Both worker-spawn paths also share the worker-VFS transport blocker tracked in shell/node-modules-bin-execution.)
user_story: As a developer whose code calls `execSync('node script.js')` on a script with a shebang or relative imports, I want it to run like `child_process.spawn` does (via the module loader), but today execSync's recursive runner still uses the raw kind:'source' path so it breaks on the shebang.
sources: [ADR-0137, M11]
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

- Push the entry-kind choice into the recursive runner: the browser runner
  spawns the node-entry bootstrap (`setNodeEntryWorkerUrl` URL) with the script
  path as `argv[1]`; the Node conformance runner keeps loader-running the source.
  This refactor is the SAFE REVERSIBLE increment — correct under both transport
  options (B and D), landable NOW on unit/conformance alone.
- Verify with a COI e2e (the shared bin-exec / execSync transport harness) that a
  shebang'd `execSync('node script.js')` returns the child's stdout. **GATED on
  the worker-VFS transport:** the child worker hits the SAME ENOENT (it can't read
  PAGE-memory node_modules / the script's relative imports). Transport fork +
  recommendation: `shell/bin-worker-vfs-transport-b-vs-d.md`. End-to-end waits on
  that; the entry-kind refactor above does not.

## Reversibility

REVERSIBLE — internal execSync dispatch; no public API change.
