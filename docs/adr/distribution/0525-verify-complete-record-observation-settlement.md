# ADR 0525: Verify complete record observation settlement

Status: Accepted
Date: 2026-10

Adds settlement to ADR0522/0524; savedness/identity choices stay.

## Context

Independent Final3005 executes actual Svelte/Vue partial-write programmes:
Paid restored while description remains; room names restored while capacity3
remains instead2; restored booking key conceals loss of an original peer.
Native references restore exact; no browser errors. Same torn-state and
lossy-aggregate boundary, not three unrelated repairs.

Production sibling sweep also exposes capacity changes without a name change,
peer loss during auxiliary creation, payer/participant changes with unchanged
Paid total, and a zero-share participant change with unchanged financial rows.
Pinned Node24.16.0/Chromium148.0.7778.96, Vue3.5.18/Svelte5.38.7/Vite7.3.6;
`node --import tsx tools/agent-bench/tests/record-settlement-origin-controls.ts`.
Raw RED/GREEN: `agent-eval-record-settlement-proof.json.gz` in backlog reference.

## Decision

Reject the minimum-interface route: scalar Paid, option names, or only the
mutated booking tuple cannot settle original public data. The seven independent
probes and production sibling REDs kill it.

Keep the existing local owner. Expense captures/restores description, amount,
payer and participant set; settle complete captured payload, absent marker and
unchanged independent public financial effects. Room checks original capacity
as well as membership after confirmed Update; no-effect paths also detect
partial payload drift. An owned Create does not make its unconfirmed draft an
original saved record. Loaded fields never replace independent savedness proof.

Booking movement and auxiliary creation capture only independently projected
original peer tuples before mutation; the same checker verifies them at cleanup.
Candidate fields alone cannot add a saved peer. Original/new-key settlement
remains required. No extra coordinator, persistent registry or storage schema.

## Consequences

Partial/unsettled effects fail with retained cleanup cause; no normal return
conceals them. Failed-app state need not be recoverable; failure is explicit.
Current production controls: four exact references/nine explicit faults,
four alias/Cancel/dual-form controls and six grouped projections. Full workflow,
own-origin, gate and independent verify remain required before acceptance.
History unchanged; fresh96/I10/I11/historical-reader/CLOSE stay open.
