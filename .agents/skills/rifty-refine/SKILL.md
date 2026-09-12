---
name: rifty-refine
description: Single human entry for rifty backlog input. Dedup, research observable choices, independently challenge a proposed direction when it could change the user's choice, resolve scope forks, formalize and report before implementation. Mid-task observations use rifty-to-backlog.
---

Refine = scan → research ↔ informed choices → formalize → fresh final check → report.
`rifty-to-backlog` is its formalize tail plus the mid-task intake — never offer
it to the user as an alternative entry.

## Preconditions

- User in session. Mid-task or agent-only context → `rifty-to-backlog` + request manual refine; never self-run the interview.
- Target: a raw idea (no doc yet) or one `draft` item/epic. A `ready` item with a live fork is demoted first (`docs/process/rules/readiness.md` `RDY-5`); a ready `goal.md` changes with the user's recorded amendment (`RDY-6`).
- Research informs the user's next choice; it does not require a full implementation design.

## 1. Scan — no mint

Dedup before grilling (`rifty-to-backlog` §2, run early): existing match →
surface it, work in that doc; declined match → stop, cite the row.

## 2. Research and challenge

Use code, ADRs and reference evidence to identify alternatives that could change
the observable result, feasibility or value. Run a disposable discriminating
probe for a live technical uncertainty affecting that choice; record command,
output and version, or keep the claim explicitly unresolved. Facts needed only
to implement a chosen route belong to FIT/PICKUP, not a speculative full design.

When recommending a new direction, apply `docs/backlog/README.md` §Challenge
before presenting the affected user choice as settled. Bring verified critic
findings back into this same research/question loop. Stop researching when the
next choice is informed; a new fact can open or close dependent forks.
Explicit just-file and settled factual captures need honest sources, not an
extra study or premise critic; proceed to Formalize and the final written-result check.

Before treating a no-fork result as settled, apply `docs/process/rules/readiness.md`
`RDY-6` §Establishing scope. Research discovers material choices from the raw
request and reachable interactions, not just from the current question list.

## 3. Grill

Requires one concrete unresolved user-observable scenario branch. None — or the
user asked to just file it — → skip to Formalize; a no-fork entry is normal
completion, not a refusal.

1. Restate the real package/program, exact action, and observed result. No real software unblocked → stop as off-mission or `process-meta`.
2. Ask in frontier rounds: one numbered round holds ALL currently-independent open forks, each with a recommendation, decisive evidence and tradeoff. A fork whose scope depends on a still-open fork (or a running spike) waits for a later round. After answers, return to Research for affected dependent choices. Close by `RDY-6`, not merely an empty frontier. The user chooses observable scope; the agent chooses carriers and other internal mechanisms.
3. Do not ask what code/ADR/Node already answers. Apply reachability and refine-altitude rules (`docs/process/rules/readiness.md` `RDY-6`, `RDY-7`).
4. For infra, ask only physically reachable fault branches within the epic tier; use `docs/process/rules/fault-classes.md` and `docs/backlog/README.md` §Tier.
5. Treat dropping or weakening a traced (`I#` / `scenario`) row as user-owned (`RDY-5`); never soften it through ADR, backlog, Out of scope, or rewritten acceptance.
6. For an epic, land the outcome as numbered `## Invariants` (shape: `docs/backlog/README.md` §Epic fit) — each false on main before the run.

## 4. Formalize and report

Hand the settled result to `rifty-to-backlog` in this invocation: mint/update
with evidence, decisions and any early Challenge record. Before completion,
run `RDY-6` §Final check of the written result on the actual final drafts in
a fresh context; early Challenge does not replace it. FIT/PICKUP can reuse
that final check only for an unchanged result. Document shape, `draft → ready`
and `backlog:check` stay with the ordinary workflow. The driver delivers `docs/backlog/README.md`
§Report before implementation. Refine-only ends with preparation; already
authorized implementation continues without another permission request.
