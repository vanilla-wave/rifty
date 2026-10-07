---
area: distribution
status: ready
title: Observe editable controls through accessible names
created: 2026-10-07
why: Raw label text includes textarea/option data and rejects correctly named controls or matches another field.
epic: agent-code-quality-evaluation
sources: [ADR-0512, ADR-0516, ADR-0517]
code: [tools/agent-bench/src/judge/context.ts, tools/agent-bench/tests/editable-control-names.spec.ts, tools/agent-bench/tests/native-input-roles.spec.ts, tools/agent-bench/tests/editable-name-origin-controls.ts]
---

## Context

Eval-v6 booking Room lookup times out. Exact captured HTML native Chromium148:
getByLabel0/getByRole1. Pinned reference40PASS; remove only one separator space:
same accessible name, old private13RED. Options change raw caption eligibility.
Textarea prose and multiple-select data also collide with another purpose.
Evidence: `reference/agent-eval-editable-name-native-history.json.gz`.

Independent Finalb836 found B1: labelled native checkbox role=switch works at
BASE0f6, current getter loses it. Same role assumption also loses permitted
menuitemcheckbox/menuitemradio/option and native button role overrides.
Baseline65GREEN; prior source45RED/20GREEN; shared-owner fix73GREEN.
Proof: `reference/agent-eval-native-role-override-proof.json.gz`.

## Challenge

challenge: 2026-10-07 — clear; accepted I3/I6/named controls/open DOM and executed
baseline reused (RDY-8). Observed defect; no new promise/Contract+RED or user fork.

## Reference contract

Actual accessible names identify controls; values never supply another field's
purpose. Existing native input kinds, explicitly labelled contenteditable,
readonly/disabled exclusion and named-control rejection remain. Public eight
projects/prompts/locks/controls unchanged; native representability unchanged.

## Scope

Shared editableControl owner, two versioned case/mirror directories and eval-v7.
Other six case entries unchanged. Every resolved context fingerprint changes;
prior criteria/source/results retained, never rescored. Runtime/modules/config,
public requirements and actor settings unchanged. I10/I11 remain goal work.

## Out of scope

New runtime capabilities, task requirements, models/settings, retrospective
rescore/resume, Svelte bootstrap repair and goal closure by this unit.

## Fault matrix

Traced boundary: Owned in-process policy/graph projection (fault-classes.md).
Axes: frozen-assumption/lossy-aggregate. Birth: raw DOM label appends control
values, unlike named control role. Transport loss/dup/reorder physically excluded
only at this pure projection, not browser lifecycle/runner/storage boundaries.

| Operation | Reachable fault | Test/proof |
| --- | --- | --- |
| combobox | options erase caption word boundary | Room dynamic regression; native40→13; four-host bare label  → I3/I6/ADR-0517 |
| textbox | textarea prose becomes Title purpose | native prose regression; four-host Vue textarea  → I3/I6/ADR-0517 |
| listbox | person data becomes Payer purpose | native multiple-select regression; real alternative controls  → I3/I6/ADR-0517 |
| native input | kind/role assumption loses existing surface | native65 BASE/45RED; current73GREEN; role guard45RED/28GREEN→exact73GREEN  → I3/I6/ADR-0517 |
| labelled generic editable | no standard role despite explicit label | contenteditable regression/reversion; four-host consumer  → I3/I6/ADR-0517 |
| mutable control | readonly/disabled output selected | native exclusion regression  → I3/I6/ADR-0517 |
| unnamed control | shortcut/placeholder accepted as purpose | negative Search regression  → I3/I6/ADR-0517 |

Call-site sweep: all booking/expense case versions and mirrored oracles share
this owner; native-input producers and workflow controls also consume it.
Validation/output/filter reads retain existing authority; no inferred defect
without a reproduction. No per-case caption patch, retry or state mechanism.

## Acceptance

- Native external gold + baseline RED before fix; three class regressions RED. → I3/I6
- Shared owner passes8 native tests; guards revert RED3/1/1, exact restore8GREEN. → I3/I6
- Preserve native ARIA role overrides: external semantic gold, BASE65GREEN,
  actual65 interactions, unchanged8 regression tests, role-family guard RED. → I3/I6
- Actual consumer/control outcomes in all four hosts, retained failures and
  source correctness distinct from own-host success; before/after/noModels proof. → I3/I6
- Versioned criteria/source hashes; public inputs/history preserved. → I8/I9
- Full pr:check and fresh independent Final before fresh comparison. → REV-5

## Checks

Actual native8GREEN, bench typecheckPASS, Vue original/bare40 each; one cold
bare run fails with observed HMR reload, original retained; exact isolated source
40PASS/noHMR. All48 own-origin controls completed:29PASS19FAIL, noModels.
Three source-positive expense COI fail before semantic proof at current exact
style-import CORS; fourth partial also bootstrap-fails. Baseline has no such
receipt. Other hosts pass positives; source negatives remain unsuccessful.
Two offline passes preserve327 authoritative files/identical derived output.
Details: `reference/agent-eval-editable-name-evidence.md`. Full pr:check27/27 PASS (unit201s/parity114.7s); independent Final pending.

That gate/48 controls belong to b836 source. Its independent Final BLOCK B1;
history remains unchanged. Current role repair passes73 native tests and bench
typecheck; current full pr:check27/27 PASS (unit206.5s/parity114.5s), fresh independent Final pending.

## Decisions

ADR0517; extend prior observation seam, no superseded decisions. Shared context
is the smallest owner; field-kind assumptions checked on actual browser.

## Residuals

Unit: B1 repair current gate27/27 PASS; fresh independent Final pending. Goal: new full96, I10 actual
catalog/probes, I11 finite escalation/fresh confirmation, audit/CLOSE.
