---
name: rifty-to-backlog
description: Capture a new rifty finding or idea as a deduplicated, gated backlog draft. Invoke for first-time audit/review/post-merge intake or explicit filing; excludes existing-contract edits, refinement, and planned work.
---

Capture = classify → dedup → gate → `draft` → challenge → report. No interview or contract compilation.

## 1. Classify

Capability/test/tooling/design debt → backlog. Doc drift → fix the doc. No user
or project impact → stop. Inside an active goal run, required work
reverse-links to the goal; only outside-goal work enters ordinary backlog.

## 2. Dedup

Search titles, `code:`, goal `map.md` files, and child `epic:` links for the
same defect/mechanism/boundary — and `docs/adr/README.md` §Declined concepts
for the same idea already ruled out. Update a match; a declined match stops the
capture (cite the row); otherwise record the no-match source.

## 3. Gate

Use `docs/process/fault-classes.md` §§Boundary failure models/Class-kill and
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
to the discovering unit's branch, never its own PR (`AGENTS.md` §PR). A draft is
one of two shapes (README §Shape): **question** (`## Question`, no prescribed
carrier) or **finding** (observed `## Context`, honest sources, compat ❌ /
code-marker link) — never a solution without its decision. Optional real-path
`user_story`. Done when `pnpm backlog:check` passes.

## 5. Challenge

One fresh read-only critic per minted doc (`docs/backlog/README.md`
§Challenge): raw file only — no author framing; it attacks the premise, sizes
the impact claim against the whole, and names problems — especially user
experience and project direction. Verdict verbatim into `## Challenge`.
Advisory — problems never block the capture; they ride verbatim in the
capturing PR body.

## 6. Report

End with the user-facing completion report (`docs/backlog/README.md` §Report):
what was recorded (files, shape, key decisions), challenge problems verbatim,
and what happens next (who picks it up, what a fix/run would change). A report,
not an approval ask.

After capture: `decision-workflow.md` §Backlog readiness owns draft→ready;
verification = the unit's Contract+RED checkpoint at pickup (an unresolved
observable fork = request manual `rifty-refine`, don't self-run the interview).
