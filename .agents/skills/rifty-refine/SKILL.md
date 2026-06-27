---
name: rifty-refine
description: Refine a piece of value (epic or item) to `ready` for the rifty backlog — grill the user on scenarios until scope is sharp, deep analysis, user-value framing, a contract an implementer can't close with an approximation. Manual invocation only.
disable-model-invocation: true
---

Refine the given piece of value (epic, item, or raw idea) to `ready`.
Always treat the input as a piece of USER VALUE, not a task: state the outcome from the user's POV and how it grows the rifty ecosystem (real Node software in the browser, per the mission). Off-mission → say so and stop.

## Analyze deeply — never skip to drafting
- Read the real code, ADRs, compat matrix for the area(s) touched; verify against actual Node behavior — never assume.
- Already built? (stale-check) → say so and close it, don't refine.
- Overlap with sibling items/epics → merge or carve a clean boundary so nothing falls through the crack.

## Grill until the scope is sharp — don't assume
Interview the user relentlessly about SCENARIOS until the piece of value has a crisp boundary: what exactly must the user be able to do, which cases are in vs out, which edges. Walk the decision tree one branch at a time, resolving dependencies between decisions in order.
- One question at a time. For each, give your recommended answer.
- If the codebase / ADRs / Node behavior answer it, explore instead of asking.
- Keep going until in-scope, out-of-scope, and every fork are settled — zero open assumptions left for the implementer. IRREVERSIBLE fork (public API / new dep / contradicts an ADR) → the ADR lands BEFORE `ready`, not at pickup.

## Shape (as scope crystallizes)
- Too big for one implementer pass → epic: user-value outcome + an end-to-end user scenario as acceptance, split into child items (`epic: <slug>`).
- Atomic → item.

## `ready` bar — implementer builds it whole: zero new decisions, zero new in-scope items, ADR already exists
Item is `ready` only with: **Acceptance** (concrete, testable — an approximation fails it) · **Parity cases** (exact Node behaviors, each a failing-test-first target — enumerated, never "plus parity cases") · **Out of scope** (exact inputs/APIs that throw `NotImplementedError` + compat ❌ — named, never "…") · **Decisions** resolved/ADR-linked.
Epic is `ready` with its Outcome + end-to-end User scenario + enumerated Items, each child itself `ready` or `draft` with a clear path.
Flip `draft → ready` only when the bar is met. Frontmatter + section shape: `docs/backlog/README.md`.
