# Backlog

- Item: one implementable unit at `docs/backlog/<area>/<slug>.md`.
- Epic: user outcome spanning items at `docs/backlog/epics/<slug>/` — `goal.md`
  (frozen destination) + `map.md` (live plan) + `ledger.md` (append-only
  journal). Template: `epics/TEMPLATE.md`. Legacy single-file epics remain
  valid until re-typed or closed; no new ones.

Routing: `AGENTS.md` + `docs/process/README.md`; artifact shapes and
owners: `docs/process/artifacts/`; goal lifecycle (FIT / PICKUP / RECHART /
CLOSE): `docs/process/stages/`. Delete completed work; there is no done status.

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
- `## Parity cases`: enumerated oracle behaviors and RED targets — where an
  oracle exists; a process/tooling unit has none and omits the section;
- every Acceptance/Parity/Fault row traced (`→ I#` / `→ scenario` /
  `→ ADR-NNNN`; a `→ <rule-id>` trace is a note, never an obligation —
  `docs/process/rules/readiness.md` `RDY-3`; gated by `backlog:check` for
  items `created ≥ 2026-09-03`); one intent, one-sentence `title` (`RDY-4`);
- `## Out of scope`: named loud throws + compat ❌;
- `## Decisions`: every fork resolved or ADR-linked; one-line records only
  (`docs/process/artifacts/unit.md`);
- once picked up: `review: checkpoints | ordinary` (`RDY-8`) and, for
  `checkpoints`, `ready-verdict: <date> — Contract+RED @ <sha>` from the
  unit's checkpoint, recorded before implementation (`RDY-2`).

External-oracle work adds `## Reference contract` with pinned version/mechanism;
semantic copies require an ADR + differential suite.

Infra work also needs `## Fault matrix`: each reachable axis × operation →
fallback, visible degradation, or loud throw; each row is a fault-test target.
Use `docs/process/rules/fault-classes.md`. Template: `TEMPLATE.md`.

## Challenge

Every new item and epic (`created` ≥ 2026-08-27) carries `## Challenge` before
merge: one fresh independent critic (never the author's context — raw doc only,
no author framing; frame-then-validate voids it) attacks the premise: does the
claimed value follow from the proposed work; is the causal/impact claim sized
against the whole (share of the real user-visible cost/gap, evidenced in the
doc); is there a cheaper route to the same value. It names problems explicitly,
especially **user experience** (which real user scenario benefits, and does it
materially) and **project direction** (mission/ROADMAP fit, opportunity cost).
Verdict verbatim: `challenge: <date> — clear` or `challenge: <date> — N
problems` + one grounded line each. Advisory at capture — never blocks a draft
landing or a run start. Two premise classes BLOCK `draft→ready`: the claimed
value does not follow from the proposed work, and a materially cheaper direct
authority reaches the same value. Each closes by answering it in the doc or by
a recorded user override (`## Decisions` line naming the override) — never by
compiling past it; these are the findings a review cannot raise later, because
by then the work is the premise. Every other problem stays advisory and
surfaces verbatim in the completion report (§Report), in refine, and in the
capturing PR body. Fabricated speculative doubt = failure symmetric to missing
a rotten premise. `backlog:check` enforces presence + verdict line only.

## Epic fit

A ready goal (`goal.md`) needs `## Outcome`, end-to-end `## User scenario`,
numbered checkable `## Invariants` (each false on current main, evidence
recorded), and `tier`. No approval gate: FIT flips `status: ready` itself and
ends with the completion report (§Report) — a ready goal is immediately
runnable.
`map.md` seeds order and holds `## Open questions` (fog) + `## Out of scope`;
`ledger.md` opens empty. Seeded children stay `draft` — a ready goal hands off
with draft children; each compiles to `ready` at its own PICKUP, never at FIT
(`docs/process/rules/readiness.md` `RDY-1`).

Fog is owner-typed. A user-owned observable-scope question (what the value
requires, what must NOT change, whose scenario counts) is asked at FIT while
the user is there — a probe existing for its technical half is not a reason to
park it (`docs/process/stages/fit.md` 3). It reaches fog only when it is not answerable
yet, tagged `owner: user` + why; PICKUP routes such a line to `rifty-refine`,
never to a probe (`docs/process/artifacts/map.md`). Every fog line: `<question> — owner: user|agent — <what
settles it>`. A rejected rival route is recorded checkable in goal `##
Decisions`: `rejected route: <route> — violates <I#|Outcome clause>` — the
clause a later agent cites instead of re-deriving the comparison. Seed order proves the minimal pattern first (the
null/install-only case of a shared mechanism lands before machinery for the
maximal case); a child whose contract depends on an open question is not
seeded. A mechanism shared by two children needs an existing owner, a first
substrate item, or an ADR explaining separation. Procedure, incl.
probe-or-fog and the completion report: `docs/process/stages/fit.md`.

## Report

Every user-facing backlog write-up (refine, FIT, re-fit) ends with a report
delivered in the conversation — not an approval ask, not a PR comment, not a
file. Form and producer procedure (fresh clean-context subagent, six
sections): `rifty-to-backlog` §6 Report — the single canon. Replaces the
former `signoff:` gate (removed 2026-08-28): the user reacts if the
destination is wrong — pushback re-opens FIT; nothing waits on a reply. A
mid-task capture (no user in session) and a RECHART-minted draft ride the
unit's branch and its ledger / journal line — no report.

## Goal run

An explicit whole-ready-goal hand-off starts a run; the goal directory is the
run id. Stages, roles, stops, PR rules: `docs/process/README.md`. Store-level
facts that hold inside a run: a ready `goal.md` never changes (amend = CLOSE +
FIT); `ledger.md` only grows; `map.md` and unit contracts are re-cut by the
agent (`RDY-5`); every landed slice gets a `re-chart after <slice>` ledger
line; scope outside `ready` items: 0; new coordination mechanisms: 0 unless a
named substrate item owns one.

## Gates

| Owner | Enforces |
|---|---|
| `backlog:check` | schema, ready sections, links, markers, goal-dir shape, challenge presence; trace on ready items `created ≥ 2026-09-03` |
| `check:contract-drift` | frozen goal fields beside source (single-file and dir-format goals); a ready contract (status + graded sections) changed beside source carries `re-cut:`; a ready flip carries `ready-verdict:` or `review: ordinary`; referees land separately |
| Final review | frozen goal, append-only ledger, review membership, checkpoint order, scope/residuals, mechanism sweep, acceptance |

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
