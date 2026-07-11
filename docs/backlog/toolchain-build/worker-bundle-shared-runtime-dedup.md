---
area: toolchain-build
status: draft
title: shared @riftydev runtime classes are duplicated per worker bundle → cross-realm class identity (Buffer instanceof) only holds via per-realm global reinstall
created: 2026-06-22
why: every `?worker&url` entry (kernel-worker-entry, dev-server-child-bootstrap, node-entry-bootstrap, real-vite-bootstrap) is self-contained, so `@riftydev/io`'s `Buffer` class (and any other shared runtime class) is emitted ONCE PER bundle. A `kind:'url'` child is `import()`ed INTO the kernel worker realm AFTER the pre-entry hook set `globalThis.Buffer` from the kernel-worker-entry copy — so the global Buffer ≠ the child's `require('buffer')` Buffer. etag (reads the global) then rejects a buffer express built → res.json crash. Patched per-realm (installBundleLocalBuffer), but that is whack-a-mole: every future child bundle must remember, and ANY shared class compared by identity across realms (instanceof) has the same latent hazard.
user_story: As a rifty maintainer I want one `@riftydev/io` Buffer class shared across worker bundles loaded into one realm, so cross-realm `Buffer.isBuffer`/`instanceof` is correct by construction — not by each child bundle remembering to reinstall the global.
sources: [ADR-0030, ADR-0071]
code: [apps/playground/vite.config.ts, packages/workbench/src/workers/worker-runtime-globals.ts, packages/workbench/src/workers/dev-server-child-bootstrap.ts, packages/workbench/src/workers/node-entry-bootstrap.ts, packages/workbench/src/workers/real-vite-bootstrap.ts]
---

## Context

Sibling of `runtime-js/worker-entry-process-globals-side-effect` — same ROOT (worker-chunk
realm hazards), different symptom. There it was a side-effect that LEAKS into another realm;
here it is a CLASS duplicated across bundles so identity (`x instanceof Buffer`,
`Buffer.isBuffer`) diverges between the realm's global and the realm's module loader.

PROD-only: in `pnpm dev` a child `import()` resolves `@riftydev/io` to the dev server's single
served ESM module URL → one class instance in the realm → no divergence. So the dev e2e is
blind to it; the build duplicates the class (verified: the `INSPECT_MAX_BYTES`/`allocUnsafeSlow`
Buffer markers appear in 4 separate worker chunks).

Current mitigation: `installBundleLocalBuffer()` in each `kind:'url'` child bootstrap pins
`globalThis.Buffer` to THAT bundle's copy (= the copy its loader's `require('buffer')` returns).
Correct + matches `runtime-js/worker-entry.ts`, but fragile (per-realm, Buffer-only).

## Options or Next

- **Dedup via a shared worker chunk.** `worker.rollupOptions.output.manualChunks` (or equivalent)
  puts `@riftydev/io` (at least its Buffer module) into ONE chunk imported by all worker entries;
  since children are `import()`ed into the kernel realm, a shared chunk → one class instance →
  the pre-entry global already matches. Removes the per-realm reinstalls. Verify: the Buffer
  marker collapses to ONE chunk in `dist/assets`. RISK: Vite worker/main chunk-sharing is finicky
  — must not break worker boot; gate behind the prod e2e + a `dist` module-graph assertion.
- **OR a build/lint assertion** that fails if a worker chunk carries a duplicated `@riftydev/io`
  Buffer class without a `globalThis.Buffer` reinstall — keeps the cheap deterministic guard even
  if dedup is deferred.

DoD (no partial delivery): pick dedup OR keep+harden per-realm; EITHER way (a) the Buffer marker
either collapses to one chunk OR every loader-bearing worker chunk reinstalls the global, asserted
deterministically on `dist`; (b) `tests/e2e-prod/buffer-realm-identity.spec.ts` stays green; (c) a
note in the CHANGELOG. Pure whack-a-mole removal (delete reinstalls without dedup) is NOT done.

## Reversibility

REVERSIBLE — bundling/chunking + a test; no public API or wire-format change. The per-realm
`installBundleLocalBuffer()` reinstalls stay as defence-in-depth until dedup lands and is proven.
