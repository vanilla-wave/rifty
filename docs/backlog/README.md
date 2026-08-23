# Backlog

- Item: one implementable unit at `docs/backlog/<area>/<slug>.md`.
- Epic: user outcome spanning items at `docs/backlog/epics/<slug>/` — `goal.md`
  (frozen destination) + `map.md` (live plan) + `ledger.md` (append-only
  journal). Template: `epics/TEMPLATE.md`. Legacy single-file epics remain
  valid until re-typed or closed; no new ones.

Routing: `AGENTS.md` + `docs/process/decision-workflow.md`; goal lifecycle
(FIT / PICKUP / RE-CHART / CLOSE): `rifty-goal` skill. Delete completed work;
there is no done status.

## Shape

Areas: `vfs`, `kernel`, `runtime-js`, `runtime-wasi`, `net`, `service-worker`,
`npm-client`, `shell`, `playground`, `toolchain-build`, `protocol`,
`process-meta`, `perf`, `terminal`, `distribution`.

| | Item | Epic (`goal.md`) |
|---|---|---|
| Status | `draft\|ready` | `draft\|ready` |
| Required | `area`, `status`, `title`, `created`, `why` | `kind: epic`, `status`, `title`, `created`, `value` |
| Optional | `user_story`, `epic`, `blocked_by`, `sources`, `code` | `user_story`, `tier` (required at ready) |

`area` equals the parent folder. Dates use `YYYY-MM-DD`; arrays use `[a, b]`.
Place `user_story` after `why`/`value`: `As <persona>, I want <action>, but today
<blocker>`. An epic is a bounded, provably closable destination — a direction,
theme, or standing invariant is not an epic (route to `docs/ROADMAP.md`, an
owner doc, or a ratchet).

A draft is one of two shapes — never a solution without its decision:

- **question** — `## Question` + context; no prescribed carrier (a carrier with
  no spike/ADR fact = frozen assumption). Exits: compiled to `ready`, absorbed
  into a goal's `map.md` fog, or declined into `docs/adr/README.md` §Declined
  concepts.
- **finding** — observed fact/gap with evidence: `## Context`, honest sources,
  compat ❌ / code-marker link. A draft whose `sources`/`code` refs no longer
  resolve on main is stale: refresh or delete.

A ready item needs:

- `## User scenario` unless its epic supplies it: real package/program, exact
  call, observed result;
- `## Acceptance`: testable done-definition that rejects approximations; an
  admission/policy surface names the organic request form it admits — a pinned
  fixture alone is not reach;
- `## Parity cases`: enumerated oracle behaviors and RED targets;
- `## Out of scope`: named loud throws + compat ❌;
- `## Decisions`: every fork resolved or ADR-linked;
- once picked up: `ready-verdict: <date> — Contract+RED @ <sha>` from the
  unit's checkpoint, recorded before implementation
  (`decision-workflow.md` §Backlog readiness).

External-oracle work adds `## Reference contract` with pinned version/mechanism;
semantic copies require an ADR + differential suite.

Infra work also needs `## Fault matrix`: each reachable axis × operation →
fallback, visible degradation, or loud throw; each row is a fault-test target.
Use `docs/process/fault-classes.md`. Template: `TEMPLATE.md`.

A ready goal (`goal.md`) needs `## Outcome`, end-to-end `## User scenario`,
numbered checkable `## Invariants` (each false on current main, evidence
recorded), `tier`, and a user `signoff:` line covering invariants AND tier.
`map.md` seeds order and holds `## Open questions` (fog) + `## Out of scope`;
`ledger.md` opens empty. Seed order proves the minimal pattern first (the
null/install-only case of a shared mechanism lands before machinery for the
maximal case); a child whose contract depends on an open question is not
seeded. A mechanism shared by two children needs an existing owner, a first
substrate item, or an ADR explaining separation. Procedure, incl.
probe-or-fog and signoff: `rifty-goal` FIT.

## Goal run

An explicit whole-ready-goal hand-off starts a run; the goal directory is the
run id. Loop: `rifty-goal` (PICKUP → build → RE-CHART, then CLOSE).

- A slice PR names its goal and its ledger band row in the body
  (convention, review-checked — `rifty-review` axis 5).
- Review-owned rules: scope outside `ready` items: 0; ready-contract edits
  after pickup: 0 (items: `check:contract-drift`); new coordination
  mechanisms: 0 unless a named substrate item owns one; hand-written insertions
  far above the declared band, or an expected-RED batch far above it → the unit
  is too big: re-cut/split before implementation.
- A ready `goal.md` never changes — amend = close + re-fit. `ledger.md` only
  grows. `map.md` is live: RE-CHART graduates fog into drafts, re-cuts or
  deletes unpicked items, reorders; weakening a `ready` item stays a demotion
  with its fork recorded (§Backlog readiness 5).
- Slices land serially — never stack a slice PR on an unmerged one.
- Close only with no linked children, empty unit/goal residuals, end-to-end
  proof of `## Invariants`, and the ledger walk exporting every line to a
  durable carrier or an explicit drop (`rifty-goal` CLOSE); then delete the
  directory whole.

## Gates

| Owner | Enforces |
|---|---|
| `backlog:check` | schema, ready sections, links, markers, goal-dir shape |
| `check:contract-drift` | ready item contracts vs merge-base beside source |
| Final review | frozen goal, append-only ledger, run membership, checkpoint order, scope/residuals, mechanism sweep, acceptance |

Machine gates prove only the listed local facts; review owns everything else —
including that a ready `goal.md` never changed and the ledger only grew.

## Tier

The epic tier bounds required fault behavior; items inherit it:

- `works`: honest happy path; reachable faults may loud-throw;
- `robust`: every reachable axis × operation has an honest outcome + fault test;
- `production`: robust + crash/reload consistency + e2e fault proof.

No silent lie is allowed at any tier. No tier means undecided and cannot start a
goal run. Raising tier requires an ADR; above-tier findings remain draft.

## Code markers

`// TODO(backlog: <area>/<slug>)` must resolve to an existing item.
