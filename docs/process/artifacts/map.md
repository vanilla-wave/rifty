# map.md — live plan (agent-owned)

`docs/backlog/epics/<slug>/map.md`. Index, not store: one line + link per
entry; content lives on items and the ledger. Freely edited at every RECHART.

| Section | Form | Rules |
|---|---|---|
| `## Items` | `1. \`<area>/<slug>\` — **<slice>** — <dependency/result>` | seed order proves the minimal pattern first (null/install-only case before machinery for the maximal case); a child whose contract depends on an open question is not seeded; only specifiable children — never pre-slice fog |
| `## Open questions` (fog) | `<question> — owner: user\|agent — <what settles it; for owner: user, why not answerable now>` | owner-typed; `owner: user` routes to `rifty-refine` at PICKUP, never to a probe; a mixed question is split by owner; an answer that could invalidate the destination is never fog |
| `## Out of scope` | `- <ruled beyond the destination> (<who, date>)` | never graduates; a rejected rival route also lands in goal `## Decisions` as `rejected route:` |

A mechanism shared by two children needs an existing owner, a first substrate
item, or an ADR explaining separation. Frontier = open children with `epic:`
backlinks, unblocked by `blocked_by`, in seed order.
