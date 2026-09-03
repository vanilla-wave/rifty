---
name: rifty-refine
description: Single human entry for rifty backlog input — a raw idea, finding, or unsettled draft/epic the user brings in session. Dedup-scan, grill the user through unresolved observable scope forks (none → skip, formalize-only), then hand the settled result to rifty-to-backlog formalization. Not for mid-task/agent-only contexts — there capture via rifty-to-backlog and request manual refine.
---

Refine = the window: scan → grill → formalize. `rifty-to-backlog` is its
formalize tail plus the mid-task intake — never offer it to the user as an
alternative entry.

## Preconditions

- User in session. Mid-task or agent-only context → `rifty-to-backlog` + request manual refine; never self-run the interview.
- Target: a raw idea (no doc yet) or one `draft` item/epic — not a ready parent. A `ready` item with a live fork is demoted first (`docs/process/rules/readiness.md` `RDY-5`).
- Exhaust code, ADR, real-Node, and disposable-spike evidence before asking.

## 1. Scan — no mint

Dedup before grilling (`rifty-to-backlog` §2, run early): existing match →
surface it, work in that doc; declined match → stop, cite the row.

## 2. Grill

Requires one concrete unresolved user-observable scenario branch. None — or the
user asked to just file it — → skip to Formalize; a no-fork entry is normal
completion, not a refusal.

1. Restate the real package/program, exact action, and observed result. No real software unblocked → stop as off-mission or `process-meta`.
2. Ask in frontier rounds: one numbered round holds ALL currently-independent open forks, each with a recommendation. A fork whose scope depends on a still-open fork (or a running spike) waits for a later round. Done when the frontier is empty. The user chooses observable scope; the agent chooses carriers and other internal mechanisms.
3. Do not ask what code/ADR/Node already answers. Apply reachability and refine-altitude rules (`docs/process/rules/readiness.md` `RDY-6`, `RDY-7`).
4. For infra, ask only physically reachable fault branches within the epic tier; use `docs/process/rules/fault-classes.md` and `docs/backlog/README.md` §Tier.
5. Treat any active-baseline change as user-owned; never soften it through ADR, backlog, Out of scope, or rewritten acceptance.
6. For an epic, land the outcome as numbered `## Invariants` (shape: `docs/backlog/README.md` §Epic fit) — each false on main before the run.

## 3. Formalize

Hand the settled result to `rifty-to-backlog` (classify → gate → mint/update →
challenge → report), same invocation: forks mint already resolved, with their
evidence; existing draft → decisions recorded into the doc, same challenge +
report tail. Document shape, `draft → ready`, and `pnpm backlog:check` stay
with the ordinary workflow.
