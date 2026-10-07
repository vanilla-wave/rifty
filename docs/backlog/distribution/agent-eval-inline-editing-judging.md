---
area: distribution
status: ready
title: Bind workflow editing controls to their intended action
created: 2026-10-07
why: Global purpose lookup selects creation and inline-edit controls together despite valid open layout.
epic: agent-code-quality-evaluation
sources: [ADR-0512, ADR-0516, ADR-0517]
code: [tools/agent-bench/src/judge/context.ts, tools/agent-bench/corpus/cases/booking-workflow-v4/judge.ts]
---

## Context

Eval-v7 booking noCOI1 reaches inline room edit; creation stays visible. Named
Room name and Room name for Amber are both matched, scalar evaluate strict-fails.
Actual native interactive two-form micro: global2/RED, qualified edit and invalid
preservation+Validation GREEN. Real pinned Vue reference40GREEN; add independently
working creation during edit through SAME domain validation/commit owner:
public room workflows GREEN/private strict RED. No stub or captured-app rescue.
Proof: `reference/agent-eval-inline-editing-baseline.json.gz`.

## Challenge

challenge: 2026-10-07 — clear; existing I3/I6/open DOM/identified row actions and
executed baseline reused (RDY-8). Observed repair; no new user promise or fork.

## Reference contract

Existing named creation and editing workflows remain distinguishable when both
editors are visible. Targeted edit/read affects its intended record only; another
creation draft is untouched. Public accessible purposes/actions/layout freedom
remain. No single-editor visibility, field-order or unqualified-name requirement.

## Scope

Action-context scalar control observation at one owner; booking create/edit/read
call-site class sweep, reservations and relevant sibling workflow operations.
Version corrected affected case/helpers; original inputs/controls/scores preserved.
No runtime capability or new state/execution owner. Every changed fingerprint
recorded before fresh comparison; no retrospective rejudge.

## Out of scope

New app requirements, model/settings, runtime repairs, stronger UI structure,
rescore/resume or goal closure through this unit. I10/I11 remain required.

## Fault matrix

Boundary: Owned in-process policy/graph projection; scalar birth is broad global
purpose collection without intended editing action context. Frozen-assumption
and lossy-aggregate survive. Transport loss/duplicate/reorder physically excluded
only here, not at browser/runner/storage boundaries.

| Operation | Fault | Carrier |
| --- | --- | --- |
| room Name/Capacity edit/read | creation+edit purposes collide | native interactive2 and actual Vue original40/dualRED; scoped regression pending → I3/I6 |
| creation while editing visible | first/edit field silently selected | independent native public create preserves edit draft; permanent guard pending → I3/I6 |
| reservation picker/date/time/seats | same row/form context assumption | call-site class sweep and actual alternative/fault controls pending → I3/I6 |
| repeated action/edit/read | stale or wrong row context | exact target/state preservation tests pending → I3/I6 |
| version/report | changed criteria rescored as old | retained interrupted82/full96 declarations/offline/archive exact → I8/I9 |

## Acceptance

- Actual baseline/RED before code; one honest action-context owner, class sweep. → I3/I6
- Existing reference and real concurrent-editor alternatives pass, wrong-target
  fault controls fail, guards revert RED/exact restore GREEN. → I3/I6
- All4 own-origin source controls retain failures and source/host proof separately. → I3/I6
- Public inputs/control payloads and original outcomes unchanged; criteria versions
  and all resolved hashes explicit. → I8/I9
- Full source gate and fresh independent Final before new full96. → I3/I6

## Checks

Native micro actualglobal2/privateRED/qualifiededit+invalidpreservationGREEN.
Real pinned Vue original40PASS; independent creation/editor public workflow PASS,
old fullprivateRED. Source fix/permanent regressions/controls/gate/Final pending.
Eval-v7 ownSIGINT:82/96/47PASS35FAIL14missing, actualexit0/headerinterrupted.
History full pr:check27/27 PASS (unit205.4s/parity114.9s); source fix not implemented.
Two offline regenerations592 authoritative unchanged/identical views; archive334
JSON/18large original bytes exact/canonical CLI links/carriers unchanged.

## Decisions

Observed baseline restores existing open-layout authority; no mechanism/policy
chosen before the action-context and sibling sweep. Prior criteria remain history.

## Residuals

Unit: implementation/permanent RED/GREEN/controls/gate/fresh Final.
Goal: accepted full96, I10 actual catalog/probes, I11 finite escalation/fresh48,
end-to-end audit/CLOSE with historical-contract retirement proof.
