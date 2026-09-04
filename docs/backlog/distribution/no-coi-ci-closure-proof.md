---
area: distribution
status: ready
title: no-COI CI job carries the exact full-reload durability proof
created: 2026-09-04
epic: no-coi-sandbox-tier
why: frozen I8 requires one no-COI CI lane to prove I1-I7/I9/I10, but its job omitted the already-landed I5 full-reload carrier
sources: [ADR-0372, docs/backlog/distribution/reference/no-coi-hmr-spike-record.md]
code: [.github/workflows/ci.yml, playwright.no-coi.config.ts, tests/browser-unit/opfs-no-coi-policy.spec.ts, tests/no-coi, tools/checks/ci-change-scope.test.ts]
---

## Context

`no-coi-chromium` runs `pnpm test:no-coi`, whose config selects only
`tests/no-coi`. I1-I4/I6-I7/I9-I10 run there, while certified I5 exact-byte
flush → page reload → fresh Worker read runs only in `browser-unit-chromium`.
The product and carrier are already green; only the frozen I8 CI composition
is incomplete.

## Challenge

challenge: 2026-09-04 — clear

## User scenario

The required no-COI Chromium job executes the whole shared-memory-free goal,
including acknowledged OPFS persistence across a full page reload.

## Reference contract

- Goal I8: one no-COI CI lane proves I1-I7/I9/I10 in real Chromium.
- ADR-0372: sync-handle-capable no-COI Workers select OPFS.
- Landed I5 carrier: `opfs-no-coi-policy.spec.ts:332`.

## Acceptance

1. `no-coi-chromium` runs both the full `tests/no-coi` suite and the exact I5
   full-page-reload carrier; the required remote job passes. → I8

## Parity cases

1. Local proof and CI execute the same committed no-COI suites and Chromium
   fixture, with no copied or alternate implementation. → I8

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `false-fallback` × CI selection | omitting I5 leaves the no-COI job incomplete | remove the second workflow step; remote job no longer runs the named carrier → I8 |

## Out of scope

- No product, test behavior, new fixture, retry or browser matrix change.
- No change to frozen goal wording or I5 semantics.

## Decisions

review: ordinary — proof-only
- 2026-09-04 — reuse the certified browser-unit test as a second no-COI job step; no duplicate carrier.
