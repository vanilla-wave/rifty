# ADR 0507: Report fixed corpus uncertainty without equality claims

Status: Accepted
Date: 2026-10-05

## Context

ADR-0434/0505 own serial series/report, source records and separate Codex reference.
PR341 I4/I5/I7 needs uncertainty/identity for a fixed finite corpus before live
comparison; three repeats cannot establish equivalence or general capability.

## Decision

- Existing JSON owner remains authority; statistics/Markdown derived views only.
- Complete task/lane cells: exact binomial Clopper–Pearson95%, conditional iid
  trials. Simultaneous bands allocate alpha0.05 over selected finite cells;
  equal-task macro bounds and Pi difference bounds follow the union guarantee.
  No between-cell independence assumed; within-cell/provider correlations may
  invalidate the binomial assumption. Incomplete cells point unknown/[0,1].
- Calibration/evaluation/smoke/control/diagnostic separated; task/family counts
  distinguish repeats. Native Codex reference has no Pi delta; unavailable counters stay unknown.
- Original selected matrix remains primary; failed setup/provider/judge/runtime
  and missing work visible. Before/after rejects task/judge/config/purpose drift;
  intentional source changes remain recorded.
- Legacy ±1/3 noise annotation descriptive only; not replaced with equality or
  a merge threshold. Live experiment stays on demand, no paid CI participant.

## Alternatives/evidence

- Wald normal approximation: rejected for few repeats/extreme proportions; zero
  width at0/3 or3/3 lies about uncertainty. Endpoint analytic reference needed.
- Task-resampling bootstrap/general-task population claim: rejected; corpus is
  chosen/family-split, not random population sample. Two app families insufficient.
- CP/finite-cell union bands: selected; conservative wide limits are an honest
  result. No statistical library/dependency/state coordinator needed.

Primary references: [NIST binomial intervals](https://itl.nist.gov/div898/handbook/prc/section2/prc241.htm),
[NIST union inequality](https://itl.nist.gov/div898/handbook/prc/section4/prc473.htm).
NIST20/4 example90% limits0.071354/0.401029 + independent analytic endpoints
validate numerical implementation; task-macro use is our fixed-corpus inference.
