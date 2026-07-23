# Backlog

Two kinds of work under `docs/backlog/`:

- **Items** — one implementable unit per file: `docs/backlog/<area>/<slug>.md`.
- **Epics** — a user-value umbrella over several items: `docs/backlog/epics/<slug>.md`.

Capture a finding into a draft with the **`rifty-to-backlog`** skill; refine an item or epic to `ready` with the **`rifty-refine`** skill. Closure = **delete on done** (git history is the record); there is no "done" status.

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
Recommended: `user_story`. Optional: `items` (`[<area>/<slug>, …]`) · `tier` (see §Tier).

A `ready` epic MUST carry `## Outcome` (user value, mission-anchored) + `## User scenario` (the end-to-end scenario that means done, naming the coarse invariants its closing smoke proves) + an enumerated `## Items` in dependency order — a mechanism shared by ≥2 children is an existing owner, the first item, or an ADR why separate. See `epics/TEMPLATE.md`.

## Budget (epics handed to an autonomous run)

`## Budget` = the run's tripwires, declared at refine; over budget = stop and surface, never silent absorption:

- scope implemented outside `ready` items: 0 (capturing new drafts is fine; building them is not)
- in-place ready-contract edits alongside source changes: 0 (enforced: `pnpm check:contract-drift`)
- new coordination mechanisms: 0, or the named substrate item (`fault-classes.md` §Class-kill)
- review rounds per item: ≤ 2 (§Review convergence)
- per-item diff estimate (rough band from comparable landed items) — 2× over = anomaly, pause

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
- `ready` items/epics carry their contract sections
- `epic:` / `blocked_by:` / epic `items:` links resolve to existing items/epics
- resolves every code marker to an existing item
- prints counts per area × status

Fails CI on any violation.
