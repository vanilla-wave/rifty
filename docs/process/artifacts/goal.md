# goal.md — user-owned destination

`docs/backlog/epics/<slug>/goal.md`. Accepted scope changes only with the user's
recorded decision (`RDY-6`); the agent owns implementation, not the promise.
The machine checks that a changed goal carries a new `amend:` record. Review
checks authorization and the affected obligations.

| Section | Owner | Edits |
|---|---|---|
| frontmatter `kind: epic`, `status`, `title`, `created`, `value`, `user_story`, `tier` (required at ready) | user via FIT | FIT or explicit user amendment |
| `## Outcome` — user value + faithful-runtime payoff | user | FIT or explicit user amendment |
| `## User scenario` — end-to-end steps whose success closes the goal | user | FIT or explicit user amendment |
| `## Invariants` — numbered `I#`, user-observable, each false on current main (evidence comment above the list) | user via FIT | FIT or explicit user amendment; the trace targets of every child row (`readiness.md` `RDY-3`) |
| `## Challenge` — fresh critic verdict `challenge: <date> — clear | N problems` (`docs/backlog/README.md` §Challenge) | critic | refine / FIT; reuse unchanged premise |
| `## Decisions` — fit-time one-liners; `rejected route: <route> — violates <I#|Outcome clause>` | user + agent at FIT | FIT or explicit user amendment |

Amend in place: `amend: <date> — user: <their words> — <what changed and why>`
in `## Decisions`. Rechart dependencies and obtain missing proof for the new
promise; retain valid unchanged evidence. History stays in git. Tier still
bounds faults; raising it needs the user's choice and the ADR (`RDY-7`).
Procedure: `../stages/fit.md`, `readiness.md` `RDY-6`.
