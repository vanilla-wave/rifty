---
name: rifty-refine
description: Refine a backlog epic or item to `ready` — lead with the user scenario, grill scope sharp, so an implementer can't approximate it. Manual invocation only.
disable-model-invocation: true
---

Refine the given piece of value (epic, item, or raw idea) to `ready`.

Refine is the contract half of the pipeline: audit/review findings arrive as drafts minted by `rifty-to-backlog` (capture — classify, dedup, gates); a finding that skipped capture goes through it first.

**Target = the `draft` doc itself.** A `ready` epic with `draft` children is the designed shape, not a defect — refine the draft child (it leans on the epic's scenario), never re-refine the `ready` epic. The epic is the target only when its own doc is `draft`, or its shape is wrong (overlap, bad split).

## Lead with the user scenario
Write the concrete developer scenario first: the **real npm package / Node program** the user runs, the exact call, what they observe — re-derived from the user's POV, not inherited from the item's (often mechanism-first) framing. Can't name real software it unblocks? Not user value — off-mission or `process-meta` test/tooling debt: say so and stop. The scenario is the spine: every question sharpens one branch of it.

## Analyze deeply — never skip to drafting
- Read the real code, ADRs, compat matrix for the area(s); verify against actual Node — never assume.
- Already built (stale-check) → say so, close it, don't refine.
- Overlaps a sibling item/epic → merge or carve a clean boundary.

## Grill until the scope is sharp
Interview the user one scenario-branch at a time (each branch = a case the user hits), resolving dependencies in order. One question at a time, with your recommended answer.
- **User owns the boundary; you own the mechanism.** Ask ONLY user-observable forks: which real software must work, which cases are in vs out. No user-visible difference between the options (wire-format, broker location, internal dispatch) → not a user question: decide + record yourself (REVERSIBLE → CHANGELOG/backlog; IRREVERSIBLE → ADR BEFORE `ready`), never ask. A question citing no scenario branch is the wrong one.
- Codebase / ADRs / Node already answer it → explore, don't ask.
- Infra-touching scope (cache/persistence/network/concurrency) → grill failure branches like scenario branches: what does the user observe when the fast path / store / network breaks mid-operation? Each answer = a `## Fault matrix` row (axes: `docs/process/fault-classes.md`). Cite the boundary's row in §Boundary failure models and strike excluded axes — never refine machinery against a fault the transport cannot physically produce.
- Own-product surface (no external oracle — Workbench/Playground lifecycle & UX) → apply the reachability gate (`docs/process/decision-workflow.md` §Backlog readiness): `ready` needs a user-action repro path; an unreproduced audit finding stays `draft` with the attempt recorded.
- Owning epic declares `tier:` → grill fault branches only to that tier (tier × boundary model = the rows in scope; `docs/backlog/README.md` §Tier). A branch demanding more parks pending a tier-raise ADR — it is not a scenario branch.
- Direction fork (point-support for one tool vs an honest generic mechanism, a tier raise) → its own strategic ADR; the item cites it, never buries it in `## Decisions`.

## Altitude — observables, not carriers
Refine closes user-visible forks and direction; it never designs internal carriers (cache placement, wire framing, admission tokens, storage layout). A carrier enters the contract only as a constraint ("must not …") or as a spike-verified fact. Fork unresolvable from code + ADR + real-Node reading → throwaway spike: evidence into the contract, code discarded — a kept spike becomes the frame it was meant to validate. Full rule + precedent: `docs/process/decision-workflow.md` §Refine altitude.
- Keep going until in / out of scope and every fork are settled — zero open assumptions for the implementer.

## Shape
- Too big for one implementer pass → epic: outcome + end-to-end user scenario as acceptance, split into child items (`epic: <slug>`).
- Atomic → item.

## `ready` bar — built whole: zero new decisions at refine altitude, zero new in-scope items, ADR already exists
A contract prescribing carriers with neither spike nor ADR behind them is not ready (process-level `frozen-assumption`).
Item — five contract sections, shapes + anti-approximation rules all in `docs/backlog/README.md` (`backlog:check` enforces them; read there, don't restate): **`## User scenario`** (the spine from §Lead with — required unless the item has an `epic:` parent, which owns it) · **Acceptance** · **Parity cases** · **Out of scope** · **Decisions**. Every fork is one YOU resolved (mechanism) or an ADR link — never parked for the user.
Infra-touching item: contract also carries **`## Fault matrix`** — applicable axes from `docs/process/fault-classes.md` × operation → honest outcome (fallback / degraded / loud throw), each row a fault-test target. A single «works or falls back» sentence is not a matrix — enumerate the rows.
Epic: Outcome + end-to-end User scenario (naming the coarse invariants its closing smoke proves) + Items in dependency order — a mechanism shared by ≥2 children is an existing owner, the first item, or an ADR why separate; handed to an autonomous run → also `## Budget` (`docs/backlog/README.md` §Budget). Each child `ready` or `draft` with a clear path. An epic-child item leans on the epic's User scenario — its contract is Acceptance/Parity/Out-of-scope/Decisions only.
Flip `draft → ready` only when the bar is met.
