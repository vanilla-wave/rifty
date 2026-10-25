# ADR 0505: Local evaluation series evidence and native Codex reference

Status: Accepted
Date: 2026-10-05

## Context

PR #341 goal I8/I9 requires local scripts, partial evidence and fresh series.
ADR-0434 owns the existing serial runner/report. Its decision6 exclusion conflicts
with I3's complete selected matrix. Native Codex is a separate reference.

## Decision

1. Existing serial runner remains the only writer. Exclusive output mkdir;
   immutable resolved matrix/input fingerprints in header before host setup;
   atomic JSON replacement. JSON is authority, Markdown a regenerable view.
   Completed attempts persist before cleanup; missing rows derive from the plan.
   Signals stop execution, retain evidence; next run rejects occupied output.
2. Supersede only ADR-0434 decision6's unsupported-node exclusion for new
   selected series: retain selected unsupported trials as unsuccessful with
   setup reason. Historical reports/42-run baseline remain historical evidence.
3. Native Codex uses real public noninteractive JSONL CLI, separate explicit
   model/reasoning/sandbox config, ephemeral fresh session and project. Ignore
   user config/rules/project instructions; retain actual events and diff. Success
   requires turn.completed plus common own-environment judge, never exit0 alone.
   Native observed-tool cancellation differs from Pi pre-dispatch admission;
   record that limitation, never assert tool/context equivalence.

## Alternatives and evidence

- Existing report owner + exclusive mkdir/atomic JSON: selected. REDs reproduce
  overwrite, absent pre-setup/missing report, silently skipped trial. No resume.
- Per-trial ledger/resume coordinator: rejected; I9 forbids continuation; no
  required observation needs another state owner (REV-7).
- Export to Node for judging: rejected by goal I3 own-environment result.
- Fabricated common loop: rejected; real Codex completion/usage exists.

Independent DEC-2 reviewer `/root/series_decision` confirmed this scope and
minimal carrier. Probes: `docs/backlog/distribution/reference/agent-eval-local-runner-evidence.md`,
`docs/backlog/distribution/reference/agent-eval-codex-execution-probe.json`,
`docs/backlog/distribution/reference/agent-eval-codex-cancellation-probe.json`.
Codex0.159.3 cancelled exit0 has no turn.completed; flags alone are not isolation proof.

## Consequences

Occupied output throws. Partial reports show uncompleted work. No crash-resume
service. Codex controls/model remain a labelled reference, not a causal control.
