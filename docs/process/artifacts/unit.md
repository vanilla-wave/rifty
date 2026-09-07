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
| `## Acceptance` | agent, traced | numbered rows, each `… → I3` / `→ scenario` / `→ ADR-NNNN` (`RDY-3`; a rule-id-only trace is a note); an approximation must fail; a row whose oracle is real Node carries a runner case or a real-Node artifact, whatever the section — a hand-typed golden is no carrier: the row grades `missing` (`REV-4`) |
| `## Parity cases` | agent, traced | enumerated oracle behaviors, each a RED target; carrier = a `tools/node-parity-runner` case, or for browser-only behavior a test asserting real-Node output captured as the artifact (command + output + version); a hand-typed golden is no carrier — the row grades `missing` (`fault-classes.md` frozen-assumption) |
| `## Fault matrix` | agent, traced | infra only: `axis × operation \| honest outcome \| artifact / fault target → trace` (`fault-classes.md`) |
| `## Out of scope` | agent (user for scope cuts) | named loud throws + compat ❌; never "…" |
| `## Decisions` | agent + runner | one-line records only, forms below |

`## Decisions` line forms (each one line, dated):

```md
ready-verdict: <date> — Contract+RED @ <sha>          first line at pickup, verbatim
ready-verdict: <date> — inherited from <area>/<slug> @ <sha>
re-cut: <date> — <what changed> — trace: none           RDY-5; a split names its predecessor here
re-cut: <date> — fork: <what> — trace: I#               resolved via rifty-refine
override: <date> — <challenge problem> — <user words>   docs/backlog/README.md §Challenge
- <date> — <gist>                                       any other record: a reception verdict (REV-12), a stop (STOP-6), a fork with its pre-demotion row verbatim (RDY-5)
- <fork resolved or ADR-linked; no open "Decide X">
```

Every unit uses the same review record (`verdict.md`). A unit with no useful
contract doc names its PR and baseline in the verdict. Deleting the completed
draft does not delete the review; no ordinary/prose record format exists.
`check:contract-drift` compares the graded sections; decisions and context are
history. `check:pass-binding` validates the review and its actual version.

Not in a unit: evidence blocks (→ `docs/backlog/<area>/reference/<slug>-evidence.md`),
fork narratives and diagnoses (→ ledger / `reference/`), review reasoning (→
verdict files).
