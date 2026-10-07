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
| creation opener/commit | Add begins/resets shared editor; Save commits, label priority loses data | actual3pinnedBASEPASS/current3RED beforecode→same3GREEN; sharedcommit1/distinctintent1RED→exact102GREEN/realoldworkflow3FAIL → I3/I6 |
| equivalent commit affordances | raw action count rejects one editor; lossy collapse picks other record | actualpinnedBASE3PASS/current3RED→same3GREEN; caption/editor/enabled guards1/2/1/1RED→exact106GREEN, realoldworkflow3FAIL → I3/I6 |
| explicit action aliases | Save/Update, Add/Create or reservation/booking mistaken for record identity | actual pinned BASE3PASS/current3RED→same3GREEN; native aliases6RED, opaque suffix guard; exact115GREEN, realoldworkflow3FAIL → I3/I6 |
| computed action caption | YAML heading quotes mistaken for missing caption | actual pinned BASE3PASS/current3RED→same3GREEN; native3RED beforecode, reader3/caption4 guards→exact119GREEN → I3/I6 |
| action token placement | adjacent verb/subject assumption rejects existing BASE vocabulary | pinnedBASE3PASS/current3RED→same3GREEN; corrected native7RED, verb15/subject4 guards→exact128GREEN → I3/I6 |
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

Round3 Finalf46 BLOCK B4: actual pinned Vue room/reservation and Svelte expense
Add-opener/Save-commit programmes BASE-v4PASS/currentv5FAIL. Permanent same3RED
beforecode/current3GREEN, exact102nativeGREEN, sameFieldcommit1/distinctintent1
RED→exact102GREEN and real root-workflow revert3FAIL/sourceunchanged; types0 and
current4realdual/singlePASS. Intended editable purpose binds creation commits:
sameeditor Save, independent creator Add. No side-effect reset/rescue or DOM/id/
field-order protocol. Currentown52 completed32PASS20FAIL; all52physical/noModels/
exactpatch/raw5CSSCORS, twooffline authoritativeunchanged/derivedidentical,
archive185JSONparsedsourceexact/carriersunchanged. Currentfullgate27/27PASS (unit240.6s/parity114.0s, firstPASS/no retries);
fresh independent Finalround4 pending. Raw:
`reference/agent-eval-participant-completeness-final-green-blocked.json`,
`reference/agent-eval-creation-opener-proof.json.gz`,
`reference/agent-eval-creation-opener-controls-proof.json.gz`.

Current B4 gate: `reference/agent-eval-creation-opener-prcheck-green.log.gz`.

Round4 Finalc9 BLOCK B5 accepted: two SAME Save handlers for one editor,
pinned room/reservation/expense BASE3PASS/current3FAIL. Permanent same3RED
beforecode→same3GREEN; native106PASS/types0/current3opener+4singledualPASS;
equivalence/caption/editor/enabled guards1/2/1/1RED→exact106GREEN, real old
workflow/currentcallers3FAIL/sourceunchanged. Same computed accessible caption
and editable purpose group equivalent affordances; preserve escaped identities
and editor distinctions, prefer enabled counterpart. No guessed NLP or DOM shape.
Current64 completed43PASS21FAIL/allphysical/noModels/raw6CSS, twooffline
authoritativeunchanged/derivedidentical, archive227JSONparsedexact/carriers
unchanged. Currentfullgate27/27PASS (unit243.1s/parity116.5s, firstPASS/no retries);
fresh independent Finalround5 pending. Raw:
`reference/agent-eval-creation-opener-final-green-blocked.json`,
`reference/agent-eval-duplicate-commit-proof.json.gz`.

Current B5 controls: `reference/agent-eval-duplicate-commit-controls-proof.json.gz`;
gate: `reference/agent-eval-duplicate-commit-prcheck-green.log.gz`.


Round5 Final2ffb BLOCK B6 accepted: explicit Save/Update affordances use SAME
pinned room/reservation/expense commit owners, BASE3PASS/current3FAIL. Permanent
same3RED beforecode→same3GREEN; six native alias variants RED beforecode;
opaque identity negative alreadyPASS. Only declared leading verb/subject aliases
are equivalent, in either order; remaining record caption exact. Same native
editor purpose and enabled representative guards remain. Final native115PASS;
alias7/caption3/editor2/equivalence1/enabled1RED→exact115GREEN; real oldworkflow
only/currentcallers3FAIL, sourceunchanged; types0. Current76/fresh gate/Final
pending, full96/I10/I11/CLOSE remain. Raw:
`reference/agent-eval-duplicate-commit-final-green-blocked.json`,
`reference/agent-eval-commit-alias-proof.json.gz`.


