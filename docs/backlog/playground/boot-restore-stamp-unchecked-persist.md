---
area: playground
status: draft
title: Boot/restore stamp rides the write-through unchecked — a per-op persist failure can stamp a torn tree
created: 2026-07-04
why: ADR-0187 Corrected gated the VISIBLE `npm install` stamp on a clean persist report, but the boot/restore stamp (`stampTree`, project-deps.ts) stays deliberately non-blocking — it cannot check a drain it never awaits, so a swallowed quota/perm failure on tree writes + a succeeded stamp write persists a stamp the next boot trusts over a torn tree
user_story: As a user whose OPFS hit quota during a preset boot, I want the next reload to re-run dependency arrival instead of booting vite over a half-persisted node_modules with confusing module-not-found errors.
sources: [ADR-0187 (Corrected 2026-07-04), ADR-0135]
code:
  [
    apps/playground/src/glue/project-deps.ts,
    packages/vfs/src/opfs-sync.ts,
    apps/playground/src/glue/install-stamp.ts,
  ]
---

## Context

PR #107 round 10 added the persist-failure ledger (`OpfsFsSync.flush()` returns a `PersistFailureReport`) and gated the `npm install` stamp on a clean tree drain. The boot/restore stamp is non-blocking BY DESIGN (ADR-0187: no drain, saves ~0.5s on the boot critical path), so the same gate can't be applied as-is — at stamp time the tree's write-throughs haven't settled, and the ledger can't know future failures.

## Options or Next

- Deferred check: after boot completes (off the critical path), drain + read the ledger; on a dirty report REMOVE the stamp (rm rides the same FIFO; an OPFS-side missing stamp then re-runs arrival) + surface a console/terminal warning.
- Boot-time distrust: `installStampSatisfied` already re-reads the stamp from OPFS on the NEXT boot — add a cheap tree spot-check (e.g. lockfile + a sampled package.json exist) before trusting it.
- Measure first whether the window is real: arrival's tree writes may already be durable before `stampTree` runs in practice.

## Reversibility

REVERSIBLE — mitigation choice, recorded here. No public API change beyond what ADR-0187 Corrected already added.
