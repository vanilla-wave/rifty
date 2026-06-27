---
area: playground
status: draft
title: Per-project node_modules quota probe + GC policy
created: 2026-06-21
why: multi-project keeps node_modules in-place per project with no purge on switch (ADR-0165) — many projects × node_modules grows OPFS unbounded; no quota probe, no eviction
user_story: As a playground user with several saved projects, I want the IDE to not silently exhaust my browser storage quota (and to tell me + reclaim space when it's tight), but today every project's node_modules stays on disk forever and a quota overflow surfaces only as an opaque OPFS write failure.
sources: [ADR-0165, ADR-0135]
code: [apps/playground/src/glue/project-deps.ts, apps/playground/src/glue/install-stamp.ts, packages/vfs/src/boot.ts]
---

## Context

ADR-0165: per-project node_modules live in-place (`/projects/<id>/node_modules`, `/scratch/node_modules`), NO purge/regenerate on switch (local disk + baked snapshots are rifty's edge-cache equivalent). The install-stamp is root-relative so trees are isolated, but nothing bounds total size. With N projects each carrying a vite/express tree (vite snapshot alone ~9 MB), OPFS fills; a quota overflow today is an opaque write error, not an honest UX.

`navigator.storage.estimate()` gives usage/quota; `persist()` is M11. No GC: a deleted project's tree IS removed (delete path), but inactive projects' node_modules are never evicted.

## Options or Next

- Probe `storage.estimate()` on save/switch; surface a usage indicator + an honest out-of-space banner (fidelity: never silently drop files).
- GC policy fork: (a) evict node_modules of the LRU inactive project (re-derivable from stamp→snapshot→install on next activation), keeping source; (b) never auto-evict, only user-triggered "free space"; (c) cap project count. Trade-off: eviction re-pays install cost on reactivation vs unbounded growth.
- Tie into M11 `persist()`/quota + out-of-space UX theme.

## Reversibility

REVERSIBLE — scope/sequence as a backlog item. The GC policy (auto-evict vs manual) is a judgment call recorded here; no public API or disk-format change (eviction removes a re-derivable subtree). Deferred to M11 quota work by ADR-0165.
