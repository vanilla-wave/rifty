---
name: rifty-fix
description: Use when fixing any bug, review finding, failing test, flake, or regression in rifty — before writing the fix. Especially when the fix looks like a three-line patch, the reviewer already suggested a fix inline, review is on round 2+, or a previous fix didn't stick.
---

# rifty-fix

Root cause → class → RED test → fix → prove. A point fix that leaves the class alive guarantees the next review round: in PR #107 one axis (`unbounded-read`) survived R5→R17 as four sibling point-fix helpers before a chokepoint killed it.

**Iron law: no code before (1) root cause, (2) class sweep, (3) failing test.** A reviewer-suggested fix gets the same treatment — the reviewer names an instance and guesses a mechanism; you own both. (#107 ledger case: suggested "clear on rm" = clears on in-memory rm; correct = clear on PERSISTED rm, else the ledger lies.)

## Steps

1. **Root cause.** Read the whole error/finding. Reproduce deterministically. Trace to where the bad value is BORN, not where it crashed. Multi-layer path (page→owner→worker→OPFS, client→server→store) → instrument each boundary, run once, let evidence pick the layer — no fixes from guessing.
2. **Class, not instance — bounded by the boundary.** Name the axis — `docs/process/fault-classes.md`; new axis → add its row first. Sweep ALL siblings: grep the failing pattern repo-wide AND enumerate the sibling operations of the failing one (rm ↔ rename/mkdir/write-through; GET ↔ POST/HEAD; sync ↔ async twin; boot ↔ reload ↔ switch). Then bound by reachability — AFTER the full sweep, never to shrink it: the boundary = where step 1 traced the value's BIRTH (a multi-layer path crosses several boundaries; citing a friendlier row than the birth one is boundary-shopping). Cite the row in `fault-classes.md` §Boundary failure models and strike siblings the model physically excludes; every strike/void is LISTED in the PR with its row — a voided finding leaves a trace, never disappears. Surviving axes still need fault tests (death/epoch rows are usually the hard ones). A guard no real input can trigger is dead code + a false test target; finding claims an excluded axis → void (same as capture's Boundary gate); model wrong → fix THAT table first. Second REACHABLE instance of the axis at this boundary → structural kill: ONE chokepoint API / ONE validation boundary / a gate. Never twin helper #4. Check the KILL HEIGHT: if your "structural" fix is the 3rd+ coordination mechanism around the same file/key, it's a point fix wearing a class costume — the class is "this invariant has no owner" (fault-classes §Class-kill design-stop; PR #131 grew 7 mechanisms before naming the authority).
3. **RED first.** Failing parity/regression/fault test before the fix. Fault findings assert the honest outcome (fallback / degraded / loud throw — never a silent lie). Never edit a test to make code pass; an existing test contradicting the fix = the CONTRACT changed — renegotiate it explicitly in the PR, don't re-aim the assert quietly.
4. **Fix once.** One change, no drive-by refactors. Prefer melting twin helpers into the chokepoint over adding another wrapper.
5. **Prove.** RED→GREEN. Revert-check EVERY new guard: revert the fix, the test must fail (false guards are the norm — one rifty feature shipped ~8 of them; beware caches masking the revert). Fast gate on touched code. Verify the COMMITTED tree, not the worktree (a batched `git add` drops files silently).
6. **Bounded pragmatism — loudly.** Structural kill genuinely too big now → bound-fix every instance the sweep found NOW with the existing mechanism, file the backlog item for the kill, and say so in the PR. Silent partial fix = defect; recorded partial fix = process.

## Escalation

- 3 failed attempts on one bug → the frame is wrong, not the code: stop, `docs/process/decision-workflow.md` (backlog/ADR), no attempt #4.
- Final+GREEN still has blockers → follow `docs/process/fault-classes.md` §Review convergence: redesign or split; never start a third point-fix review.

## Red flags

| Thought | Reality |
|---|---|
| «фикс на три строчки, как предложил ревьюер» | An instance + a guess. Root cause + class are still yours. |
| "that's a different bug" | Same axis at the same boundary = same class. Sweep first. |
| "while we're here, guard the duplicate/replay/reorder case too" | Boundary can't physically produce it → dead code + a guard whose RED test needs a mock of our own transport. Cite the boundary row; strike it. |
| "that axis is excluded" (no row cited, or row ≠ step-1 birth boundary) | Over-strike is the same lie mirrored: unswept siblings survive. Full sweep first; strike only on the birth boundary's row, listed in the PR. |
| "I'll add the test after it works" | Test-after proves nothing. RED first or the guard is decorative. |
| "CI green = done" | Green ≠ class closed. Where are the siblings? |
| "I'll consolidate later" (silently) | Silent later = never. Loud later = backlog item + PR note. |
| "the reviewer is nitpicking" | #107's 19 rounds were real bugs. |
| "each round's findings are NEW, so we're progressing" | New findings every round on the same state = your fixes are growing the surface. Design-stop, not round N+1. |

Claude also has `superpowers:systematic-debugging` (four-phase background); this file is self-contained for tools without it (codex).
