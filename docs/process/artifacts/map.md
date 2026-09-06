# map.md — live plan (agent-owned)

`docs/backlog/epics/<slug>/map.md`. Index, not store: one line + link per
entry; content lives on items and the ledger. Freely edited at every RECHART.

| Section | Form | Rules |
|---|---|---|
| `## Items` | `1. \`<area>/<slug>\` — **<slice>** — <dependency/result>` | seed order proves the minimal pattern first (null/install-only case before machinery for the maximal case); a child whose contract depends on an open question is not seeded; only specifiable children — never pre-slice fog |
| `## Open questions` (fog) | `<question> — owner: user\|agent — <what settles it; for owner: user, why not answerable now>` | owner-typed; `owner: user` is never probed — asked when it blocks the run (frontier empty, CLOSE — `stops.md` `STOP-4` 3) or answered by the user any time via `rifty-refine`; a mixed question is split by owner; an answer that could invalidate the destination is never fog |
| `## Out of scope` | `- <ruled beyond the destination> (<who, date>)` | never graduates; a rejected rival route also lands in goal `## Decisions` as `rejected route:` |

A mechanism shared by two children needs an existing owner, a first substrate
item, or an ADR explaining separation. Frontier = `## Items` rows whose unit
is open, unblocked by `blocked_by`, in order. A row leaves `## Items` when its
unit lands (RECHART deletes the unit) or leaves the path (`stops.md` `STOP-4`:
the row becomes a fog line owned like its trace — `owner: user` for an `I#` /
scenario row or a fork, `owner: agent` otherwise; the unit file stays `draft`).