B6 class sweep captured another genuine BASE regression before Final: actual
Save/Update captions with colon force Playwright YAML heading quoting. SAME
pinned handlers/Apps BASE3PASS/current3FAIL; all6 physical pairs/source Apps
identical/noModels. Permanent real3RED and native colon/apostrophe/C1 threeRED
before reader repair. Unwrap only serializer root-key quoting, then decode its
JSON caption; preserve opaque suffix and editor identity. Current real3GREEN,
native119GREEN; YAMLreader3/alias7/caption4/editor2/equivalence1/enabled1RED→
exact119GREEN, real pre-YAMLworkflow only/current3FAIL/sourceunchanged/types0.
Original76 completed54PASS22FAIL, allphysical/noModels/exactpatch/raw7CSS,
twooffline authoritativeunchanged/derivedidentical; archive269JSONparsedexact.
Retained as pre-YAML history; latest88/fullgate/Final pending. Raw:
`reference/agent-eval-commit-alias-controls-proof.json.gz`,
`reference/agent-eval-action-caption-proof.json.gz`.


Latest source controls: ORIGINAL completed88 own64PASS24FAIL, consumerexit1:
COI YAML-room workspace archive import toast90s fails BEFORE patch/judge;
no before/after/model/probes, same declared starter as prior working reference,
causeunknown. Other87 physical pairs exact/noModels;8rawCSS rows inclpartial.
Keep failure/header unchanged, twooffline unchanged/identical, archive310JSON
sourceparsedexact/carriersunchanged. SEPARATE fresh three-YAML×four cohort12
completed11PASS1expenseCOICSSFAIL/consumer0, all12physical/noModels/rawCSS1,
twooffline unchanged/identical/archive45JSONexact. YAML room/reservation all4
PASS here; new pass never rescues old setupFAIL. All tasks/trials/config/current
criteria fingerprints exact in both; launch dirty metadata preserved, no source
header replacement. Fullgate/fresh Final next; 96/I10/I11/CLOSE remain. Raw:
`reference/agent-eval-action-caption-controls-proof.json.gz`.


Latest full source gate27/27PASS, actualexit0: unit238.3s FIRSTPASS/no isolated
rerun, parity119.2s. Launched after all producer/browser/guard/archive work ended.
Raw: `reference/agent-eval-action-caption-prcheck-green.log.gz`.
Fresh independent Final round6 required before model96; source unit not closed.


Round6 Final7beee BLOCK B7 accepted: SAME pinned Save changes to room / Update
changes to room (reservation/expense twins), BASE3PASS/current3FAIL; sixphysical
sourcepairs exact/noModels/pairedApps identical. Permanentreal3RED and native7RED
before root repair. First authored native8RED included one invalid raw-whitespace
witness: actual ARIA normalizes both names identically; primary snapshots proved
this before code, originaltest/log retained, corrected observable-identity test
PASS. Never claimed that eighth failure as product RED. Shared owner removes
one declared verb/subject token independent of adjacency/order; preserves other
caption text, computed-name normalization, native editor identity and enabled
choices. Real same3GREEN/types0/current128nativePASS; YAML3/verb15/subject4/
equivalence1/caption4/editor2/enabled1RED→exact128/sourceunchanged; onlyold7beee
workflow/currentcallers/current3programmes3FAIL. Newcurrent100 controls/gate/
fresh Final pending; old76/88+12 and originalfailures stay history. Raw:
`reference/agent-eval-action-caption-final-green-blocked.json`,
`reference/agent-eval-separated-alias-proof.json.gz`.


Latest new100 completed76PASS24FAIL/consumer0, all100physical/noModels/exactpatch,
book13positiveprogrammesall4PASS; expense8sourcepositiveother3PASS/ownCOICSSFAIL;
negative16FAIL,9rawCSSrowsincludingpartial. Currenttasks/trials/config/resolved
criteria exact, original7beeedirty metadata retained. Twoofflineauthoritative
unchanged/derivedidentical; archive353JSONparsedexact/carriersunchanged. Previous
88setupFAIL remainsunknown originalFAIL; newseriesdoesnotrescueit. Currentfull
gate/newFinalR7 next; full96/I10/I11/CLOSE mandatory. Raw:
`reference/agent-eval-separated-alias-controls-proof.json.gz`.


Current fullsourcegate27/27PASS actualexit0: unit236.6s FIRSTPASS/no isolation,
parity118.7s. All producer/browser/guard/archive work ended before gate. Raw:
`reference/agent-eval-separated-alias-prcheck-green.log.gz`.
Fresh independent Final round7 required; source/goal not yetclosed.
