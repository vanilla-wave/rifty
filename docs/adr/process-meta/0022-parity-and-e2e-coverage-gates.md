# ADR 0022: Parity and E2E coverage gates per milestone

Status: Implemented (2026-05-24) — parity runner mounts `setup.files` alongside the entry script in both Node and rifty, unblocking cross-file CJS-cycle and ESM TLA cases. Added `modules/cjs-cycle` + `modules/tla`; total 21 (up from 19). `pnpm check:parity-coverage` enforces per-module coverage (≥ 1 floor mandatory, ≥ 5 target warned); `pnpm check:e2e-coverage` tracks per-milestone e2e (non-failing, lists M3/M5/M6/M7/M8/M9/M10 gap). Both wired into the `lint-and-typecheck` CI job. Backfill to 25+ / per-milestone-spec target remains M11 work.
Date: 2026-05

## Context

Parity runner has ~15 cases in a few modules; streams backpressure, fs edge cases, http error paths, module cycles, and child_process have none. E2E Playwright covers M0–M4 but not M5–M10, despite those milestones adding user-visible behavior (streams, preview port, npm install, edit→preview reload).

REVIEW_ACTIONS A-028 (low parity coverage) and A-029 (missing e2e) are two views of the same regression-risk gap. CLAUDE.md's DoD says "parity case where applicable" but is too soft to enforce.

## Decision

Set per-module parity targets and a per-milestone e2e gate.

- **Parity targets:** ≥ 5 cases per major Node-compat module. Priority order (descending): streams (incl. backpressure), modules (cycles, TLA), http (chunked, errors), fs (symlinks, large files), child_process (depends on ADR 0011 landing). Backfill is incremental — each future milestone must add ≥ 3 parity cases before being marked DONE.
- **E2E gate:** each milestone with a user-visible feature ships one Playwright spec for the headline scenario. Catch-up specs: M5 (streams), M7 (preview-port), M9 (npm install), M10 (edit→preview reload).
- CLAUDE.md DoD updated by a follow-up edit (outside this ADR) to reference the per-milestone gate.
- Implementation deferred to M11 as an ongoing task; the gate is binding from M11 onward.

## Consequences

- Regression bar rises milestone-over-milestone instead of in occasional sprints.
- Runtime-boundary bugs (parity-only) caught earlier.
- Negative: each milestone's effort grows by the cost of the parity + e2e cases — small per case but non-zero.
- Negative: a strict gate can stall a milestone if a parity test surfaces a deep bug late. Enforced by reviewer, not CI, to allow case-by-case judgement.
- Follow-up: M11 — establish the gate; backfill the four named catch-up e2e specs.

## Acceptance criteria for the deferred implementation

- [ ] Parity cases reach 25+ by end of M11 (from ~15), across the priority modules.
- [ ] E2E spec files exist for M5 (streams), M7 (preview-port), M9 (npm install), M10 (edit→preview reload).
- [ ] CLAUDE.md DoD references the per-milestone gate.
- [ ] `pnpm test:parity` and `pnpm test:e2e` both pass with the expanded suites.
