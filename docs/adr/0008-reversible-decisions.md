# ADR 0008: Reversible decisions — agents don't block on every dilemma (D-007)

Status: Accepted
Date: 2026-05

Summary of decision D-007 from PROJECT_PLAN.md §8. AI agents apply a reversibility checklist to design forks instead of pausing to consult.

## Checklist (first "yes" wins)

1. Public API between packages affected? → IRREVERSIBLE.
2. New external dependency required? → IRREVERSIBLE.
3. Contradicts an existing ADR? → IRREVERSIBLE.
4. Reverting would touch >100 lines or >2 files? → IRREVERSIBLE.
5. Else → REVERSIBLE.

## Action

- **REVERSIBLE:** make a provisional decision, mark the code with `// TODO(ADR): Q-YYYY-MM-DD-NNN`, log to `OPEN_QUESTIONS.md`, continue.
- **IRREVERSIBLE:** stop, write the question into the PR description with options, wait for human.

## Artifacts

- `OPEN_QUESTIONS.md` — living buffer in repo root.
- `pnpm adr:promote Q-YYYY-MM-DD-NNN` — promotes a confirmed question to a fresh ADR and removes its `TODO(ADR)` markers from code.
- `pnpm todo:adr` — reports the open count (CI surfaces it but does not block).

## Review cadence

End of each milestone (or sooner if needed): walk `OPEN_QUESTIONS.md`, promote / reject / defer. CI flags questions older than two milestones as tech debt.
