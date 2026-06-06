# ADR 0063: Record-and-continue decisions; decision subagent for reconsiderations (supersedes ADR-0008, D-007)

Status: Accepted
Date: 2026-05-30
Supersedes: ADR-0008 — only its IRREVERSIBLE → *stop-and-wait* action; the reversibility checklist is retained.

## Context

ADR-0008 / D-007 made agents STOP on any IRREVERSIBLE fork (public API between packages, new external dependency, ADR contradiction, >100 lines / >2 files) and wait for a human via the PR. This halted long autonomous sessions on routine forks — the dominant source of friction. The human owner has delegated standing authority to decide these inline.

## Decision

Agents no longer stop on irreversible decisions. The reversibility checklist (ADR-0008) is RETAINED, but only to choose *where* a decision is recorded and to signal cost-to-reverse — not whether to pause.

- **Any new decision (reversible or irreversible): decide, RECORD it, continue.**
  - REVERSIBLE → provisional entry in `OPEN_QUESTIONS.md` + a `// TODO(ADR): Q-…` code marker (unchanged from D-007).
  - IRREVERSIBLE → write a **new ADR inline** (agent ratifies it) with options, trade-offs, chosen path. For a fast-moving fork, an `OPEN_QUESTIONS.md` entry promoted to an ADR before merge is acceptable.
- **Reconsidering / overturning an ALREADY-RECORDED decision** (a merged ADR, or a provisional decision other work now depends on) is the one case NOT decided inline. **Launch an explicit decision subagent** (the Agent tool or a small decision workflow): it reads the existing decision, new context, alternatives, and risks, decides, and produces the **superseding ADR** (citing the one it overrides). This focused subagent replaces the old human-stop as the rigor mechanism.

## What does NOT change

- ADRs stay immutable after merge; supersedence stays explicit (new ADR cites and overrides the old).
- **`Never modify a test to make code pass` stays a hard rule** — a correctness/integrity invariant, not a design fork; out of scope of this relaxation.
- The reversibility checklist still classifies decisions.
- Every irreversible decision is still WRITTEN DOWN. "Record-and-continue" is **not** "decide silently"; an unrecorded irreversible decision is a defect.

## Consequences

- Autonomous sessions proceed through forks without stalling; the audit trail (ADRs + `OPEN_QUESTIONS.md`) carries the same information as the PR-stop, minus the wait.
- Wrong calls are caught at review / milestone walk and corrected via the decision-subagent + superseding-ADR path, not prevented by a synchronous gate.
- The human reviews recorded decisions after the fact (the ADR set + `OPEN_QUESTIONS.md`) rather than as a blocking gate.

## Review cadence

Unchanged: at each milestone end (or sooner) walk `OPEN_QUESTIONS.md` and new ADRs; promote / supersede / roll back. CI flags questions older than two milestones as tech debt.
