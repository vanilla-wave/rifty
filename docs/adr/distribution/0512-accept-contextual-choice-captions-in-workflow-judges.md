# ADR 0512: Accept contextual choice captions in workflow judges

Status: Accepted
Date: 2026-10

Judge semantic choice identity; retain old criteria/results and publish corrected eval-v2.

## Context

ADR-0511/public prompts leave layout open. Actual bookingCOI1 option
`Amber · 4 seats` failed exact-label selection. Real native reference controls:
4plainPASS/4decoratedFAIL, errors0; expense payer/participants share the fault.

## Decision

One shared choice projection selects real option indices by unambiguous named
identity; missing/ambiguous choices fail loudly. Booking selected identity uses
actual room names from editable room records, not arbitrary caption suffixes.
Original eval-v1/cases/results stay unchanged. Corrected two cases/eval-v2 keep
identical public prompt, project/lock and controls. Repeat all-origin controls,
fresh full96 and independent Final before comparative acceptance. No rescoring.

## Consequences

- Public semantic requirements govern acceptance; display context allowed.
- New measurement identity; interrupted74/96 is history, not valid comparison.
- I10/I11 remains mandatory; no runtime compatibility repair in this decision.
