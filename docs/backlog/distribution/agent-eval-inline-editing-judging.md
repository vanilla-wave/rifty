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
| participant toggle native form | external button native owner omitted | actual native external button RED; owner revert2RED/exact88GREEN → I3/I6 |
| participant state/identity | pressed filter discards intended editor | actual expense consumer opposite-state3RED overall; state revert2RED/exact88GREEN; checkbox/select/button external siblings → I3/I6 |
| participant representation | global select/checkbox branch hides intended toggle/checkbox | six real native mixed-type consumers3RED/3PASS before repair; exact same tests current94GREEN → I3/I6 |
| complete participant group | nearest nonempty ancestor drops sibling; native ownership pins id | actual BASE-v4 whole helperPASS/current2permanentRED, idless form/non-form; guards6/1/1/1RED→exact100GREEN → I3/I6 |
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
Fresh independent Final29bc BLOCK: native external button ownership and
state-before-context; executed genuine bugs accepted without scope reduction.
Native permanent3RED/9PASS before repair; current88GREEN including external
checkbox/select/button consumers; both guards RED/exact restoration GREEN.
Class sweep additionally observed mixed representation3RED/3PASS. One existing
action-context owner now scopes the complete participant set, then representation
and pressed state. Original mixed tests unchanged/current94PASS. Current group-source40 completed21PASS19FAIL; physical/ZIP/noModels
verified, two offline273authoritative unchanged/derivedidentical, archive143JSON
parsedsourceexact/carriers unchanged. Current full gate27/27PASS (unit287.4s, both initially-red files passed
built-in isolated rerun; parity121.7s). Fresh independent Final round2 pending; prior intermediate40 completed
21PASS19FAIL (original controls archive and scores retained). Prior proof:
`reference/agent-eval-action-context-proof.json.gz`.
Eval-v7 ownSIGINT:82/96/47PASS35FAIL14missing, actualexit0/headerinterrupted.
Interruption history full pr:check27/27 PASS (unit205.4s/parity114.9s); retained before current source repair.
Two offline regenerations592 authoritative unchanged/identical views; archive334
JSON/18large original bytes exact/canonical CLI links/carriers unchanged.

## Decisions

ADR0518; one context projection, native form association thenclosestcontext
whenneeded, no field-order/visibility/UIprotocol. Sourcepublic/control payloads
exact, shared context changesall8fingerprints; oldcriteria/results remainhistory.

## Residuals

Unit: Final29bc BLOCK recorded in `reference/agent-eval-action-context-final-green-blocked.json`; both defects and executed representation sibling repaired at one owner; native94PASS. Current group-source40 completed21PASS19FAIL/physical+twooffline+archive exact; threeguards2/2/3RED→exact94GREEN; current full gate27/27PASS (unit287.4s, two files passed isolation; parity121.7s); round2 BLOCK87a25 accepted B3; current repair100native/4real/types/guardsGREEN, current40 completed21PASS19FAIL/physical+twooffline273unchanged+archive143JSONexact; current full gate27/27PASS (unit253.8s without isolated rerun; parity118.6s); fresh round3 pending; original/intermediate40 and gates remain immutable history.
Goal: accepted full96, I10 actual catalog/probes, I11 finite escalation/fresh48,
end-to-end audit/CLOSE with historical-contract retirement proof.
Current raw group proof: `reference/agent-eval-participant-group-proof.json.gz`;
current40 proof: `reference/agent-eval-participant-group-controls-proof.json.gz`.

Round2 Final87a25 BLOCK B3: actual BASE-v4 complete participant selection PASS,
current owner drops Cara in idless form and section. Driver accepted; permanent2
RED before repair, native current100PASS, guards6/1/1/1RED→exact100GREEN,
actual types0/pinnedVueSvelte4PASS. Native form element identity replaces id
predicate; complete logical purposes share the scalar/group owner. Current own40 completed21PASS19FAIL/physicalZIP+twooffline273unchanged/
archive143JSONexact; current full gate27/27PASS (unit253.8s without rerun; parity118.6s); fresh Final round3 pending. Raw:
`reference/agent-eval-participant-group-final-green-blocked.json`,
`reference/agent-eval-participant-completeness-proof.json.gz`.

Previous accepted-for-gate source87 gate raw: `reference/agent-eval-participant-group-prcheck-green.log.gz`.

Current B3 own-controls raw: `reference/agent-eval-participant-completeness-controls-proof.json.gz`.

Current B3 full gate: `reference/agent-eval-participant-completeness-prcheck-green.log.gz`.
