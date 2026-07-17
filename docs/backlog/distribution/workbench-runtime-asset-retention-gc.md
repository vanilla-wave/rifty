---
area: distribution
status: draft
title: Workbench runtime-asset retention, GC, and quota recovery
created: 2026-07-17
why: the owner-private content store retains verified objects and receipts until whole-cache clear, so version updates and more substituted packages can accumulate bytes with no selective safe reclamation
user_story: As a browser-IDE user, I want old runtime assets reclaimed before they exhaust origin quota without deleting bytes used by my runnable projects, but today recovery is an all-cache clear followed by redownload
blocked_by: [distribution/workbench-runtime-asset-storage]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/backlog/vfs/storage-pressure-and-eviction-ux.md, docs/backlog/playground/project-node-modules-quota-gc.md]
code: [packages/workbench/src]
---

## Context

ADR-0249 deliberately ships no automatic GC or quota eviction. Content-addressed
objects, immutable receipts, and ready pointers survive sequential projects and
Workbench lifetimes; pin updates and future packages can leave unreachable
verified state. Public `inspect()` reports usage and `clear()` removes all asset
state only while the Workbench is idle.

Selective reclamation must not infer liveness from project count, current
manifest text, or a bounded failure sample. One owner needs a measured retention
policy over ready pointers, active exact-plan sessions, in-flight publication,
and crash residue. Quota failure remains loud and cannot evict a live object or
turn missing bytes into a valid receipt.

Path to ready: measure real accumulation/quota pressure after alias retirement
and a second asset-bearing package, then choose one owner-held reachability or
generation model. Define recovery UX with
`playground/runtime-asset-cache-recovery-ui`; reuse general origin-pressure
language from `vfs/storage-pressure-and-eviction-ux` without merging state
owners.
