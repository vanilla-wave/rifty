# Backlog

Two kinds of work under `docs/backlog/`:

- **Items** — one implementable unit per file: `docs/backlog/<area>/<slug>.md`.
- **Epics** — a user-value umbrella over several items: `docs/backlog/epics/<slug>.md`.

New finding → **`rifty-to-backlog`** draft. Planned draft → exhaust evidence/internal decisions; fork-free = ordinary contract compilation, unresolved user-observable fork = manual **`rifty-refine`**. Planned ready item → normal implementation. Closure = **delete on done**; no "done" status.

## Areas (items)

`vfs`, `kernel`, `runtime-js`, `runtime-wasi`, `net`, `service-worker`, `npm-client`, `shell`, `playground`, `toolchain-build`, `protocol`, `process-meta`, `perf`, `terminal`, `distribution`.

## Statuses

- Items: `draft` (rough, not pickup-ready) · `ready` (a tight contract — see below).
- Epics: `draft` · `ready` · `in-progress`.
- Dropped: `active`/`parked`/`blocked` collapsed into draft/ready. A real dependency goes in `blocked_by:` (a field, not a status).

## Item frontmatter

Required: `area` (= parent folder, a known area) · `status` (`draft|ready`) · `title` · `created` (`YYYY-MM-DD`) · `why`.
Recommended: `user_story` (line right after `why`) — `As <persona>, I want <X>, but today <blocker>`.
Optional: `epic` (parent epic slug) · `blocked_by` (`[<area>/<slug>, …]`) · `sources` · `code`. Arrays as `[a, b]`.

## `ready` = a contract an implementer can't close with an approximation

A `ready` item MUST carry (enforced by `backlog:check`):

- `## User scenario` — **required only when the item has no `epic:`** (an epic child inherits the scenario from its epic — don't duplicate). The epic-grade concrete scenario: the real npm package / Node program the user runs, the exact call, what they observe; mission-anchored (can't name real software it unblocks → not user value).
- `## Acceptance` — concrete, testable done-definition; an approximation fails it.
- `## Parity cases` — the exact Node behaviors to pin, each a failing-test-first target (enumerated, never "plus parity cases").
- `## Out of scope` — the exact inputs/APIs that throw `NotImplementedError` + compat ❌ (named, never "…").
- `## Decisions` — every fork resolved or ADR-linked; no open "Decide X".

Infra-touching item (cache/persistence/network/concurrency) → also `## Fault matrix`: applicable axes (`docs/process/fault-classes.md`) × operation → honest outcome (fallback / degraded / loud throw), each row a fault-test target. A single «works or falls back» sentence is not a matrix — enumerate the rows. Not machine-checked (`backlog:check` can't judge "touches infra") — review-enforced via the DoD fault-matrix row. Shape: `TEMPLATE.md`.

A `draft` item needs only `## Context`. See `TEMPLATE.md`.

## Epic frontmatter

Required: `kind: epic` · `status` (`draft|ready|in-progress`) · `title` · `created` · `value` (one-line user outcome).
Recommended: `user_story`. Optional: `items` (`[<area>/<slug>, …]`) · `tier` (see §Tier) · `goal_baseline` (exact SHA, required while an autonomous run is active).

A `ready` epic MUST carry `## Outcome` + end-to-end `## User scenario` + known `## Items`. Known children seed dependency order; reverse-linked items (`epic: <slug>`) are the authoritative live residual set and may be added just-in-time. No exhaustive upfront feature plan. A mechanism shared by ≥2 known children is an existing owner, the first unit, or an ADR why separate.

## Frozen autonomous goal

Establish and land the run before source work: commit the ready epic, then add
`goal_baseline: <that exact SHA>` in a marker-only commit. The marker is
write-once; the bootstrap PR may change only `docs/backlog/*.md`. Each later
source PR must repeat the marker already present at its merge-base:

```
Goal-Baseline: <epic-slug>@<40-hex-commit>
Budget-Slice: <epic-slug>/<slice>
```

Exactly one declaration of each, same epic. `check:goal-contract` requires the
PR SHA to match the merge-base marker and checks its whole first-parent history,
even without a declaration, so another PR cannot ratchet or pre-edit it.
Frozen: `value`, `tier`, Outcome, User scenario; title/user_story are indexes,
items/order/Budget are run state. Only the user can amend observable goal.
Required discoveries reverse-link and prevent completion; outside-goal work
uses normal capture.

## Budget (epics handed to an autonomous run)

`## Budget` = slice tripwires, declared before its Contract+RED. Existing tripwires/bands cannot be weakened; new just-in-time slice may be appended before pickup. Over budget = re-cut current unit, never narrow goal or defer a required clause:

- scope implemented outside `ready` items: 0 (capturing new drafts is fine; building them is not)
- in-place ready-contract edits alongside source changes: 0 (enforced: `pnpm check:contract-drift`)
- new coordination mechanisms: 0, or the named substrate item (`fault-classes.md` §Class-kill)
- review rounds per item: ≤ 2 (§Review convergence)
- per-item diff estimate (rough band from comparable landed items) — at 2× = stop/re-cut

`check:budget` and `check:contract-drift` share pickup = parent of first source
commit. A preceding Contract+RED commit may add a JIT unit/Budget row; later
implementation cannot rewrite it. Closure removes only exact frontmatter
`items:` / `blocked_by:` keys; Items prose and Budget rows remain historical
authority. Multiple slices fail. Mechanism grep is advisory; Final review owns
the full modified-file sweep.

## Tier

`tier: works|robust|production` on an epic declares how complete the capability is REQUIRED to be; items inherit it (no per-item tier). Composes with `docs/process/fault-classes.md` §Boundary failure models: tier × boundary = the fault rows in scope. The no-silent-lie bar has no tier — it holds everywhere.

- `works` — happy path honest; any fault on the boundary's real surface may resolve to one loud throw.
- `robust` — every (real axis × operation) resolves to its honest outcome (fallback / degraded-visibly / loud throw), each row a fault test.
- `production` — `robust` + crash/reload consistency + e2e fault-injection proof.

No `tier` = undeclared: refine decides per item. Raising a tier is a strategic decision — ADR first, then refine the fault delta (`docs/process/decision-workflow.md` §Backlog readiness); a finding above the declared tier parks at capture.

## Code markers

```
// TODO(backlog: <area>/<slug>)
```

Every marker must resolve to an existing item.

## Validation

`pnpm backlog:check` runs `tools/backlog/check.mjs`:

- validates item/epic frontmatter (required keys, status enum, area = folder = known)
- `ready` items and `ready|in-progress` epics carry their contract sections
- `goal_baseline` is exact 40-hex and carries a declared tier
- `epic:` / `blocked_by:` / epic `items:` links resolve to existing items/epics
- resolves every code marker to an existing item
- prints counts per area × status

Fails CI on any violation.
