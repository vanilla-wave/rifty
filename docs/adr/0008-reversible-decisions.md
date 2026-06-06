# ADR 0008: Reversible decisions — agents don't block on every dilemma (D-007)

Status: Accepted
Date: 2026-05

Summarizes D-007 (PROJECT_PLAN.md §8): agents apply a reversibility checklist to design forks instead of pausing to consult.

## Checklist (first "yes" wins)

1. Public API between packages affected? → IRREVERSIBLE.
2. New external dependency required? → IRREVERSIBLE.
3. Contradicts an existing ADR? → IRREVERSIBLE.
4. Reverting touches >100 lines or >2 files? → IRREVERSIBLE.
5. Else → REVERSIBLE.

## Action

- **REVERSIBLE:** provisional decision; mark code `// TODO(ADR): Q-YYYY-MM-DD-NNN`; log to `OPEN_QUESTIONS.md`; continue.
- **IRREVERSIBLE:** stop, write the question + options into the PR description, wait for human.

## Artifacts

- `OPEN_QUESTIONS.md` — living buffer in repo root.
- `pnpm adr:promote Q-YYYY-MM-DD-NNN` — promotes a confirmed question to a fresh ADR, removes its `TODO(ADR)` markers.
- `pnpm todo:adr` — reports open count (CI surfaces, doesn't block).

## Review cadence

End of each milestone (or sooner): walk `OPEN_QUESTIONS.md` — promote / reject / defer. CI flags questions older than two milestones as tech debt.
