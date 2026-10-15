# ADR 0516: Accept native calendar controls in booking judges

Status: Accepted
Date: 2026-10

## Context

Extends ADR0512's open-control judging seam; earlier decisions remain active.
Actual eval-v5 booking COI1 hits Playwright Malformed value on native date.
Independent pinned reference26/26 private PASS; only Date/Start/End input types
changed: public36/36 PASS, private RED. Native Chromium rejects2030-02-30,
25:00/26:00 and clears DOM value. Original87/96 retained, missing9 explicit.
Captured app additionally misses named Validation for native Seats0/1.5;
first corrected judge incorrectly accepts it26/26 despite public34/36.
Independent native evidence + actual captured negative control require the
existing named Validation clause after every rejected operation.

## Sibling class sweep

Expensev2 fills abc into Number: independent original22/22 PASS, raw-value
Number alternative33 public +1 boundary PASS/private RED. Scientific1e2
remains representable and application rejection remains required. Playwright
leaves prior12.34 after failed abc fill; ignoring failure would submit stale data.
Native Date, Time and Number are three reachable instances of the same input
representability assumption; one source owner is required by Class-kill.

## Decision

Shared native-input owner for bookingv3/expensev3 probes value representability through an actual same-type native
input in the judged browser. Representable values use ordinary fill; native
unrepresentable calendar/number values clear the real field, then the existing
application action/unchanged-state checks exercise rejection. Text controls
still receive exact malformed literals. No caught arbitrary locator errors,
synthetic app validation, bypassed handlers or failed-value reuse.

Requiring text inputs rejected by public openDOM/reference RED. Ignoring the
failed fill rejected: an earlier valid value could be submitted. Replacing
app validation with source inspection rejected by I3/I6. Shared rejected
observation checks visible named Validation immediately after each rejected
operation, before state snapshots edit/save and clear messages. One fillNativeInput
owns date/start/end/amount. Two mirrored oracles byte-certified. Native-input-v1
private support profile includes owner source in each resolved judge fingerprint;
unknown profiles reject. Other six judge/support fingerprints unchanged.
No runtime/API change.

## Consequences

Bookingv1/v2/eval-v5/source/results immutable. Bookingv3/expensev3/eval-v6 changes two
judges; eight public inputs/controls and other six judge entries unchanged.
Real positive/negative, guard reversions and four-origin controls precede
independent Final and fresh96. No retrospective rescore, native rescue or
resume. I10/I11 remain required. Malformed literals and browser-representable
empty-field rejection are distinct receipts, never claimed identical inputs.

## Field identity and bootstrap evidence

A label-only Reservation room → Reservation room name alternative is public36/36
PASS but both v2/v3 private RED: Name matches two controls, Room matches none.
Bookingv3 gives the primary reservation/booking qualifier precedence over Name;
ordinary Name of room remains supported. Both guards carry real revert checks.
No public label requirement changed, no captured v5 programme cause inferred.

First shared72 controls retain29PASS43FAIL: three source-positive expense COI
programmes fail before Amount at exact style-import CORS/blank preview. Actual
same App bytes pass other three hosts; independent72physical/noModels audit.
Original expectations/report unchanged. I6 retains failed reference environments.
Re-cut controls distinguish source expectation from own-host outcome; whitelist
only the three observed positives with current raw CORS evidence. Actual native
Number is also checked through a Vue reference consumer in all four hosts.
No Svelte success/native rescue or compiled-specifier/root-layer claim. Native
unzip only decodes existing Playwright evidence; missing/malformed evidence fails.
