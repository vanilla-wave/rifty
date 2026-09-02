---
name: rifty-to-backlog
description: Formalize a rifty finding or idea into a deduplicated, gated backlog draft. Direct invocation = mid-task/agent intake only (audit/review/post-merge discoveries, no user in session); user-brought input enters via rifty-refine, which runs this formalization as its final step. Excludes existing-contract edits and planned work.
---

Capture = classify → dedup → gate → `draft` → challenge → report. Never an
interview or contract compilation: mid-task an observable fork is recorded in
the draft + manual `rifty-refine` requested; invoked as the `rifty-refine`
formalize tail, forks arrive already settled and mint with their evidence.

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

Canon for EVERY backlog write-up report (capture here, FIT via
`docs/process/stages/fit.md` step 8). A FRESH subagent with clean context writes it from
the recorded docs alone (no author framing — same independence as README
§Challenge: a report the docs cannot support proves the write-up incomplete;
fix the docs, never pad the report). Relay it in the conversation. User's
language, ONE screen, no file paths beyond required item ids, no process
internals; fixed form:

1. Plan — 2-4 plain sentences: what the user gets and why now, tied to user
   experience and project direction (mission/milestone). Never mechanics.
2. What changes — experience-level: what starts working, what will loudly
   degrade (warn) or throw. Never file lists.
3. Steps — name the epic once (`epics/<slug>`), then ordered slices, ONE line
   each: the item id (`area/slug`) + what it is in plain words, ending with
   the observable result once that slice lands ("after this: X works").
4. Risks — ONLY challenge problems that could change the user's decision to
   proceed, translated into plain risk statements ("if this is acceptable,
   nothing to do"); problems already fixed in the docs are omitted, verbatim
   text stays in the doc's `## Challenge`. Each entry opens with its origin —
   why it exists despite refinement ("critic finding — axis your interview
   never covered", "probe result", …).
5. Open questions for you — ONLY genuinely undecided points: origin (who found
   it and why it is NOT re-opening something you decided — e.g. "critic found
   a middle option between your two decided poles") + when it fires + the
   exact question + the default if you stay silent. Already-decided
   checks/probes are NOT questions — they ride their Step, with a conditional
   spelled out there ("if the probe shows X, we return with question Y").
   None → say so in one line.
6. How to start — one line: the exact hand-off that begins the work (ready
   goal: "goal-run epics/<slug>"; single item: the pickup ask). Nothing
   starts without it.

A report, not an approval ask.

After capture: `docs/process/rules/readiness.md` owns draft→ready;
verification = the unit's Contract+RED checkpoint at pickup (an unresolved
observable fork = request manual `rifty-refine`, don't self-run the interview).
