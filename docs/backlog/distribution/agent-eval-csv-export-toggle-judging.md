---
area: distribution
status: ready
title: Observe current-filter CSV output across Export toggles
created: 2026-10-07
why: A captured working CSV app is rejected when a repeated Export action closes its already valid output.
epic: agent-code-quality-evaluation
sources: [ADR-0513, ADR-0515]
code: [tools/agent-bench/corpus/cases/csv-workflow-v5/judge.ts, tools/agent-bench/tests/csv-export-toggle-controls.ts]
---

## Context

Observed eval-v4/COI1: six private checks pass; name-filter check fails.
Exact programme native public7 PASS/currentprivate6-of7 RED; no own-origin rescue.
Evidence: `reference/agent-eval-csv-export-toggle-independent-red.json.gz`.
Old55/96 interrupted/41missing and two offline regenerations retained in
`reference/agent-eval-v4-export-toggle-interrupted.json.gz`.

## Challenge

challenge: 2026-10-07 — clear; accepted goal/public CSV promise and independent
executed defect verification reused (`RDY-8`); no new plan or user scope choice.

## Reference contract

Original CSV prompt permits accessible output OR download; DOM/layout open.
Node24.16/npm11.17/Vite7.3.6/Chromium148 real captured programme: current-filter
CSV visible before Export, repeated press closes panel; normal reopen/download
works. Judge cannot require an idempotent panel-opening action (`RDY-8`).

## Acceptance

1. Preserve captured full public7/privateRED/programme and old selected outcomes; no native rescue or retrospective rescore. → I3/I6/I9
2. New CSV judge reads current-filter output before/after the public Export action or download; validates unchanged exact decoded records/multiplicity and existing seven requirements. → I3/I6
3. Actual reference/alternative/captured positives pass and stale/missing/duplicate/absent export or persistence faults fail; all four origins retain their physical controls and failures. → I3/I6
4. CSVv5/eval-v5 preserves every public project/prompt/lock/control and other seven judge entries; old versions immutable; unblock linked fresh full96 only after source/control independent Final. → I7/I9

## Fault matrix

| Axis × operation | Honest result | Proof |
|---|---|---|
| observable-order/frozen-assumption × repeated Export closes visible output | current-filter exported values remain observable | native captured RED→GREEN, before/after state evidence → I3/I6 |
| lossy-aggregate × stale/missing/duplicate output | reject changed records/multiplicity | real semantic negative controls → I3/I6 |
| sibling-drift × mirrored judge/four origins | same requirements, own-origin outcome | version byte proof, native/origin controls → I3/I6 |

## Out of scope

Runtime/package compatibility changes, universal UI parsing, storage-schema
inspection and old-result rescore/resume. I10/I11 stay with diagnostics.

## Decisions

- 2026-10-07 — observed-defect baseline and independent RED accepted; no new promise/Contract+RED; Final+GREEN required.
- 2026-10-07 — active-owner sweep: one exportFor owner per version, mirror certified by byte test; historical CSVv1–4 criteria preserved under I7/I9, all four active export observations corrected in v5.
- 2026-10-07 — extending ADR0513's public-export seam; ADR0513 remains active, no storage/UI/parser/runtime feature change.
