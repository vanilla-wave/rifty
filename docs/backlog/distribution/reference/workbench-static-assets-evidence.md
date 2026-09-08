# Workbench static-assets proof

## Baseline / current gap — 2026-09-08

HEAD after producer Final+GREEN 067f1f965. Evidence inherited from
`embedder-gaps-evidence.md` I2 plus these executed reads.

`packages/workbench/tsup.config.ts` keeps `external: [/^@riftydev/]`.
Published worker entries therefore still import sibling packages.

`tests/integration/fixtures/workbench-vite-consumer/src/main.ts` compiles
workers and the SW with `?worker&url`, imports a local
`kernel-worker-entry.ts` wrapper, and reads QuickJS/sqlite via bundler
`?url`. `vite.config.ts` applies `host-builtins.ts` aliases
(`os`/`path`/`fs`/`perf_hooks` → `@riftydev/runtime-js/builtins/*`).

`tests/integration/workbench-packed-consumer-contract.test.ts` currently
requires those wrappers and aliases (kernel listener-before-yield and
builtin-subpath cases). I2 inverts that: a packed host copies published
files and writes none of them.

No `dist/runtime/` closure exists. `packages/workbench/dist/` is build
output only and is not a copyable asset set.

Contract+RED @ 1d0f317 was blocked (REV-12): tautological missing-asset
name, comment-satisfiable kernel greps, and no manifest-header clause.
Carriers now: incomplete-copy fetch of an omitted listed file, ADR-0352
kernel URL-before-listener, and `manifest.headers`.

Vitest 2.1.9 / Node v24:

```text
pnpm exec vitest run packages/workbench/src/runtime-assets.contract.test.ts \
  tests/integration/workbench-static-assets.contract.test.ts
6 failed / 0 passed.
- copyable runtime asset manifest.json missing under dist/runtime/
- packed consumer main.ts still matches ?worker&url
```

Failures are the missing copyable closure and the still-compiling consumer,
not import or typecheck.
