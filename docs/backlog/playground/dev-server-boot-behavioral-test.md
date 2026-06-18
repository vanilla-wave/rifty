---
area: playground
status: active
title: Replace dev-server-boot source-string assertions with a behavioral boot test
created: 2026-06-18
why: dev-server-boot.test.ts pins literal source substrings, not runtime behavior — a behavior-preserving refactor false-reds and dead code with the right string false-greens
sources: [PR#42 review tests-source-string-3]
---
## Context
`apps/playground/src/workers/dev-server-boot.test.ts` asserts the module's source TEXT (`expect(source).toContain('function handleViteFileChange…')`, `not.toContain('server.hmr.channels')`, …). It guards the HMR architecture-move wiring at the source level but exercises no runtime behavior. The behavioral guard for the central scope lives only in `tests/integration/vite-hmr-channel.test.ts` (real Vite `server.ws` over rifty upgrade). Pre-existing pattern; PR#42 only updated the pinned strings.

## Options / Next
Where feasible: boot `bootDevServer` against a fake Vite + an owner VFS, write a file, assert the Vite watcher sees a `change` / `invalidateViteModule` runs — i.e. test the effect, not the source. Keep source-pinning only for genuinely non-runtime wiring (e.g. plugin-list shape) and label it as such.

## Reversibility
REVERSIBLE — test-only. No production behavior changes.
