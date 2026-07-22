# Decision workflow — reversibility, subagents, inflections

Elaborates `AGENTS.md` §Decisions (`CLAUDE.md` = symlink). Read at any fork. Rule: decide, record, continue — never pause. Checklist picks WHERE to record, never whether to stop.

## Reversibility checklist (order matters; first "yes" wins)
1. Public API between packages → **IRREVERSIBLE** — EXCEPT a workspace-internal shared primitive: declared non-index subpath (`@riftydev/<pkg>/internal`, precedent `@riftydev/vfs/internal`), consumed only inside the repo, contract pinned by a shared suite (`describe.each` over consumers) → **REVERSIBLE**, backlog item. Layer direction still holds (`check:arch`). Rationale: pricing every shared helper as an ADR made the app-local copy free — complexity pooled in the unguarded middle (five correlation engines in `glue/`); the gradient must favor ONE owner (`fault-classes.md` §Class-kill mechanism sweep).
2. New external dependency → **IRREVERSIBLE**
3. Contradicts existing ADR → **IRREVERSIBLE** (see Reconsidering)
4. Genuine design choice — live alternatives, observable-behavior/Node-parity change, new mechanism, contested policy/default → **IRREVERSIBLE**. Size (LOC/files) alone ≠ trigger — record decisions, not diffs.
5. Else **REVERSIBLE**. Behavior-preserving + contract-stable → no governance artifact, however large: CHANGELOG line (cite rationale doc if exists). Backlog item only if embeds provisional judgment call (cache key, invalidation strategy, …).

## Actions
- REVERSIBLE + judgment call: decide provisionally → `docs/backlog/<area>/<slug>.md` (frontmatter per `docs/backlog/TEMPLATE.md`) + `// TODO(backlog: <area>/<slug>)` at site → continue.
- REVERSIBLE behavior-preserving (most refactors/perf): CHANGELOG line → continue.
- IRREVERSIBLE: decide (standing authority) → inline ADR `pnpm adr:new <area> "Title"` (options, trade-offs, choice) — or backlog item promoted to ADR before merge → continue. Unrecorded irreversible decision = defect; record-and-continue ≠ decide silently.

## Reconsidering a recorded decision
Only fork NOT settled inline: overturning active ADR or depended-on provisional decision. Dedicated decision subagent: reads decision + new context + alternatives + risks → decides → **superseding ADR** (cites overridden). Supersede mechanics: old ADR REMOVED (git keeps history), load-bearing context grafted into successor, removed→successor pointer in `docs/adr/README.md`.

## Subagent budget
- OK for: independent research, review, verification, scoped implementation.
- Max depth 1 default; 2+ needs explicit current-task permission; depth 3 read-only only (research/audit/verify/map-reduce); >3 forbidden w/o user override.
- Subagent prompt states: depth, max depth, children yes/no, mode (read-only/code-edit), owned scope.
- Leaves never spawn children — report need upward.
- Code-editing agents: disjoint file/module ownership; never revert/overwrite others' work. Parent owns integration, architecture calls, final verification.

## Inflections ≠ stops
Decide, record, re-cut plan, continue, report after:
- measurement/spike/test result changes plan or milestone order
- deferred decision's gate now met by evidence → ratify
- stale/wrong assumption, feasibility note, spec → correct course
- new external dep once need verified

Human reviews recorded decisions retrospectively — never a sync gate. (Confirm-first cases: `AGENTS.md` §Decisions.)

## Backlog readiness (draft → ready)
Items/epics are `draft` until refined. **Never implement from a draft** — first bring it to `ready` with the `rifty-refine` skill: deep analysis (code + ADRs + real Node behavior), grill the requester on scenarios until scope is sharp, resolve every fork (IRREVERSIBLE → ADR before `ready`, per the checklist above). `ready` = an implementer builds it whole: zero new decisions at refine altitude (below), zero new in-scope backlog items, the ADR (if any) already exists. A `ready` item carries Acceptance / Parity cases / Out-of-scope (loud-throw) / Decisions; a `ready` epic carries its Outcome (user value, mission-anchored) + end-to-end User scenario + enumerated Items — its children may still be `draft` (designed shape, not a defect). Refine target = the `draft` doc itself: draft child inside a `ready` epic → refine the child, never re-refine the epic. Closure = delete on done (git history is the record). Frontmatter shape + validation: `docs/backlog/README.md`.

**Capture (finding → draft).** Findings enter the backlog through the `rifty-to-backlog` skill: classify → dedup → gate (boundary model, reachability, tier, mechanism sweep) → mint. An audit finding minted directly as an item, with a `user_story` reverse-engineered afterward, is the anti-pattern capture exists to stop.

**Refine altitude — observables, not carriers.** Refine closes decisions at two altitudes: user-visible behavior (what works / what defers / observable trade-offs) and project direction (tier, strategic ADRs). Internal carriers — cache placement, wire framing, admission tokens, storage layout — enter a contract only as constraints ("must not …") or as spike-verified facts. A fork that code + ADR + real-Node reading cannot resolve is settled by a throwaway spike: the evidence goes into the contract, the code is discarded (a kept spike becomes the frame it was meant to validate). A contract prescribing carriers with neither spike nor ADR behind them is process-level `frozen-assumption` — not ready. Precedent: the first `vite-temp-install-claim-churn` contract, rejected as mechanism-prescriptive before the semantic boundary existed. A direction fork surfacing mid-refine (point-support for one tool vs an honest generic mechanism, a tier raise) gets its own ADR; the item cites it, never buries it in `## Decisions`.

**Tier — declared completeness.** An epic may declare `tier: works|robust|production` (meanings + fault scope: `docs/backlog/README.md` §Tier). Refine grills fault branches only to the declared tier (tier × boundary model = the rows in scope). Raising a tier is a direction decision: ADR first, then refine the fault delta. A finding above the declared tier parks at capture — it does not mint ordinary work.

**Reachability gate — own-product surfaces** (Workbench/Playground lifecycle & UX; anything with no external oracle). Parity work is bounded by Node — it cannot demand more than Node does. Own-product work has no such ceiling, so adversarial audits generate findings without bound. Here `ready` additionally requires a reproduction path from a user action: concrete steps through UI/public API that reach the defect, with fault injection only on axes the boundary's failure model permits (`fault-classes.md` §Boundary failure models). No such path → the item stays `draft` with the attempted repro recorded ("couldn't reproduce" ≠ "impossible" — the finding is parked, not deleted). Parity surfaces keep their existing oracle bar unchanged.

## Always reversible (no logging)
Naming, in-package file structure, internal helpers, doc wording, comments, test descriptions (not test logic — see AGENTS.md). Behavior-preserving contract-stable refactors/perf any size — CHANGELOG only.
