# ADR 0022: Parity and E2E coverage gates per milestone

Status: Partially implemented (2026-05-24) — +3 parity cases (stream backpressure, pipeline-multi, http parse-url; total 19). Cycle/TLA cases blocked on parity-runner fix (setup.files alongside entry). E2E gates deferred to M11.
Date: 2026-05

## Context

The parity runner has ~15 cases concentrated in a handful of modules; entire areas (streams backpressure, fs edge cases, http error paths, module cycles, child_process) have no parity coverage. End-to-end Playwright coverage exists for M0–M4 but not for M5 through M10, even though those milestones added user-visible behavior (streams, preview port, npm install, edit→preview reload).

REVIEW_ACTIONS entries A-028 (low parity coverage) and A-029 (missing e2e) describe two views of the same regression-risk gap. CLAUDE.md's Definition of Done already says "parity case where applicable" but the wording is too soft to enforce.

## Decision

Set per-module parity targets and a per-milestone e2e gate.

- Parity targets: ≥ 5 parity cases per major Node-compat module. Initial priority order, in descending importance: streams (including backpressure), modules (cycles, TLA), http (chunked, errors), fs (symlinks, large files), child_process (depends on ADR 0011 landing). Backfill happens incrementally — each future milestone must add ≥ 3 parity cases before it can be marked DONE.
- E2E gate: each milestone with a user-visible feature ships one Playwright spec exercising the headline scenario. Catch-up specs land for M5 (streams), M7 (preview-port), M9 (npm install), M10 (edit→preview reload).
- The Definition of Done in CLAUDE.md is updated by a follow-up edit (outside this ADR) to reference the per-milestone gate.
- Implementation deferred to M11 as an ongoing task. The gate becomes immediately binding from M11 onward.

## Consequences

- The regression bar rises milestone over milestone instead of in occasional sprints.
- Real bugs that only surface at the runtime boundary (parity-only) get caught earlier.
- Negative: each milestone's effort grows by the cost of writing the parity + e2e cases. The cost is small per case but non-zero.
- Negative: a strict gate can stall a milestone if a parity test surfaces a deep bug late. The gate is enforced by reviewer, not by CI, to allow case-by-case judgement.
- Follow-up: M11 — establish the gate; backfill the four named catch-up e2e specs.

## Acceptance criteria for the deferred implementation

- [ ] Parity cases reach 25+ by end of M11 (up from ~15 today), distributed across the priority modules.
- [ ] E2E spec files exist for M5 (streams), M7 (preview-port), M9 (npm install), M10 (edit→preview reload).
- [ ] CLAUDE.md's Definition of Done references the per-milestone gate.
- [ ] `pnpm test:parity` and `pnpm test:e2e` both pass with the expanded suites.
