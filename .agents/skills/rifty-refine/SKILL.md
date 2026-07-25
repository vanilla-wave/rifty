---
name: rifty-refine
description: Manually close unresolved user-observable scope forks in one existing draft rifty backlog item or epic after code/ADR/Node evidence is exhausted. Not for intake, internal mechanism decisions, filling contract sections, or promoting a settled draft to ready.
---

Close the remaining user-observable forks in the given existing `draft`.

New/raw finding → `rifty-to-backlog` first. Refine owns the interview only; ordinary workflow owns evidence-backed internal decisions and contract compilation.

**Precondition.** Code, ADRs, real Node, and any throwaway spike have been exhausted; at least one concrete user-observable scenario branch remains genuinely open. Otherwise stop applying this skill: ask nothing and return the draft to ordinary contract compilation.

**Target = the `draft` doc itself.** A `ready` epic with `draft` children is the designed shape, not a defect — refine the draft child (it leans on the epic's scenario), never re-refine the `ready` epic. The epic is the target only when its own doc is `draft`, or its shape is wrong (overlap, bad split).

## Lead with the user scenario
Write the concrete developer scenario first: the **real npm package / Node program** the user runs, the exact call, what they observe — re-derived from the user's POV, not inherited from the item's (often mechanism-first) framing. Can't name real software it unblocks? Not user value — off-mission or `process-meta` test/tooling debt: say so and stop. The scenario is the spine: every question sharpens one branch of it.

## Analyze deeply — never skip to asking
- Read the real code, ADRs, compat matrix for the area(s); verify against actual Node — never assume.
- Already built (stale-check) → say so, close it, don't refine.
- Overlaps a sibling item/epic → merge or carve a clean boundary.

## Grill until the scope is sharp
Interview the user one scenario-branch at a time (each branch = a case the user hits), resolving dependencies in order. One question at a time, with your recommended answer.
- **User owns the observable boundary; the agent owns the mechanism.** Ask ONLY which real software/case is in or out. No user-visible difference (wire format, broker location, dispatch) → stop the interview branch; ordinary workflow decides + records it. A question citing no scenario branch is invalid.
- Codebase / ADRs / Node already answer it → explore, don't ask.
- Infra-touching scope (cache/persistence/network/concurrency) → grill failure branches like scenario branches: what does the user observe when the fast path / store / network breaks mid-operation? Each answer = a `## Fault matrix` row (axes: `docs/process/fault-classes.md`). Cite the boundary's row in §Boundary failure models and strike excluded axes — never refine machinery against a fault the transport cannot physically produce.
- Own-product surface (no external oracle — Workbench/Playground lifecycle & UX) → apply the reachability gate (`docs/process/decision-workflow.md` §Backlog readiness): `ready` needs a user-action repro path; an unreproduced audit finding stays `draft` with the attempt recorded.
- Owning epic declares `tier:` → grill fault branches only to that tier (tier × boundary model = the rows in scope; `docs/backlog/README.md` §Tier). A branch demanding more parks pending a tier-raise ADR — it is not a scenario branch.
- A fork that would change an active `Goal-Baseline` is user-owned and cannot be softened via ADR, backlog, or Out of scope.

## Altitude — observables, not carriers
Refine closes user-visible forks and direction; it never designs internal carriers (cache placement, wire framing, admission tokens, storage layout). A carrier enters the contract only as a constraint ("must not …") or as a spike-verified fact. Fork unresolvable from code + ADR + real-Node reading → throwaway spike: evidence into the contract, code discarded — a kept spike becomes the frame it was meant to validate. Full rule + precedent: `docs/process/decision-workflow.md` §Refine altitude.
- Keep going until in / out of scope and every fork are settled — zero open assumptions for the implementer.

## Shape
- Too big for one implementer pass → epic: outcome + end-to-end user scenario as acceptance, split into child items (`epic: <slug>`).
- Atomic → item.

## Done

Every user-observable fork is answered and the answers/evidence are recorded in the draft. Leave document form and `draft → ready` to the ordinary compiler (`docs/backlog/README.md` + template + `pnpm backlog:check`). Do not duplicate that phase inside this skill.
