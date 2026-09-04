---
area: distribution
status: ready
title: no-COI test lane carries the exact full-reload durability proof
created: 2026-09-04
epic: no-coi-sandbox-tier
why: frozen I8 requires one no-COI CI lane to prove I1-I7/I9/I10, but its job omitted the already-landed I5 full-reload carrier
sources: [ADR-0372, docs/backlog/distribution/reference/no-coi-hmr-spike-record.md]
code: [playwright.no-coi.config.ts, tests/browser-unit/opfs-no-coi-policy.spec.ts, tests/no-coi/no-coi-opfs-reload.spec.ts]
---

## Context

`no-coi-chromium` runs `pnpm test:no-coi`, whose config selects only
`tests/no-coi`. I1-I4/I6-I7/I9-I10 run there, while certified I5 exact-byte
flush → page reload → fresh Worker read lived in `tests/browser-unit`.
Move that exact carrier into the selected directory; product behavior and its
fixture stay unchanged.

## Challenge

challenge: 2026-09-04 — clear

## User scenario

The required no-COI Chromium job executes the whole shared-memory-free goal,
including acknowledged OPFS persistence across a full page reload.

## Reference contract

- Goal I8: one no-COI CI lane proves I1-I7/I9/I10 in real Chromium.
- ADR-0372: sync-handle-capable no-COI Workers select OPFS.
- Landed I5 carrier moves intact to `no-coi-opfs-reload.spec.ts`.

## Acceptance

1. `pnpm test:no-coi` discovers the exact I5 full-page-reload carrier beside
   I1-I4/I6-I7/I9-I10; the required remote job passes. → I8

## Parity cases

1. The certified I5 assertions and Worker fixture move intact; local proof and
   CI execute that same committed spec, with no alternate implementation. → I8

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `false-fallback` × test discovery | moving I5 outside `tests/no-coi` leaves the no-COI job incomplete | exact title is absent from `pnpm test:no-coi`; moved carrier makes it pass → I8 |

## Out of scope

- No product, test behavior, new fixture, workflow, retry or browser matrix change.
- No change to frozen goal wording or I5 semantics.

## Decisions

review: ordinary — proof-only
re-cut: 2026-09-04 — move the certified I5 spec into the existing no-COI testDir instead of adding a workflow step; restores ordinary contract-drift and artifact ownership — trace: none
- 2026-09-04 — one moved carrier, no duplicate implementation.
