---
name: rifty-refine
description: Refine a piece of value (epic or item) to `ready` for the rifty backlog — grill the user on scenarios until scope is sharp, deep analysis, user-value framing, a contract an implementer can't close with an approximation. Manual invocation only.
disable-model-invocation: true
---

Refine the given piece of value (epic, item, or raw idea) to `ready`.

## Lead with the user scenario
Write the concrete developer scenario first: the **real npm package / Node program** the user runs, the exact call, what they observe — re-derived from the user's POV, not inherited from the item's (often mechanism-first) framing. Can't name real software it unblocks? Not user value — off-mission or `process-meta` test/tooling debt: say so and stop. The scenario is the spine: every question sharpens one branch of it.

## Analyze deeply — never skip to drafting
- Read the real code, ADRs, compat matrix for the area(s); verify against actual Node — never assume.
- Already built (stale-check) → say so, close it, don't refine.
- Overlaps a sibling item/epic → merge or carve a clean boundary.

## Grill until the scope is sharp
Interview the user one scenario-branch at a time (each branch = a case the user hits), resolving dependencies in order. One question at a time, with your recommended answer.
- **User owns the boundary; you own the mechanism.** Ask ONLY user-observable forks: which real software must work, which cases are in vs out. Mechanism with identical observable behavior (wire-format, broker location, internal dispatch) is YOURS — decide + record (REVERSIBLE → CHANGELOG/backlog; IRREVERSIBLE → ADR BEFORE `ready`), never ask.
- **No user-visible difference between the options → not a user question.** Decide it, record it. A question citing no scenario branch is the wrong one.
- Codebase / ADRs / Node already answer it → explore, don't ask.
- Keep going until in / out of scope and every fork are settled — zero open assumptions for the implementer.

## Shape
- Too big for one implementer pass → epic: outcome + end-to-end user scenario as acceptance, split into child items (`epic: <slug>`).
- Atomic → item.

## `ready` bar — built whole: zero new decisions, zero new in-scope items, ADR already exists
Item: **User scenario** (capability + the real package/program exercising it — carry in `user_story`) · **Acceptance** (concrete, testable — an approximation fails it) · **Parity cases** (exact Node behaviors, each a failing-test-first target — enumerated, never "plus parity cases") · **Out of scope** (exact inputs/APIs that throw `NotImplementedError` + compat ❌ — named, never "…") · **Decisions** — each one YOU resolved (mechanism) or an ADR link, never a question parked for the user.
Epic: Outcome + end-to-end User scenario + enumerated Items, each child `ready` or `draft` with a clear path.
Flip `draft → ready` only when the bar is met. Shape: `docs/backlog/README.md`.
