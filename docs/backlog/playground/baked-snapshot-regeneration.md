---
area: playground
status: active
title: Baked snapshot regeneration policy + git size pressure
created: 2026-06-13
why: the committed snapshot (now 14.3 MB gz) drifts silently when a baked template's install map changes, and every re-bake permanently grows git history
user_story: As a developer picking an instant playground template, I want its baked `node_modules` snapshot to boot instantly with the deps it advertises, but today drift silently falls back to a real install with no CI guard so I lose the instant-boot win unannounced.
sources: [docs/adr/playground/0135-sandbox-setup-kinds-instant-vs-from-scratch.md]
code: [apps/playground/tools/bake-dep-snapshots.ts]
---

## Context

ADR-0135 item 6: instant templates ship a committed gzipped node_modules snapshot (`apps/playground/public/snapshots/`), regenerated manually via `pnpm snapshots:bake`. Drift is SAFE (the worker's deps-equality gate falls back to a real install) but silently loses the instant-boot win until someone re-bakes. Each re-bake adds another multi-MB blob to history.

Update 2026-06-20 (ADR-0162 / Vite 8): the re-baked `vite@8.0.16` snapshot is
**14.3 MB gz, up from ~9 MB** — `@rolldown/binding-wasm32-wasi` adds ~5 MB.
**Decision: defer** the Git-LFS / deploy-time-bake move. The +5 MB is intrinsic to
shipping the Vite 8 instant template, and moving the asset out of git is a
separate infra change (LFS or a deploy-time bake pipeline) outside this Vite 8
support pass. Tracked here; revisit when re-bakes become frequent or another
instant template pushes the committed total materially higher.

## Options or Next

- CI check: bake-dry-run comparing `snapshot.deps` against each template's effective deps; fail on drift (no network needed — compare the committed asset's `deps` field only).
- Range-resolution drift (same ranges, newer published versions) — decide whether periodic re-bakes are wanted at all; the lockfile inside the snapshot keeps installs deterministic either way.
- Git size: Git LFS, or move the asset out of the repo (deploy-time bake) if re-bakes become frequent.

## Reversibility

REVERSIBLE — provisional judgment recorded here; the asset, the bake script, and the restore path can each be swapped independently.
