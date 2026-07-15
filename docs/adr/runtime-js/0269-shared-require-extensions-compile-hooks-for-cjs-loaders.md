# ADR 0269: shared require.extensions compile hooks for CJS loaders

Status: Accepted
Date: 2026-07

> TL;DR: every loader-created `require` shares one real JavaScript extension
> hook; its module object can compile replacement source through
> `module._compile`.

## Context

Vite 8 loads a `vite.config.js` in a CommonJS package by bundling it to CJS,
temporarily replacing `createRequire(...).extensions['.js']`, and calling
`module._compile(bundledCode, filename)` for that exact file. This is standard
Node package-tooling behavior.

rifty exposed a fresh empty `extensions` object from each `createRequire`
wrapper and never consulted it. Its CJS module object also lacked
`_compile`. The assignment therefore appeared to succeed while
`require(config)` silently compiled the original ESM-looking source and failed
with `Unexpected token 'export'`. A second wrapper in `node-entry` replaced
the loader's factory, preserving the same sibling drift.

The Workbench split stopped bypassing Vite's config loader, so the latent
runtime gap became a direct Vite A→B→A user blocker. Fault classes:
`sibling-drift` (two detached require factories) and `observable-order`
(the registered loader hook was skipped before source compilation).

## Decision

- `createModuleLoader` owns one mutable, null-prototype JavaScript extension
  table and one `makeRequire(from)` factory. CJS-local `require` and every
  `createRequire` receive that same table.
- The callable default `.js` loader compiles the resolver-owned original
  source. A temporary tool hook can delegate non-target files back to that
  saved loader.
- CJS execution creates one module object before dispatch. Its
  `_compile(source, filename)` runs replacement source directly on that same
  object without redispatching the extension hook. Relative `require`,
  dynamic import, `__filename`, `__dirname`, source attribution, and
  Function routing all use the supplied filename.
- A thrown hook or compile removes the failed loading record exactly like an
  ordinary failed CJS evaluation.
- `node-entry` no longer publishes a second require factory.

Rejected:

- change the generated config to `.mjs`, CJS text, or inject
  `package.json.type` — changes consumer project semantics and only avoids one
  branch of the broken Node mechanism;
- a Vite-name/path special case — package tooling besides Vite uses the same
  public Node hook;
- copy the hook table between require wrappers — mutations and restoration
  would still drift by wrapper identity.

## Consequences

- (+) Real Vite config bundling executes its generated CJS bytes; nested
  JavaScript dependencies still use the saved default loader.
- (+) Differential parity pins the exact Vite-shaped hook/`_compile` sequence
  against Node; the Chromium Workbench proof remains the acceptance test.
- (−) The extension table is process-loader mutable state. One loader-owned
  object, not per-require copies, defines its lifetime.
- (=) `require.cache` records/invalidation remain explicitly unsupported and
  tracked by `runtime-js/require-cache-module-record-surface`; this decision
  does not claim config hot-reload cache parity.
- (=) Custom JSON and native-addon extension loaders remain outside the
  JavaScript-hook claim; ordinary JSON loading is unchanged and native addons
  remain a loud browser ceiling.
