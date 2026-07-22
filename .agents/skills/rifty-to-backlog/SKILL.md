---
name: rifty-to-backlog
description: Capture a finding or idea into docs/backlog as a correctly classified draft. Use BEFORE creating or editing any backlog item — when an audit/review/post-merge finding needs recording, when work surfaces a gap worth deferring, or when the user asks to file something to the backlog.
---

Capture = classify → dedup → gate → mint. Cheap and mechanical — no grilling, no contract; that is `rifty-refine`'s job on the minted draft. The anti-pattern this skill exists to stop: an audit finding minted straight to an item with a `user_story` reverse-engineered afterward.

## 1. Classify
capability / test / tooling / design debt — backlog. Doc-drift or a pure record — not backlog: fix the doc. Can't name what breaks for a user or the project → it's a note, not an item; stop here.

## 2. Dedup
Sweep `docs/backlog/` (titles, `code:` paths, epic `items:`) for the same defect, mechanism, or boundary. Hit → update THAT item's Context/sources, do not mint a sibling. Done when the sweep is recorded: matched item updated, or no-match stated in the new item's `sources:`.

## 3. Gate (in order; first failure decides the shape)
- **Boundary** — a fault claim cites its row in `docs/process/fault-classes.md` §Boundary failure models. Physically excluded axis → the finding is void, do not mint (model wrong → fix that table first).
- **Reachability** (own-product surfaces) — no user-action repro path → mint draft with the attempted repro recorded; it cannot reach `ready` until one exists (`decision-workflow.md` §Backlog readiness).
- **Tier** — owning epic declares `tier:` and the finding demands more → park: draft naming the missing tier-raise ADR as its blocker, no ordinary refinement path (`docs/backlog/README.md` §Tier).
- **Mechanism** — finding proposes a coordination mechanism → run the sweep (`fault-classes.md` §Class-kill) and record the inventory in the draft.

## 4. Mint
`docs/backlog/<area>/<slug>.md`, frontmatter per `docs/backlog/README.md`, status `draft`, `## Context` = observed evidence (what, where, how found). `user_story` only from a real user path — omit it rather than invent one. Code-anchored → `// TODO(backlog: <area>/<slug>)` at the site. Done when `pnpm backlog:check` passes.
