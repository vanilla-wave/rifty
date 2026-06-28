---
area: playground
status: draft
title: Wire from-scratch presets to eddy fast install
created: 2026-06-28
why: from-scratch presets (snapshotUrl undefined, honest install) pay the full cold install; pinning them exact + lockfile makes eddy's bundle a perpetual immutable cache hit, and a sandbox toggle exposes fast mode
user_story: As a first-time visitor clicking a from-scratch preset I want the install to finish in ~0.6s, but today those presets run the full ~4s cold install while instant presets are already snapshot-backed.
epic: fast-install-resolver
blocked_by: [npm-client/eddy-client-opt-in]
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/adr/playground/0135-sandbox-setup-kinds-instant-vs-from-scratch.md]
code: [apps/playground/src/presets.ts, apps/playground/src/templates/project-spec.ts, apps/playground/src/glue/project-deps.ts]
---

## Context

Instant presets already use ADR-0135 baked snapshots (lockfile + extracted tree, zero network). Eddy serves the OTHER two cases: from-scratch presets (`snapshotUrl: undefined`, intentional visible install) and user-authored `package.json`. For from-scratch presets, pinning EXACT versions + shipping a committed lockfile makes their `closure-hash` permanently stable → eddy bundle is a perpetual immutable cache hit (and `prefer:'online'` still lets a user force fresh). The sandbox toggle flips the public `resolverUrl`/`installMode` seam (`npm-client/eddy-client-opt-in`); the resolver URL comes from env-config (D-004), default OFF.

## Open forks (resolve to reach ready)

- Which from-scratch presets opt in, and the exact-pin + committed-lockfile policy for each (top-level exact ≠ whole-tree deterministic, so the lockfile is what pins the closure).
- The sandbox toggle UX (per-preset default vs user switch) + how provenance (eddy vs standard path) is surfaced in the terminal.
- A deliberate re-pin / re-bake CADENCE so pinned templates don't rot (no auto patch uptake) — owner + frequency.
- Reconcile with the ADR-0135 instant-preset path (eddy must not regress or duplicate baked snapshots).
