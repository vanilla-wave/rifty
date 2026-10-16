# ADR 0515: Observe visible CSV exports before state-changing actions

Status: Accepted
Date: 2026-10

## Context

Extends ADR0513's public-export seam; earlier decisions remain active.
Actual eval-v4/COI1 has correct current-filter CSV already visible. Export
is a toggle; judge closes output, then reports failed filtering. Exact
programme native public7 PASS/private6-of7 RED; original55/96 retained.

## Decision

CSVv5 observes visible output after setting Filter, then invokes declared
Export and observes output/download again. Validate the same exact decoded
records/multiplicity. Output may already be visible; no idempotent-open demand.

Always-open action restriction rejected by captured RED; storage/UI-specific
inspection rejected by I6. One exportFor owns all four observations; mirrored
oracle byte-certified. No new UI parser or runtime compatibility change.

## Consequences

Old CSVv1–4/eval-v4/source/results immutable. CSVv5/eval-v5 changes one judge
with identical eight public inputs/controls and other seven judge entries.
Real positive/negative and four-origin controls, independent Final, then fresh96;
no retrospective rescore/native rescue/resume. I10/I11 remain required.
