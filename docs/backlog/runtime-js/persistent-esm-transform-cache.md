---
area: runtime-js
status: draft
title: Persistent ESM transform cache across loader instances
created: 2026-07-02
why: the esmAstCache (acorn parse — the heaviest per-module CPU step) is a Map inside each loader instance (loader.ts:131-144); every dev-server child boot re-parses the whole vite dist (megabytes of JS), repeating identical work on every preset pick / dev-server restart
user_story: As a user booting a Vite preset, I want the "importing vite…" phase to not re-pay acorn parsing of an unchanged vite dist on every boot.
sources: [Q-2026-05-30-202, pnpm bench presetBootToPreviewLiveMs stages]
code: [packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/esm-ast.ts]
---

## Context

`cachedTransformEsm` validates by (id, source-text) but lives per loader
instance; the dev-server child creates a fresh loader per boot
(dev-server-boot.ts `createModuleLoader`), so the cache never survives a
respawn. A persistent cache (OPFS, keyed by content hash) would carry the
transform results across boots. Q-2026-05-30-202 already records the open
decision (`transformEsm` result cache + optional hook on `EsmLoaderDeps`);
resolving it needs an ADR: storage location, key (content hash vs id+text),
invalidation, and cross-realm sharing (owner vs child).

## Fault matrix (binding for the ADR — contract before the cache is built; fault-honesty refine 2026-07-05, the `fault-honest-build-caches` epic dissolved into this contract: all in-memory loader caches are already fault-proven — source-text-validated hits + invalidation tests in loader-transform / loader-esm-ast-cache / resolver-cache / loader-invalidate)

- `poisoned-cache` × corrupt/truncated OPFS entry → entry self-validates against its content-hash key on read → miss + overwrite (self-heal); wrong code is NEVER executed.
- `poisoned-cache` × rifty/esbuild version change → version in the key → old entries unreachable; no cross-version reuse.
- `torn-state` × crash mid-put → invalid entry on next read → same self-heal miss.
- `false-fallback` × put fails (quota) → transform proceeds uncached (accelerator-only; persist failure lands in the vfs ledger, never fails the transform).
- `concurrent-same-key` × two loaders, same hash → deterministic transform ⇒ byte-identical value; last-write-wins acceptable, put-serialization is perf-optional.
- `unbounded-read` × N/A (no network; entry size = own transform output) — recorded as consciously empty.

## Options or Next

- Measure first: add a boot-stage timer around `loader.import('vite')` or use
  the bench `presetBootToPreviewLiveMs` stages to size the win before the ADR.
- ADR draft: OPFS store keyed by sha-256(source) → TransformResult; loader hook
  point per Q-2026-05-30-202; never cache across rifty versions (bust on
  package version).
- Out of scope: caching USER project files (they churn; in-memory per-instance
  cache already covers a running session).

## Reversibility

IRREVERSIBLE parts (cache format/hook API) go through the ADR; the backlog item
itself is the measurement + proposal step.
