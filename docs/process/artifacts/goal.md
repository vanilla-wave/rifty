# goal.md — destination (frozen once `status: ready`)

`docs/backlog/epics/<slug>/goal.md`. The only frozen artifact of a run. Machine
gate: `check:contract-drift` refuses changes to `value`, `tier`, `## Outcome`,
`## User scenario`, `## Invariants` beside source; review (`review.md` `REV-10`
axis 3) owns the rest.

| Section | Owner | Edits |
|---|---|---|
| frontmatter `kind: epic`, `status`, `title`, `created`, `value`, `user_story`, `tier` (required at ready) | user via FIT | FIT only |
| `## Outcome` — user value + faithful-runtime payoff | user | FIT only |
| `## User scenario` — end-to-end steps whose success closes the goal | user | FIT only |
| `## Invariants` — numbered `I#`, user-observable, each false on current main (evidence comment above the list) | user via FIT | FIT only; the trace targets of every child row (`readiness.md` `RDY-3`) |
| `## Challenge` — fresh critic verdict `challenge: <date> — clear | N problems` (`docs/backlog/README.md` §Challenge) | critic | append at FIT / re-fit |
| `## Decisions` — fit-time one-liners; `rejected route: <route> — violates <I#|Outcome clause>` | user + agent at FIT | FIT only |

Rules: a ready goal never changes inside a run — amend = CLOSE + FIT
(`stops.md` `STOP-1e`); before the first PICKUP report-driven pushback re-fits
it in place. Tier bounds required fault behavior (`docs/backlog/README.md`
§Tier); raising it needs an ADR. A rival route is recorded checkable, never as
prose; no invariant excludes it = a missing invariant. Procedure: `../stages/fit.md`.
