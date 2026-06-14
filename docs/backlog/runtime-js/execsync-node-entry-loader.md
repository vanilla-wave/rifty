---
area: runtime-js
status: active
title: Route execSync's child through the node-entry bootstrap (shebang + relative imports)
created: 2026-06-14
why: child_process.spawn('node', …) runs its worker child through the node-entry bootstrap (ADR-0137) so a shebang'd / relative-import script runs via the module loader; execSync's recursive runner still builds a raw kind:'source' spec, so the same script breaks under execSync — inconsistent
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
- Verify with a COI e2e (the shared bin-exec / execSync transport harness) that a
  shebang'd `execSync('node script.js')` returns the child's stdout.

## Reversibility

REVERSIBLE — internal execSync dispatch; no public API change.
