# PR359 — fresh merge preparation review

BASE `be8ca87e6b38b3f2d4cb57074ff7e8f922f541df`. Independent Standards and Spec
agents reviewed the full PR against main `f112e5f35` and the accepted goal
at136c94ade. Both found one required defect: failed core compaction end events
increment the benchmark's successful-compaction counter. Standards also noted
two stale retry-policy descriptions; corrected to the shipped native policy.

## Authority and reproduction

I12 actual per-lane observations; ADR0472; benchmark README explicitly counts
successful compactions. Real core session with restored history and failed
summary provider: threshold failure plus overflow recovery failure,
`success:false` twice; observed successful0, reported2. No real endpoint called.

Root: core compaction phase=end represents settlement, not necessarily success;
native CLI compaction_end instead carries a result only on success. The shared
observer omitted the core success discriminator. Fault: `provenance-lie` at
owned event→measurement projection. Sweep: core success/failure/abort and native
result/error/abort; existing aborted guard and native result predicate retained.
The same observer serves both browser lanes; native CLI remains unchanged.

## Proof

- Existing real native/core differential suite strengthened with observed metric
  counts; no replacement oracle or fake rifty package. Before fix: summary-failure
  RED2≠0, other11 cases PASS. After fix:12/12, including successful compaction.
- Focused continuation/catalog-metrics/privacy:22/22 PASS. Revert of the single
  success guard restores the exact failed-summary RED.
- Replay of both frozen benchmark archives:84/84 metric rows unchanged; all
  recorded compaction counters are0. No paid rerun or replacement measurement.
- Native CLI still derives success from result presence; failed/aborted native
  events have no result. Core token accounting remains from full trace usage.
- Current shared-runner policy has native retry enabled3/2000 and transport0;
  both README corrections describe existing code, no policy change.

Local artifacts: `/private/tmp/rifty-pr359-merge-compaction-{repro.json,red.log,green.log,revert.log}`,
`/private/tmp/rifty-pr359-merge-replay.log`; original independent reports
`/private/tmp/rifty-pr359-merge-{standards,spec}-review.md`.

External comments: binary attachment P1 contradicts the accepted shell/project-file
route; no required repair. Continue draft overwrite P2 stays explicit advisory,
already recorded in PR body; no claim that its behavior changed.

Full `pnpm pr:check`:25/25 PASS (test:run186.2s, parity58.4s), no isolated
reruns; `/private/tmp/rifty-pr359-merge-pr-check.log`. Independent repair verify
and latest-head CI remain before merge readiness.
