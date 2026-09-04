---
area: distribution
status: draft
title: no-COI closure exports the complete rejected-route union
created: 2026-09-04
epic: no-coi-sandbox-tier
why: a second fresh CLOSE audit found remaining exact ledger/map dispositions and rejected ADR-0372…0379 routes absent from durable carriers
sources: [ADR-0372, ADR-0375, ADR-0376, ADR-0377, ADR-0378, ADR-0379, docs/backlog/distribution/reference/no-coi-declined-concepts-export-evidence.md]
code: [docs/adr/README.md, docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md]
---

## Context

I1–I10 and both prior ordinary slices are certified. CLOSE still needs the
accepted adopter-demand/M11 premise risk, `spawnSync`, no-own-origin preview
constraint and every route rejected by ADR-0372…0379 or pickup to survive goal
deletion with an exact carrier/drop.

## Challenge

challenge: 2026-09-04 — 1 problems: польза полного переноса отклонённых вариантов обоснована только CLOSE; не рассмотрен более дешёвый архив ledger/map с закреплёнными ссылками на версии ADR и краткой сводкой действующих рисков/ограничений.

## Reference contract

- CLOSE §1: each ledger/map/fog fact gets exactly one carrier or explicit drop.
- CLOSE §2: every concept killed during the goal gets a Declined concepts row.

## Acceptance

1. Durable evidence carries the accepted demand/M11 premise risk, corrects
   `spawnSync` to its existing loud-gap backlog and records the own-origin SW
   constraint exactly. → CLOSE §1
2. Declined concepts contains the union of alternatives rejected by
   ADR-0372…0379 and the rejected duplicate lifecycle subscription. → CLOSE §2

## Parity cases

1. Fresh audit against the deleted/historical ADRs, 176-line ledger and map
   finds no missing rejected route or exact fact. → CLOSE §1, CLOSE §2

## Out of scope

- No goal invariant, product, test, runtime, CI or active ADR decision change.
- `spawnSync` implementation remains outside goal in its existing backlog.

## Decisions

review: ordinary — proof-only
re-cut: 2026-09-04 — ordinary concerns split every remaining pickup/robust alternative into one declined row; CLOSE scope unchanged — trace: none
- 2026-09-04 — draft state avoids fabricated Contract+RED lineage under the captured aggregate gate conflict.
