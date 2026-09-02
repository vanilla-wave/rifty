# unit — one implementable item

`docs/backlog/<area>/<slug>.md`. Template: `docs/backlog/TEMPLATE.md`; store
rules (areas, statuses, challenge, tier): `docs/backlog/README.md`. Shape
gate: `backlog:check`.

| Section | Owner | Content |
|---|---|---|
| frontmatter `area, status, title, created, why` (+ `user_story, epic, blocked_by, sources, code`) | agent | `title` = the one intent in one sentence (`readiness.md` `RDY-4`) |
| `## Context` | agent | situation; draft shape: **question** or **finding** |
| `## Challenge` | critic | `challenge: <date> — clear \| N problems` (`docs/backlog/README.md` §Challenge) |
| `## User scenario` | user scope, agent words | required without `epic:`; real software, exact call, result |
| `## Reference contract` | agent | external oracle only: implementation + exact version, mechanism reused |
| `## Acceptance` | agent, traced | numbered rows, each `… → I3` / `→ scenario` / `→ ADR-NNNN` / `→ <rule-id>` (`RDY-3`); an approximation must fail |
| `## Parity cases` | agent, traced | enumerated oracle behaviors, each a RED target with its artifact (command + output + version) |
| `## Fault matrix` | agent, traced | infra only: `axis × operation \| honest outcome \| artifact / fault target → trace` (`fault-classes.md`) |
| `## Out of scope` | agent (user for scope cuts) | named loud throws + compat ❌; never "…" |
| `## Decisions` | agent + verdict lines | one-line records only, forms below |

`## Decisions` line forms (each one line, dated):

```md
ready-verdict: <date> — Contract+RED @ <sha>          first line at pickup, verbatim
ready-verdict: <date> — inherited from <area>/<slug> @ <sha>
review: checkpoints rounds:<n> | ordinary               RDY-8 / RDY-9
contract-red: <date> — blocker @ <sha>                  each blocker verdict (REV-8)
final-green: <date> — blocker @ <sha>
final-green: <date> — PASS @ <sha>                      landed (REV-8)
re-cut: <date> — <what changed> — trace: none           RDY-5
re-cut: <date> — fork: <what> — trace: I#               resolved via rifty-refine
override: <date> — <challenge problem> — <user words>   README §Challenge
- <fork resolved or ADR-linked; no open "Decide X">
```

Not in a unit: evidence blocks (→ `docs/backlog/<area>/reference/<slug>-evidence.md`),
fork narratives and diagnoses (→ ledger / `reference/`), review reasoning (→
verdict files). Limits for `created ≥ 2026-09-02`: ≤ 15 traced rows, ≤ 200
lines (`RDY-4`, `backlog:check`).
