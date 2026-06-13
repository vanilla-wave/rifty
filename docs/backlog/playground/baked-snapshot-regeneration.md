---
area: playground
status: active
title: Baked snapshot regeneration policy + git size pressure
created: 2026-06-13
why: the ~9 MB committed snapshot drifts silently when a baked template's install map changes, and every re-bake permanently grows git history
sources: [docs/adr/playground/0135-sandbox-setup-kinds-instant-vs-from-scratch.md]
code: [apps/playground/tools/bake-dep-snapshots.ts]
---

## Context

ADR-0135 item 6: instant templates ship a committed gzipped node_modules snapshot (`apps/playground/public/snapshots/`), regenerated manually via `pnpm snapshots:bake`. Drift is SAFE (the worker's deps-equality gate falls back to a real install) but silently loses the instant-boot win until someone re-bakes. Each re-bake adds another ~9 MB blob to history.

## Options or Next

- CI check: bake-dry-run comparing `snapshot.deps` against each template's effective deps; fail on drift (no network needed — compare the committed asset's `deps` field only).
- Range-resolution drift (same ranges, newer published versions) — decide whether periodic re-bakes are wanted at all; the lockfile inside the snapshot keeps installs deterministic either way.
- Git size: Git LFS, or move the asset out of the repo (deploy-time bake) if re-bakes become frequent.

## Reversibility

REVERSIBLE — provisional judgment recorded here; the asset, the bake script, and the restore path can each be swapped independently.
