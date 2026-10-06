# ADR0514: Observe composed saved-note captions

Status: Accepted
Date: 2026-10-06

## Context

ADR0510 shared field-purpose matching with note identity. Actual eval-v3
notes/COI1 shows saved Beta followed by an excerpt; accessible name flattens to
BetaUnique body needle. Word-boundary matching wrongly rejects body search
and cannot select Beta after reload. Independent raw verification confirms I3/I6.
Same captured programme SHAa5b1ec5bcd76e4be835a395be537a6183f8c597c3feb75cac15c3fe22465b940:
realNode24.16/Vite7.3.6/Chromium public7PASS, privateoldFAIL, errors0.

## Decision

Partially supersede ADR0510's single matcher for fields/entry/Wiki. Field
purposes retain their matcher; current note entry/Wiki identity share one
observation owner. Exact accessible title takes precedence; otherwise inspect
visible caption components, keeping other-note excerpts and delete actions
out of the identity. Anonymous/hidden title payload is not a named entry.
Legacy flat captions retain existing discrimination where no component matches.
No universal UI parser, application repair, coordinator or source-code scoring.

Other ADR0510 clauses remain: accessible Wiki button/link actions, visible
Markdown proof, hidden/editor text rejection, unchanged state/search/delete/
persistence checks and immutable prior measurements. Preserve old helper
behaviour; only notes-v4/eval-v4 use the corrected owner. All8public inputs,
prompts/locks/controls and other7judge entrybytes unchanged; support/source
hashes record the appended owner. No rescore/resume/native rescue or quality
seed from a prior model output. Source/fault/all-origin/Final precede fresh96.

## Candidates/proof

- Unchanged flat-caption matcher, minimal interface: rejected by actual7public
  PASS/privateFAIL. A separator cannot be required by the layout-open task.
- Current note identity owner, separate from field-purpose grammar: retained;
  exactsameprogramme public7/private7PASS. Independent DEC2 review requires
  the partial supersession; its delete/hidden/ARIA risks reproduced3RED,
  then4browser faultsGREEN. Existing14controls5positivePASS9negativeFAIL;
  guarded-source14/14 expected;3reversionsRED/restored4GREEN; actual60own-origin
  controls23PASS37FAIL, including knownprogramme3COI viewport failure.
  Captured/reference/alternative all4PASS. Fullgate/Final remain required.

Proofs: agent-eval-notes-composed-entry-{native-red,native-green}.json.gz,
notes-entry-controls.ts and notes-entry-controls.fault.spec.ts. Original65
scores remain interrupted history. Full comparison and mandatory I10/I11
remain goal obligations.
