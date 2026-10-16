# ADR 0513: Observe persisted CSV records through public export

Status: Accepted
Date: 2026-10

## Context

I3/I6/public CSV task leaves layout open. Actualeval-v2COI3 savedtable persists
4contacts and exports corrections, but reloadchecks demand editableEmail rows.
IndependentBLOCK/raw/nativeRED retained; source seam extends ADR0509/0512.

## Decision

Read declared public Export after clearingFilter at both reloads. Compare all
4correctedname/email records, exact multiplicity, without display-order demand.
Existing codec ordered callers unchanged; saved-state callers use unordered.
Persistenteditor requirement rejected by capturedRED; appstorage inspection
rejected by schema/layout openness. Export reuses required public behavior.

FrozenCSVv1/v2/v3/eval-v2/source/outcomes unchanged; CSVv4/eval-v3 changes one
judge/caseID, preserving publicsource/prompt/locks/controls and other7cases.
Real savedtable/sortedtable, lostpersistence/prematurecommit/row/duplicate faults,
allorigincontrols and independentFinal precede fresh96; no rescore/resume.

## Consequences

Historical54/96 stays incomplete/knowncriteria-defect evidence. I10/I11 remains
mandatory. RunnerSIGINT ownership repair uses existing series lifecycle; no new
coordinator, browser/model rescue or runtime compatibility change.
