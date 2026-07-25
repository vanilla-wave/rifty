---
name: rifty-refine
description: Refine a backlog epic or item to `ready` — close its open scope forks; lead with the user scenario, grill scope sharp, so an implementer can't approximate it. NOT for writing out an already-settled contract — missing/unfilled sections alone are plain writing per `docs/backlog/README.md`, not refine. Manual invocation only.
disable-model-invocation: true
---

Refine the given piece of value (epic, item, or raw idea) to `ready`.

Refine is the fork-closing half of the pipeline (user-tier): findings enter via `rifty-to-backlog` (capture); fork-free items reach `ready` there through the judge — what lands HERE is drafts with open forks. A finding that skipped capture goes through it first. Canon of both paths: `docs/process/decision-workflow.md` §Backlog readiness.

**Refine = closing open forks, not document form.** A draft whose scope is already settled — forks closed by ADRs, recorded decisions, or verified evidence (a de-facto choice buried in code is a frozen assumption, not a settled fork) — needs no refine: write the contract per `docs/backlog/README.md` + `TEMPLATE.md` and flip through the judge verdict (§Backlog readiness). Missing sections alone are never a reason to propose refine.

**Target = the `draft` doc itself.** A `ready` epic with `draft` children is the designed shape, not a defect — refine the draft child (it leans on the epic's scenario), never re-refine the `ready` epic. The epic is the target only when its own doc is `draft`, or its shape is wrong (overlap, bad split). A `ready` item with a discovered unsettled fork → demote to `draft` first (separate PR, fork recorded — §Backlog readiness), then refine.

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
- Too big for one implementer pass → epic: frozen envelope (Outcome + end-to-end User scenario + numbered checkable `## Invariants` + tier/Out-of-scope/Budget) + `## Items` as a LIVING plan the run may re-cut — pre-decide order only where it is user-value-bearing (`docs/backlog/README.md` §Epic). Grill the invariants like scenario branches: each = a pass/fail observable the closing smoke proves.
- Atomic → item.

## `ready` bar — built whole
Zero new decisions at refine altitude, zero new in-scope items, the ADR (if any) already exists. Every fork is one YOU resolved (mechanism) or an ADR link — never parked for the user. A contract prescribing carriers with neither spike nor ADR behind them is not ready (process-level `frozen-assumption`).
Section shapes — item contract, `## Fault matrix` rows, epic envelope (Outcome/Scenario/`## Invariants`/Budget) + living Items — all in `docs/backlog/README.md` + `TEMPLATE.md` (`backlog:check` enforces the core sections; the rest — review): write to them, never restate or grill about them.
Flip `draft → ready` only when the bar is met.
