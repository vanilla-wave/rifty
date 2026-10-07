---
area: distribution
status: ready
title: Bind workflow editing controls to their intended action
created: 2026-10-07
why: Global purpose lookup selects creation and inline-edit controls together despite valid open layout.
epic: agent-code-quality-evaluation
sources: [ADR-0512, ADR-0516, ADR-0517, ADR-0518]
code: [tools/agent-bench/src/judge/context.ts, tools/agent-bench/corpus/cases/booking-workflow-v5/judge.ts, tools/agent-bench/corpus/cases/expense-settlement-v5/judge.ts, tools/agent-bench/tests/action-context.spec.ts, tools/agent-bench/tests/inline-editing-controls.ts, tools/agent-bench/tests/action-context-origin-controls.ts]
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
| room Name/Capacity edit/read | creation+edit purposes collide | native interactive2 and actual Vue original40/dualRED; permanent real Vue RED→GREEN; native scope/form guards5/1RED→exactGREEN → I3/I6 |
| creation while editing visible | first/edit field silently selected | independent native public create preserves edit draft; creation intent native guard2RED→exactGREEN → I3/I6 |
| reservation picker/date/time/seats | same row/form context assumption | book/expense class sweep; native3control-context types/current40physical → I3/I6 |
| repeated action/edit/read | stale or wrong row context | native80 incltarget state/ambiguousaction1RED→exactGREEN → I3/I6 |
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
old fullprivateRED. Current action/native-form owner fixesbook5+expense5. PermanentrealVue/Svelte
single/dual4PASS; bothdualsRED beforetheirfix. Native80PASS, fourguards
5/1/2/1RED→exact80GREEN; typesPASS. Current40sourcecontrols completed21PASS19FAIL;
all3positivebookprogrammesall4PASS, all3positiveexpenseprogrammesother3PASS,
COIFAIL actualexactCSSCORS. Fourbootstraprowsinclpartial; baselinehasnone.
All40physicalbefore+patch/after/noModels, twooffline273unchanged/identical.
Current full source pr:check27/27 PASS (unit1301.2s/parity129.4s);
fresh independent Final pending; proof:
`reference/agent-eval-action-context-proof.json.gz`.
Eval-v7 ownSIGINT:82/96/47PASS35FAIL14missing, actualexit0/headerinterrupted.
History full pr:check27/27 PASS (unit205.4s/parity114.9s); source fix not implemented.
Two offline regenerations592 authoritative unchanged/identical views; archive334
JSON/18large original bytes exact/canonical CLI links/carriers unchanged.

## Decisions

ADR0518; one context projection, native form association thenclosestcontext
whenneeded, no field-order/visibility/UIprotocol. Sourcepublic/control payloads
exact, shared context changesall8fingerprints; oldcriteria/results remainhistory.

## Residuals

Unit: fresh independent Final pending; current source gate27/27 PASS; implementation/class proof/current40 complete.
Goal: accepted full96, I10 actual catalog/probes, I11 finite escalation/fresh48,
end-to-end audit/CLOSE with historical-contract retirement proof.
