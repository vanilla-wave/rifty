# ADR 0063: Record-and-continue decisions; decision subagent for reconsiderations (supersedes ADR-0008, D-007)

Status: Accepted
Date: 2026-05-30
Supersedes: ADR-0008 — only its IRREVERSIBLE → *stop-and-wait* action. The reversibility checklist itself is retained.

## Context

ADR-0008 / D-007 told agents to STOP on any IRREVERSIBLE design fork (public API between packages, new external dependency, ADR contradiction, >100 lines / >2 files) and wait for a human via the PR description. In practice this halted long autonomous sessions on routine forks and became the dominant source of friction — work stalled waiting on calls the agent was equipped to make and record. The human owner has delegated standing authority to decide these inline.

## Decision

Agents no longer stop on irreversible decisions. The reversibility checklist (ADR-0008) is RETAINED — but only to choose *where* a decision is recorded and to signal cost-to-reverse, **not** whether to pause.

- **Any new decision (reversible or irreversible): decide, RECORD it, continue.**
  - REVERSIBLE → provisional entry in `OPEN_QUESTIONS.md` + a `// TODO(ADR): Q-…` code marker (unchanged from D-007).
  - IRREVERSIBLE → write a **new ADR inline** (the agent ratifies it), recording the options, trade-offs, and chosen path so the call is auditable. For a fast-moving fork, an `OPEN_QUESTIONS.md` entry promoted to an ADR before the work merges is acceptable.
- **Reconsidering / overturning an ALREADY-RECORDED decision** (a merged ADR, or a provisional decision that other work now depends on) is the one case that is *not* decided inline. **Launch an explicit decision subagent** — a dedicated, focused agent (the Agent tool, or a small decision workflow) that reads the existing decision, the new context, the alternatives and the risks, makes the call, and produces the **superseding ADR** (which cites the one it overrides). This focused subagent is the rigor mechanism that replaces the old human-stop.

## What does NOT change

- ADRs remain immutable after merge; supersedence stays explicit (a new ADR cites and overrides the old).
- **`Never modify a test to make code pass` stays a hard rule** — it is a correctness/integrity invariant, not a design fork, and is out of scope of this relaxation.
- The reversibility checklist still classifies decisions.
- Every irreversible decision is still WRITTEN DOWN. "Record-and-continue" is **not** "decide silently" — an unrecorded irreversible decision is a defect.

## Consequences

- Autonomous sessions proceed through design forks without stalling; the audit trail (ADRs + `OPEN_QUESTIONS.md`) carries the same information the PR-stop used to, minus the wait.
- Wrong calls are caught at review / milestone walk and corrected via the decision-subagent + superseding-ADR path, rather than prevented by a synchronous gate.
- The human reviews recorded decisions after the fact (the ADR set + `OPEN_QUESTIONS.md`) instead of being a blocking gate.

## Review cadence

Unchanged: at the end of each milestone (or sooner) walk `OPEN_QUESTIONS.md` and the new ADRs; promote / supersede / roll back. CI flags questions older than two milestones as tech debt.
