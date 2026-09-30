# No-COI agent host kit — closed 2026-09-30

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
