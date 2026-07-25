# Backlog

- Item: one implementable unit at `docs/backlog/<area>/<slug>.md`.
- Epic: user outcome spanning items at `docs/backlog/epics/<slug>.md`.

Routing: `AGENTS.md` + `docs/process/decision-workflow.md`. Delete completed
work; there is no done status.

## Shape

Areas: `vfs`, `kernel`, `runtime-js`, `runtime-wasi`, `net`, `service-worker`,
`npm-client`, `shell`, `playground`, `toolchain-build`, `protocol`,
`process-meta`, `perf`, `terminal`, `distribution`.

| | Item | Epic |
|---|---|---|
| Status | `draft\|ready` | `draft\|ready\|in-progress` |
| Required | `area`, `status`, `title`, `created`, `why` | `kind: epic`, `status`, `title`, `created`, `value` |
| Optional | `user_story`, `epic`, `blocked_by`, `sources`, `code` | `user_story`, `tier`, `goal_baseline` |

`area` equals the parent folder. Dates use `YYYY-MM-DD`; arrays use `[a, b]`.
Place `user_story` after `why`/`value`: `As <persona>, I want <action>, but today
<blocker>`.

A draft needs `## Context`. A ready item needs:

- `## User scenario` unless its epic supplies it: real package/program, exact
  call, observed result;
- `## Acceptance`: testable done-definition that rejects approximations;
- `## Parity cases`: enumerated oracle behaviors and RED targets;
- `## Out of scope`: named loud throws + compat ❌;
- `## Decisions`: every fork resolved or ADR-linked;
- any `draft→ready` flip: a `ready-verdict:` line from the fresh-context judge
  (`decision-workflow.md` §Backlog readiness).

External-oracle work adds `## Reference contract` with pinned version/mechanism;
semantic copies require an ADR + differential suite.

Infra work also needs `## Fault matrix`: each reachable axis × operation →
fallback, visible degradation, or loud throw; each row is a fault-test target.
Use `docs/process/fault-classes.md`. Template: `TEMPLATE.md`.

A ready/in-progress epic needs `## Outcome`, end-to-end `## User scenario`,
numbered checkable `## Invariants` (observable statements the closing smoke
proves; legacy epics add them at next refine), and `## Items`. Known children
seed order; reverse links (`epic: <slug>`) are the live residual set. Map a Budget slice once:

```md
- `area/item` — **slice-name** — dependency/result
```

A mechanism shared by two children needs an existing owner, a first substrate
item, or an ADR explaining separation. Template: `epics/TEMPLATE.md`.

## Autonomous goal

Only an explicit whole-ready-epic hand-off or a task/PR carrying `Goal-Baseline`
starts a run.

1. Land the ready epic.
2. In a later commit, add only
   `goal_baseline: <parent ready-epic SHA>`.
3. Every source PR repeats exactly one same-epic pair:

```text
Goal-Baseline: <epic>@<40-hex-commit>
Budget-Slice: <epic>/<slice>
```

The marker is write-once and inherited from merge-base. It freezes `value`,
`tier`, Outcome, User scenario, and `## Invariants`; only the user may change
them. Title and
`user_story` are indexes; children, order, mechanisms, slices, and append-only
Budget are live run state.

Required discoveries stay reverse-linked; only outside-goal work enters normal
backlog. A required discovery may mint a `draft` child (`epic:` link) at any
time; its readiness, Items mapping, and Budget row wait for a pre-pickup window. A clean slice may merge while goal residuals remain. Close the goal
only with no linked children, empty unit/goal residuals, end-to-end baseline
proof, fresh `goal_complete: true`, and DoD green on one SHA; then delete it.

## Budget

Each autonomous source PR selects one epic `## Budget` row. Tripwires:

- scope implemented outside ready items: `0`;
- ready-contract edits beside source: `0`;
- new coordination mechanisms: `0`, unless the named substrate item owns one;
- review checkpoints per slice: exactly `2`;
- hand-written insertion band = inserted lines in the slice source PR (tests/
  generated globs excluded — `check:budget`): above high warns; at `2×` high re-cut.

Pickup is the parent of the first production-source commit. Before pickup,
Contract+RED may append one ready JIT child, its Items mapping, and its Budget
row; existing rows/tripwires cannot weaken. After pickup, closure may only
subtract exact `blocked_by:` dependencies from ready items; Items prose and
Budget stay as authority. Optional `generated globs` exclude generated files
from the band.

## Gates

| Owner | Enforces |
|---|---|
| `backlog:check` | schema, ready sections, links, markers |
| `check:goal-contract` | bootstrap/marker history, frozen fields, linked-child deletion |
| `check:budget` | paired declaration, append-only Budget, pickup row/item, band |
| `check:contract-drift` | post-pickup ready contracts and process referees |
| Final review | run membership, semantic scope/residuals, review count, full mechanism sweep, acceptance |

`pr:check`/CI run the machine gates.

## Tier

The epic tier bounds required fault behavior; items inherit it:

- `works`: honest happy path; reachable faults may loud-throw;
- `robust`: every reachable axis × operation has an honest outcome + fault test;
- `production`: robust + crash/reload consistency + e2e fault proof.

No silent lie is allowed at any tier. No tier means undecided and cannot start an
autonomous run. Raising tier requires an ADR; above-tier findings remain draft.

## Code markers

`// TODO(backlog: <area>/<slug>)` must resolve to an existing item.
