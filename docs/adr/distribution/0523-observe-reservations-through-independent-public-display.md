# ADR 0523: Observe reservations through independent public display

Status: Accepted
Date: 2026-10

Adds the reservation/room-display seam to ADR0522; nothing superseded.

## Context

Independent native DEC probes: load/no-op Save gives identical fields/display
for Update and Cancel clearing edit id. Changed seats distinguish them where
capacity permits; moving calendar date also covers capacity1/one-minute intervals.
Public non-overlap makes room/date/start unique. Two Edit aliases are one record.

Requiring room option inventory excludes a valid Reservation room textbox:
actual current adapter throws `Missing/ambiguous choice: Bay`. An owned temporary
reservation follows the room rename through its required public display instead.

Command: `node .cache/pr341/reservation-effect-decision/probe.mjs`; Node24.16.0,
Vue3.5.18/Vite7.3.6/Chromium148.0.7778.96. Four discriminating native probes,
exact saved rollback/errors0. Receipts must be retained before source acceptance.

## Decision

Use explicit temporary date movement for reservation observation. After Save
and reload, independent displayed new key must exist and old key must disappear.
Cancel creates a second key or changes neither: decline it, clean only owned
creation. Restore data through the observed actor and verify original/new output.
Unique domain keys separate aliases; do not derive multiplicity from captions.

Read required output separately from editable fields/action captions. Candidate
queries remain pure. No required row tag, fixed DOM path or decoded storage.
Ambiguous/missing public evidence fails visibly; no field-only success fallback.
Check shown chronology independently from Edit/Delete ordering; equal date/start
order stays open. Calendar display has an explicit typed slot; its display formats
never reinterpret literal names. Actual DD/MM/YYYY source RED and an unsorted
negative control guard both requirements. Native DOM/storage readers are fixture oracles only.

Use option membership when actually exposed. Otherwise one owned reservation
provides the room relation witness. The shared local observation owns its creation,
room rename and cleanup; reverse settlement restores the name before relation
removal. Actual textbox proof restores original rooms/reservations byte-exact.

Requery a causally observed actor by literal caption correspondence and loaded
marker data; verify restoration effect independently. Caption correspondence
narrows a locator, never grants savedness. Keep all original identities when
narrowing marker cleanup, preventing unrelated Delete controls from entering
through an aggregate ancestor.

## Consequences

Stateful Contract+RED already accepted under ADR0522. Production adapters,
open-presentation/ownership/fault controls, four origins and independent Final
remain required. This decision does not accept the source or comparative results;
fresh96, I10/I11, historical-reader audit and CLOSE remain mandatory.
