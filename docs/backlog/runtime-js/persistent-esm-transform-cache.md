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
