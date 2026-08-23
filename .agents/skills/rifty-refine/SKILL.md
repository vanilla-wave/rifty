---
name: rifty-refine
description: Interview the user to close unresolved observable scope forks in one draft rifty item or epic — or in a raw idea, which is captured to a draft first — after evidence and internal decisions are exhausted.
---

Refine owns only the interview. New finding → `rifty-to-backlog`; settled draft →
ordinary contract compilation.

## Preconditions

- Target one `draft` document, not its ready parent. A `ready` item with a live fork is demoted first (`decision-workflow.md` §Backlog readiness).
- Raw idea with no doc yet → capture it first (`rifty-to-backlog`: classify → dedup → gate → mint draft), then interview that draft — one invocation covers both.
- Exhaust code, ADR, real-Node, and disposable-spike evidence first.
- Require one concrete unresolved user-observable scenario branch. Otherwise ask nothing and stop.

## Interview

1. Restate the real package/program, exact action, and observed result. No real software unblocked → stop as off-mission or `process-meta`.
2. Ask in frontier rounds: one numbered round holds ALL currently-independent open forks, each with a recommendation. A fork whose scope depends on a still-open fork (or a running spike) waits for a later round. Done when the frontier is empty. The user chooses observable scope; the agent chooses carriers and other internal mechanisms.
3. Do not ask what code/ADR/Node already answers. Apply reachability and refine-altitude rules from `docs/process/decision-workflow.md` §Backlog readiness.
4. For infra, ask only physically reachable fault branches within the epic tier; use `docs/process/fault-classes.md` and `docs/backlog/README.md` §Tier.
5. Treat any active-baseline change as user-owned; never soften it through ADR, backlog, Out of scope, or rewritten acceptance.
6. For an epic, land the outcome as numbered `## Invariants` (shape: `docs/backlog/README.md` §Shape) — each false on main before the run.

Done when every observable fork and its evidence are recorded in the draft. The ordinary workflow owns document shape, `draft → ready`, and `pnpm backlog:check`.
