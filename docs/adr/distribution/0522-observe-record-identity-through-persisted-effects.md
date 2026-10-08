# ADR 0522: Observe record identity through persisted effects

Status: Accepted
Date: 2026-10

Partially supersedes ADR0519/0520/0521; retains literal data and control ownership.

## Context

I3/I6 F6: working qualified Edit captions fail current criteria. Independent
DEC audit executes pure query, field load, no-op Save and explicit effect routes.
Captions/read-only notes admit cancellation; loaded fields conceal lost edit id;
sticky allowed Validation makes no-op Save ambiguous. Positive action receipts
overcount aliases; payload-tuple dedup would lose valid duplicate expenses.
Pinned Vue3.5.18/Svelte5.38.7/Vite7.3.6, Node24.16.0/Chromium148.0.7778.96;
exact inputs/commands/results in record-observation decision/preparation receipts.

## Decision

Separate pure candidate discovery from explicit caller-owned observation and
intended mutation. No hidden clicks inside Locator/count/query. Confirm saved
update through an independently required public effect, not caption remainder,
loaded-field equality or absence of Validation. Existing scalar/participant/
commit owners select controls; public input/layout/storage remain unchanged.

Savedness and identity are separate. Use domain-unique keys only where public
constraints guarantee uniqueness. Duplicate-capable expense identity uses a
temporary saved marker, confirmed by actual effect, held through observation
and restored before normal return. Requery after changes; neither action count,
stale position nor payload equality is record identity. One local observation
lifetime owns marker allocation/apply/restore/error reporting; no durable state
owner or execution coordinator.

Pure minimum-interface route and load-only/no-op variants are killed by real
negative programmes. Flat receipt enumeration is killed by4/2 alias evidence.
Held markers discriminate2/3 identical expenses from4/6 affordances, including
opaque and repeated payload captions with sorting/full rerender; dynamic Cancel
loads marker but its saved effect is Create. This proves bounded feasibility,
not a universal adapter. Marker collision/error/rollback ambiguities fail
visibly; no successful observation may hide an unsettled owned mutation.

## Consequences

This is the chosen repair direction, not source acceptance. The new stateful
lifetime gets independent Contract+RED before production implementation.
Native rollback's fixture DOM/storage oracle cannot become a hidden app schema.
Reservation saved-effect/ownership and intended unpaired/opaque Delete need
actual carriers; prototypes do not claim those solved. Current source stays
blocked by F6 until implementation/fault/all-origin/Final proof. New criteria
retain public inputs/history; fresh96/I10/I11/historical-reader/CLOSE remain.
