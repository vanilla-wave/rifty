# Decision workflow — reversibility, subagents, inflections

Elaborates `AGENTS.md` §Decisions (`CLAUDE.md` = symlink). Read at any fork. Rule: decide, record, continue — never pause. Checklist picks WHERE to record, never whether to stop.

## Reversibility checklist (order matters; first "yes" wins)
1. Public API between packages → **IRREVERSIBLE**
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

## Always reversible (no logging)
Naming, in-package file structure, internal helpers, doc wording, comments, test descriptions (not test logic — see AGENTS.md). Behavior-preserving contract-stable refactors/perf any size — CHANGELOG only.
