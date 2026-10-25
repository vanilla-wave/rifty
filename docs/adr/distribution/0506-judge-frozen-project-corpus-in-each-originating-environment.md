# ADR 0506: Judge frozen project corpus in each originating environment

Status: Accepted
Date: 2026-10-05

## Context

ADR-0434 owns the private bench/serial runner. PR341 I1/I3/I6/I7 needs real
project fixes/features and installed minimal starter apps; preview-only judges
cannot grade library changes. No runtime compatibility repairs in this slice.

## Decision

- Versioned manifest/cards pin input/prompt/judge/lock bytes; v3 lock, disjoint
  calibration/evaluation families. Seeds exclude controls/private checks.
- Retain upstream sources/tests/licenses. Common trusted semantic checks cover
  explicit task/regression behavior; do not claim original test runners passed.
- Inject private command checks after the actual agent, using existing file
  capabilities; real terminal/project/native process supplies exit/output.
  Preview app judges remain browser interactions in the originating preview.
- Existing runner/report owns reference/baseline/partial/alternative controls;
  no model invoked, agent status not-run, results separate from quality.
  Selected setup/unsupported/judge failures remain evidence, never native rescue.
- COI seeds exact project via ordinary workspace archive import; +chat executes
  actual agent. Packed noCOI uses public SDK fs/project.run; native uses npm/Node.

## Alternatives/evidence

- Original node:test/Tape/Mocha wrappers everywhere: measured browser failures
  (bad option9, pipe/worker replacement, getter/exports); not admission authority.
- Trusted plain node:assert semantic checks: measured pass/fail0/1 all three Pi
  origins, independent native24 pilot controls; selected. Source fixture mapping
  explicit; timing-window/perf wrappers not claimed functional regression proof.
- Export to Node/private happy-path fake: rejected by I3/Fidelity.

Evidence: `docs/backlog/distribution/reference/agent-eval-project-corpus-evidence.md`,
`agent-eval-corpus-substrate-controls.json.gz`, strengthened concurrency control
bundle and independent Contract+RED. Fresh premise critic accepts semantic port;
reference failures still visible. Pilot counts never close I11.
