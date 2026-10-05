# No-COI agent host kit

## Current scope — amended 2026-10-01

amend: 2026-10-01 — user: «давай явно выпилим ее из этого ПРа» — remove the
reference host identity → force → reconciliation chain from PR357 scenario4/9
and I8. ADR-0490 supersedes ADR-0489 D1–D2. Initial preparation and saved open
are explicit; no replacement marker or automatic overwrite. Other obligations
retain their prior authority and evidence. SDK validation/explicit force stay.

The closure below and prior verdicts describe the pre-amendment tree, not proof
of the amended result. Current proof: `agent-host-explicit-open-evidence.md`.
Independent arch-review repairs cover npm optional→dev saves, overlapping root
dependency selection and recovered registry errors. Current tree8cd595116 passes
pr:check27/27 and the full packed consumer, including both registry configurations,
saved open, unchanged SDK snapshot/archive proofs and shared-host benchmark smoke.
Final verdict: `agent-host-explicit-open-final-green.json`; no required residuals.

## Post-review repair — 2026-10-05

Named npm updates and optional metadata/acquisition/admission saves repaired
against native npm. Source1e7aa25e9: pr:check27/27 and full packed16+178 GREEN;
independent verification passed. Evidence: `pr357-npm-repair-evidence.md`;
verdict: `pr357-npm-repair-final-green.json`. Earlier verdicts retain their
historical SHA; the repair introduces no required goal residual.

## Historical closure — 2026-09-30

Delivered in PR #357. Implementation reviewed at
`2534d1e97ef838c07c0c4caa6c464877347dc7a4`; independent whole-goal PASS,
I1–I10 satisfied, no required residuals. Final verdict and executed evidence:
`agent-reference-host-final-green.json`, `agent-reference-host-evidence.md`.

An existing non-COI app connects public SDK + agent APIs through the copyable
`tests/integration/fixtures/workbench-vite-consumer/src/host.ts`; actual packed
CI and agent-bench boot that same module. Typed lifecycle outcomes/progress,
distinct opt-in file/shell policies, native text-only transport, shared transcript,
connected-registry install and ordered shell output remain library behavior.
App-owned snapshot ID and desired manifest implement reopen/deploy reconciliation.
Guide: `packages/rifty/README.md`; ADR-0483–0489 record decisions.

Proof on the reviewed tree: `pnpm pr:check`27/27 without reruns; full default
packed consumer with16 first-party +178 external tarballs, both registry
configurations and mandatory shared-host benchmark smoke; source deployment
recipe2/2 and config/comparison guards18/18. Same actual benchmark CLI reaches
judge/screenshot after preview repair; scripted read-only model's quality failure
is expected. Quality evaluation remains PR #341; visual debugging remains its
separate epic. Command fidelity findings outside the kit retain their draft owners.

## Accepted destination and decisions

Original user decisions, scenarios and invariants are preserved in the
[reviewed goal](https://github.com/vanilla-wave/rifty/blob/2534d1e97ef838c07c0c4caa6c464877347dc7a4/docs/backlog/epics/no-coi-agent-host-kit/goal.md).
The [final ledger](https://github.com/vanilla-wave/rifty/blob/bccaeb601/docs/backlog/epics/no-coi-agent-host-kit/ledger.md)
links every accepted slice. These historical records retain the exact user words
behind the ADR index's declined alternatives; closure changes none of them.
