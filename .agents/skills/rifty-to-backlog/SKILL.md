---
name: rifty-to-backlog
description: Formalize a rifty finding or idea into a deduplicated, gated backlog draft. Direct invocation = mid-task/agent intake (audit/review/post-merge discoveries, no user in session); user-brought input enters via rifty-refine, which runs this formalization as its final step.
---

Capture = verify relevance → dedup → record a fact/question that must wait.
Never invent work from a review suggestion. `REV-12` routes verified facts
by the accepted result, regardless of the discovering actor or stage.

## 1. Classify

Required by authorized work → repair in that work; update obligations if needed.
Useful outside its result → capture when deferred, naming owner/trigger.
Advice without an obligation → note, no automatic item. A user scope choice
is asked in-session; no second hand-off for work already authorized. Facts
need evidence; uncertain claims remain questions.

## 2. Dedup

Search titles, `code:`, goal `map.md` files, child `epic:` links and
`docs/process/traps.md` for the same defect/mechanism/boundary/lesson — and
`docs/adr/README.md` §Declined concepts for the same idea already ruled out. Update a match; a declined match stops the
capture (cite the row); otherwise record the no-match source.

## 3. Gate

Use `docs/process/rules/fault-classes.md` §§Boundary failure models/Class-kill and
`docs/backlog/README.md` §Tier. Apply in order:

1. Boundary model excludes the fault → void it; fix a wrong/missing model first.
2. Own-product finding lacks a user-action path → keep the attempted repro in draft.
3. Finding exceeds epic tier → block on a tier-raise ADR.
4. Proposed coordination mechanism → record the §Class-kill inventory.
5. Claimed oracle/Node behavior without a reproducible artifact (command +
   output + version) → record as an open fork, never as fact; model memory is
   not evidence, a prescribed carrier with no spike/ADR fact = frozen
   assumption.

## 4. Mint

Create `docs/backlog/<area>/<slug>.md` from `docs/backlog/README.md` — committed
to the discovering unit's branch; with no unit branch to ride (a post-merge
audit) it is its own docs-only PR (`docs/process/rules/pr.md` `PR-2`). A draft is
one of two shapes (README §Shape): **question** (`## Question`, no prescribed
carrier) or **finding** (observed `## Context`, honest sources, compat ❌ /
code-marker link) — never a solution without its decision. Optional real-path
`user_story`. Done when `pnpm backlog:check` passes.

## 5. Adoption and report

A factual capture needs no independent critic. A proposed direction follows
`docs/backlog/README.md` §Challenge: early when it informs the user's choice,
otherwise at FIT/PICKUP. Preserve any early record for reuse; formalizing the
same premise does not require another critic.

The driver delivers user-facing work with `docs/backlog/README.md` §Report,
before implementation. A mid-task capture needs only its durable record.
Continue work already authorized; capture is not a manual relay station.
