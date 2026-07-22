---
kind: epic
status: ready
title: Extraction-ready page realm — glue carved on the Workbench seam over one correlation substrate
created: 2026-07-22
value: Embedder extraction becomes mechanical and mutation outcomes stop lying under a slow owner — one correlation substrate, an enforced package seam, owned directories.
user_story: As a SaaS developer waiting on @riftydev/workbench, I want the page realm pre-carved along the package boundary, but today extraction starts with an unowned 101-file glue sort and nine hand-rolled correlation engines whose timeouts can report failure for writes that later apply.
tier: robust
items: [playground/page-owner-correlation-substrate, playground/glue-extraction-carve, playground/substrate-migration-mutation-channels, playground/substrate-migration-read-channels]
---

## Outcome

One substrate owns page↔owner request/reply correlation (ADR-0305): mutations settle on the owner's terminal or proven owner death — never a deadline-asserted failure; reads keep bounded deadlines. `glue/` is carved along the `@riftydev/workbench` extraction seam (ADR-0306) with depcruise rules and per-subdir owner READMEs, so `distribution/workbench-controllers` extraction steps start from an enforced boundary. Per-port correlation engines are deleted as channels migrate.

## User scenario

A developer edits and saves a file while the owner is stalled: the save resolves to the owner's true outcome, or to an honest owner-death failure — never "save failed" followed by a phantom late apply. Every green-path flow behaves byte-identically (channel contract suites unchanged). Coarse closing invariants: substrate is the only correlation owner in the page realm; `check:arch` seam rules and `check:dir-owner` green; a stalled-owner save in the real Workbench settles exactly once.

## Items

Dependency-ordered; the substrate is the shared mechanism and lands first with a real consumer (no dummy adapter).

- `playground/page-owner-correlation-substrate` (draft) — inventory every correlation engine, spike the carrier/death-signal per ADR-0305, land the substrate with `owner-vfs-client` as first mutation consumer.
- `playground/glue-extraction-carve` (draft) — carve glue subdirs on the ADR-0306 seam + owner READMEs + depcruise seam rules.
- `playground/substrate-migration-mutation-channels` (draft) — migrate remaining mutation channels (git, archive import, session tools) onto the substrate; delete their engines.
- `playground/substrate-migration-read-channels` (draft) — migrate read channels (node-modules, workspace file read, ts-ls, project index) onto the substrate; delete their engines.

## Budget

- scope implemented outside ready items: 0
- in-place ready-contract edits alongside source changes: 0 (`check:contract-drift`)
- new coordination mechanisms: 1 — the substrate (item 0); any second is a violation
- review rounds per item: ≤ 2
- per-item diff estimate: substrate ~1–2k; carve — mechanical moves + rules; each migration wave ~0.5–1k

## Scope boundaries

- `workbench-fault-honesty` (PR #158, open) terminal-certainty children cite the absorbed `correlated-broadcast-bridge-helper` slug; on merge re-point them to `page-owner-correlation-substrate` — they shrink to per-channel adoption plus their RED cases. Persistence/health items are untouched.
- `@riftydev/net` `preview-port` stays its own copy (lower layer; ADR-0305).
- No public API change; extraction itself stays in `distribution/workbench-controllers`.
