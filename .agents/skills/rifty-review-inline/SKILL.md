---
name: rifty-review-inline
description: User-driven inline review of a PR or branch along the rifty-review axes. Not a checkpoint - no verdict.json, no merge authority. Invoke only on explicit user request.
argument-hint: "[PR number | base ref]  (default: origin/main)"
disable-model-invocation: true
---

Review here, in this context. No subagent, no `codex exec`, no `verdict.json`,
no `tools/review/blockers.mjs`. A look at work, not a checkpoint.

## Input

- PR number → `gh pr view <n> --json body,headRefName,baseRefName`; diff the
  branch against `origin/<baseRefName>`.
- base ref → current branch against it.
- empty → `origin/main`.

Uncommitted changes are part of the review, not a reason to stop.
Read the full diff and every changed test. Judge evidence, never the
implementer's summary.

## The claim

Three axes (Completeness, Goal drift, Scope) compare the diff to what the
work says it delivers. That is the claim. Take the first that exists:

1. what the user names on invocation — a backlog item, a `goal.md`, or a
   sentence;
2. the PR body;
3. commit messages on the branch.

Nothing usable → say so, judge the other five axes, and ask the user what the
change was meant to do.

## Axes, once, in order

1. **Completeness** — everything the claim promises is delivered; nothing
   deferred.
2. **Mission and architecture** — fits rifty's mission and layer boundaries.
3. **Goal drift** — delivery matches the claim; scope changes explicit, not
   silent.
4. **Approach cost** — machinery the claim is deliverable without → blocker;
   plain shrinkage → note.
5. **Scope** — every changed file justified by the claim.
6. **Bugs** — correctness defects; say whether a test pins each.
7. **Regressions** — existing behavior holds.
8. **Ecosystem UX** — observable behavior matches real Node.

Every finding cites `file:line` from the diff; no citation, no finding.
Blocker = breaks the claim or correctness. Concern = everything else.

## Take

After the axes: what you think of this set of changes as a whole. First
person, opinions allowed, no citations required. Direction; what feels off
or surprisingly good; what you would have done differently; what worries you
that no axis caught; questions you would ask the author. Do not repeat axis
findings. Five to fifteen lines.

## Output

- verdict (`pass` / `concern` / `blocker`) + one-line merge call;
- **What** — 3–7 numbered lines (`W1…`) one level above the diff: the
  outcomes the change delivers for a user, embedder or the system; no files,
  no mechanisms;
- big diff → 5–10 line map of the change by area, each area tied to its
  outcome (`→ W2`);
- eight axes in order, each: verdict + findings, grouped by outcome when
  large; a finding names what holds or breaks for the outcome before how;
- **Open** — one list of what the claim still leaves uncovered, by outcome;
- **Take** — the informal section above.
