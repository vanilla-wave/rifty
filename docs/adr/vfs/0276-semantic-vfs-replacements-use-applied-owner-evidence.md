# ADR 0276: Semantic VFS replacements use applied owner evidence

Status: Accepted
Date: 2026-07
Supersedes: ADR-0260

> TL;DR: one shared mutation guard carries semantic `replace` candidates; the
> owner publishes reset facts only for matching content writes that applied.

## Context

ADR-0260 introduced one closed path-intent vocabulary and one
`VfsMutationGuard` so supervised `fs.*`, Shell, and host package policy share a
single FIFO. Its six primitive kinds are sufficient for package classification
but cannot distinguish an ordinary write from a semantic replacement.

ADR-0275 added post-apply rename/remove/reset evidence. Terminal Git already
mutates the Workbench owner VFS, but its worktree operations currently advertise
only `write(repoRoot)`. Converting that broad preflight path directly to reset
would stale unrelated Documents for `git restore path`; leaving it ordinary
keeps the replaced Document live with old bytes. Snapshot comparison cannot
recover the command meaning or prove partial-apply order.

## Decision

`guardVfsMutations` retains ADR-0260's contract: one non-empty logical batch
and a result-preserving `apply()` continuation. A fulfilled guard calls `apply`
exactly once before settlement; empty batches, double/late apply, and
fulfillment without apply loud-throw. Rejection before apply is valid and
fences the mutation. Each producer parses/plans once and submits every affected
path as one batch and FIFO slot; command/RPC settlement awaits its result.
Adding an intent or producer updates the union, producer tests, and single host
classifier together.

`@riftydev/vfs` retains one closed `VfsMutationIntent` vocabulary and adds
`{ kind: 'replace'; path }`. `replace` is a candidate semantic scope: a matching
content write replaces prior file identity and must invalidate its open
Document. It is preflight metadata, never applied evidence and never an
unconditional `reset(path)` fact. Ordinary writes, redirects, `fs.writeFile`,
copy, mkdir, and utimes keep their primitive intents.

The owner authority gives its private journal exact successful content-write
endpoints from the same mutation seam that advances tree revision. While a
semantic scope is active, the journal buffers revisions and selects the most
specific covering intent for each applied endpoint. A `replace` winner emits a
reset for that exact endpoint; an ordinary winner emits none; equally specific
conflicting semantics reject as a producer error. Thus
`[write /repo/.git, replace /repo]` keeps metadata ordinary and a real write to
`/repo/src/a.ts` emits only `reset(/repo/src/a.ts)`. Rename/remove retain their
own exact facts. No matching applied write emits no reset; partial failure emits
only applied evidence before rethrow; claim-only revisions prove nothing.

`WorkbenchProjectVfs` owns the one composed mutation guard: admit the complete
batch to the package FIFO, enter the journal semantic scope, apply, finalize
evidence on success or partial failure, await project-state publication, then
settle the command/RPC reply. Shell and child `fs.*` use that same guard; the
child adapter adds only active-project admission and recheck. PTY exit retains
its catch-all publication barrier. Package classification treats `replace` like
a destructive path scope.

Git maps branch checkout/switch, hard reset, merge, and pull to ordinary `.git`
write plus a repo replacement candidate. Checkout-path and restore-worktree use
exact mapped pathspec candidates. Staged-only restore and soft/mixed/path reset
write metadata only. Git rm/mv retain rm/rename. Clone is ordinary creation.
Apply/revert/cherry-pick/stash reuse their prepared action paths; a supported
form with no stable narrow plan loud-throws instead of guessing a root reset.
The plan is revalidated inside the FIFO before execution.

A separately proven whole-root import/snapshot replacement may still use
ADR-0275's explicit root reset mode; it is never inferred from
`replace(repoRoot)`.

## Correction — 2026-07-15

The initial Git mapping's exact-preplan-or-loud-throw clause conflated a
replacement candidate with applied reset evidence. Exact candidates remain
mandatory when syntax and the existing planner already determine paths, such
as restore and checkout-path. For a shipped worktree writer whose lower-level
facade owns the action plan, `replace(repoRoot)` is an exact semantic upper
scope: the owner still emits resets only for applied content-write endpoints,
while ordinary `.git` writes win their more-specific scope. This preserves the
prior conservative package classification and must replace the old ordinary
`write(repoRoot)` intent; it does not authorize a root reset.

## Consequences

- Package trust, semantic replacement, applied evidence, and reply ordering
  share one batch and FIFO.
- Path-specific Git operations stale only Documents whose bytes were replaced;
  failed/no-op operations do not invent resets.
- Every classifier and mutation producer must handle the closed `replace` kind;
  Git planners must expose exact prepared actions rather than broad heuristics.
