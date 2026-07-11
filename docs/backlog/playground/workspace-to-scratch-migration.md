---
area: playground
status: draft
title: Migrate an existing single-era /workspace into multi-project layout
created: 2026-06-21
why: ADR-0165 evolves the OPFS layout from /workspace to /scratch + /projects/<id>/; a user who already warmed /workspace in the single-project era must not silently lose it on first multi-project load
user_story: As an existing playground user with edits persisted in /workspace, I want my work to survive the upgrade to multi-project, but a naive multi-project boot reads /scratch + /projects and would orphan the old /workspace tree.
sources: [ADR-0165, ADR-0013, ADR-0072]
code: [apps/playground/src/App.tsx, packages/workbench/src/workers/real-vite-bootstrap.ts, packages/vfs/src/boot.ts]
---

## Context

ADR-0165 §10 decides the DEFAULT: adopt an existing `/workspace` tree as the initial scratch on first multi-project load (no silent data loss). This item tracks the edge cases that default leaves open:
- `/workspace` present AND a fresh-era `/scratch` already exists (double boot) — which wins?
- the old tree's node_modules + install-stamp slug (preset.id era) vs the new project-scoped slug (ADR-0165 §5) — adopt as-is, or force a re-stamp?
- one-shot migration vs leaving `/workspace` as a tombstone for rollback.

## Options or Next

- On first multi-project boot: if `/workspace` exists and no `/scratch`, move `/workspace` → `/scratch` (reuse the ADR-0165 atomic-safe move + boot-recovery ordering); set its `starter` from the persisted slug if resolvable, else a neutral default.
- Re-stamp node_modules under the new project-scoped slug (or drop + re-arrive via snapshot) to avoid a stale slug reuse.
- Decide tombstone vs delete of the old path.

## Reversibility

REVERSIBLE — the migration is a one-shot data move recorded here; the adopt-as-scratch default is in ADR-0165. Edge-case handling is judgment, no public API change. IRREVERSIBLE only at the moment of moving real user bytes — hence the atomic-safe ordering + a tombstone option until proven.
