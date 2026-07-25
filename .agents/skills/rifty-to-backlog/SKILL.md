---
name: rifty-to-backlog
description: Capture a new rifty finding or idea as a deduplicated, gated backlog draft. Invoke for first-time audit/review/post-merge intake or explicit filing; excludes existing-contract edits, refinement, and planned work.
---

Capture = classify → dedup → gate → `draft`. No interview or contract compilation.

## 1. Classify

Capability/test/tooling/design debt → backlog. Doc drift → fix the doc. No user
or project impact → stop. Under `Goal-Baseline`, required work reverse-links to
the epic; only outside-goal work enters ordinary backlog.

## 2. Dedup

Search titles, `code:`, `## Items`, and child `epic:` links for the same
defect/mechanism/boundary. Update a match; otherwise record the no-match source.

## 3. Gate

Use `docs/process/fault-classes.md` §§Boundary failure models/Class-kill and
`docs/backlog/README.md` §Tier. Apply in order:

1. Boundary model excludes the fault → void it; fix a wrong/missing model first.
2. Own-product finding lacks a user-action path → keep the attempted repro in draft.
3. Finding exceeds epic tier → block on a tier-raise ADR.
4. Proposed coordination mechanism → record the §Class-kill inventory.

## 4. Mint

Create `docs/backlog/<area>/<slug>.md` from `docs/backlog/README.md`: `draft`,
observed `## Context`, honest sources, optional real-path `user_story`, and a code
marker when anchored. Done when `pnpm backlog:check` passes.

After capture, ordinary workflow compiles settled drafts; only an unresolved
observable fork goes to manual `rifty-refine`.
