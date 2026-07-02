---
area: playground
status: draft
title: Instant-preset snapshot restore gates the boot line — overlap it with dev-server boot
created: 2026-07-02
why: setDevConfig awaits prepareActiveDevConfigDeps (baked node_modules download, 9.6-16 MB gz) before the page may echo/dispatch the dev line — on a real network that is seconds of wall-clock where NOTHING else progresses; measured 11 s at 1 MB/s (throttled prod build), burst of command+result at the end
user_story: As a user opening an instant preset on the hosted playground, I want the dev server boot to overlap the dependency restore (and to see restore progress), not to wait serially behind a multi-second download.
sources: [ADR-0148, ADR-0165 §5, throttled prod timeline 2026-07-02 (banner 2.2s → silence → burst 13.2-14.1s)]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/App.tsx, apps/playground/src/glue/project-deps.ts]
---

## Context

`onDevConfig` returns `prepareActiveDevConfigDeps()` (real-vite-bootstrap.ts
~999), so the page's `await setDevConfig(...)` (App.tsx runVitePreset) resolves
only after `restoreInstantDeps` finishes; only then the `$ <line>` echo +
dispatch run. The dev-boot closure re-checks the stamp anyway
(real-vite-bootstrap.ts ~629), so the serialization exists to keep node-cli
presets safe (their `node …` boot lines run via the owner executor with no
deps-await of their own) and to avoid two concurrent restores racing on rm/write.

A page-side slow-progress line (`restoring project dependencies…`, >250 ms)
ships already — this item is the REAL overlap.

## Options or Next

- Single-flight restore promise: `onDevConfig` resolves after the sync config
  assignment; both the dev-boot closure AND the owner node executor await the
  shared `devConfigReady` before touching node_modules — echo/dispatch/vite
  import overlap the download; no double-restore race.
- Owner-side streamed progress (bytes/percent) through `devLog` once the run
  exists — replaces the page-side static line.
- Measure with `pnpm bench --presets` stages (viteReadyMs) under network
  throttle; acceptance: echo ≤1 s after pick on a 1 MB/s link, no regression in
  node-cli preset deps guarantee (parity case: `node` boot line on an instant
  node-cli preset with cold OPFS).

## Reversibility

REVERSIBLE — ordering/overlap change behind existing stamps; no wire or disk
format change. Needs the node-cli deps-await seam decided at implementation.
