---
area: runtime-js
status: active
title: Route execSync's child through the node-entry bootstrap (shebang + relative imports)
created: 2026-06-14
why: child_process.spawn('node', …) is wired to the node-entry bootstrap (ADR-0137) so a shebang'd / relative-import script goes through the module loader, while execSync's recursive runner still builds a raw kind:'source' spec — inconsistent dispatch. The historical shell `.bin` worker-transport blocker is closed; this residual is now only execSync entry-kind parity.
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
  was wrong for the then-production path: `execSync` worked in COI because the handler
  built `kind:'source'` carrying the script BYTES in the spec, while a `kind:'url'`
  child read from its own empty store and regressed `tests/e2e/execsync-sab.spec.ts`.
  The shell `.bin` transport is now closed by the owner-worker child path, but this
  recursive runner still needs its own node-entry routing decision and regression tests.
- Keep `execSync` on `kind:'source'` until the recursive runner can route browser child
  specs through node-entry without breaking the Node-hosted conformance substitute.
  Then shebang/relative-import `execSync` can share the same loader path as
  `child_process.spawn('node', …)`.
- The shebang/relative-import gap is loud, not silent: `// TODO` at `ipc/handlers.ts`
  (the `kind:'source'` spec-build site), this item, and ADR-0143's phasing.

## Reversibility

REVERSIBLE — internal execSync dispatch; no public API change.
