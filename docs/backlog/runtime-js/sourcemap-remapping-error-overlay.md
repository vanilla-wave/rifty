---
area: runtime-js
status: active
title: Source-map remapping for TS/JSX guests + error overlay
created: 2026-06-11
why: .ts/.tsx errors point at transpiled JS positions (the loader appends //# sourceURL only — no map consumption, no Error.prepareStackTrace remap), so debugging a real TS project feels broken — a core M11 DX gap
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0052]
code: [packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

The loader injects esbuild's TS/JSX transform but only appends a `//# sourceURL` comment (esm.ts,
cjs.ts, worker_threads.ts) — it does not consume esbuild's sourcemap output or remap stack traces, so
errors in `.ts`/`.tsx` show transpiled line numbers. esbuild already emits maps; wiring them through
the loader's transform path + an `Error.prepareStackTrace` remap is bounded. The genuinely useful —
and harder — part is remapping errors thrown in spawned Worker processes, not just the main realm.
`prepareStackTrace` is V8-only (fine, Chrome-first). On the M11 "embeddable / runs real-ish projects"
theme.

## Options or Next

- Consume esbuild sourcemaps via the transform hook; key them alongside the existing strip cache.
- Implement `Error.prepareStackTrace` remap scoped to guest realms (preserve V8 frame fidelity).
- Remap cross-realm: errors from spawned Worker processes, not only the page realm.
- Surface an error overlay in the playground/workbench.

## Reversibility

REVERSIBLE — loader/runtime-internal; `prepareStackTrace` is process-global so scope it to guests.
Recorded here.
