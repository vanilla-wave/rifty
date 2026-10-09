# ADR 0524: Project reservation fields without aggregate identity

Status: Accepted
Date: 2026-10

Adds readonly projection ownership to ADR0522/0523; their lifecycle/effect choices stay.

## Context

Actual grouped date + three adjacent intervals: aggregate text assembles the
vanished middle key from two neighbors. Genuine Update appears Create; cleanup
Deletes the original. Source RED: expected3/observed2, saved bytes changed.

Independent DEC probes on Node24.16.0/Vue3.5.18/Vite7.3.6/Chromium148.0.7778.96:
`node .cache/pr341/grouped-projection-decision/probe.mjs`. Four native programmes,
exact rollback4/4, errors0. Raw date-count/aggregate witness killed: Update and
Cancel both old/new counts1/1, aggregate presence true/true. Context fallback
also killed: a calendar heading becomes a nonexistent literal room name.

## Decision

One readonly start/end/seats core owns non-overlapping text spans. Smaller
independent peer intervals reject an aggregate core; full loaded tuples supply
conservative peer hints, never savedness. Room/date may belong to the core's
readonly grouping. Determine nearest contextual evidence before allocation;
overlap fails, never licenses another farther match. Other record branches,
editable ancestors and body cannot supply contextual authority.

Calendar aliases apply only to the calendar slot. Literal names never become
calendar values; projected field exclusions replace raw ancestor text exclusion.
Projection ambiguity is explicit. No prescribed tag/path or decoded storage.
Shown chronology follows independently projected core positions, with equal
date/start order open. Caption correspondence narrows the observed actor only.

After Save/reload: old absent/new present means Update; restore observed actor.
Old/new present means owned Create; decline and remove only confirmed fresh
creation. Old present/new absent means no observed change. Both absent means
unsettled evidence failure, no speculative Delete or success fallback. Before
normal return, original projection exists, fresh key absent, peers preserved.

## Consequences

Four probes cover grouped Update/Cancel, nested room/date, repeated scalar and
calendar-shaped literal names. Native saved bytes are fixture oracles only.
Production source RED→GREEN, faults, own origins, gate and independent Final
remain mandatory; this ADR does not close the unit, fresh96, I10/I11 or goal.
