# Decision workflow — reversibility, anti-patterns, when-in-doubt

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

Human reviews recorded decisions retrospectively — never a sync gate. Confirm-first ONLY: outward/destructive beyond repo (publish, delete user data, spend, push shared remotes) or user-reserved direction.

## Always reversible (no logging)
Naming, in-package file structure, internal helpers, doc wording, comments, test descriptions (not test logic — see AGENTS.md). Behavior-preserving contract-stable refactors/perf any size — CHANGELOG only.

## Anti-patterns (tempting — don't)
- **"Stub for now"** → no; throw `NotImplementedError`. Fake values = subtle downstream bugs.
- **"Test too strict, relax it"** → no; tests = behavioral contracts. Wrong test → file issue, don't edit.
- **"Unit test enough, skip parity"** → parity catches what unit can't (semantic diffs, edge cases); default parity.
- **"Just mock the dependency"** → minimal mocks (`docs/process/testing.md`): real Memory VFS / tarballs / parity runner; mock only unavoidable external boundaries. Hard to instantiate = API smell — fix it.
- **"Bug fixed, existing tests pass"** → not done; found bug = coverage hole → regression test (failing first, prefer parity) or fix doesn't merge.
- **"Cleaner with back-reference"** → no reverse imports; abstraction in lower layer wrong — fix there, not by inverting deps.
- **"Handy npm helper, only 50 lines"** → new dep = long-term commitment, IRREVERSIBLE per checklist. Prefer zero-dep helper in `packages/*/src/utils/`.
- **"Fix three things in one PR"** → one change per PR; rest = separate tickets.
- **"Overwrite this ADR"** → no; active ADRs immutable. New superseding ADR (`pnpm adr:new <area>`); old removed, context grafted, pointer in `docs/adr/README.md`.
- **"Stop and ask"** → no; decide + record (REVERSIBLE → backlog + TODO; IRREVERSIBLE → inline ADR with options/trade-offs), continue. Only exception: overturning recorded decision → decision subagent.

## When in doubt
- Similar pattern elsewhere? (`rg`)
- Relevant ADR?
- Reversibility checklist (where to record, not whether to pause)
- IRREVERSIBLE + unclear → best-justified option, record in ADR, don't stop. Changing recorded decision → decision subagent.
- Never assume Node/Anthropic/StackBlitz behavior — verify via parity-runner.
