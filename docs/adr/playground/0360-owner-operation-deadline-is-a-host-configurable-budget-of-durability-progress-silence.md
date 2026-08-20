# ADR 0360: Owner operation deadline is a host-configurable budget of durability-progress silence

Status: Accepted
Date: 2026-08

> TL;DR: the per-operation owner deadline stops measuring TOTAL duration and
> measures SILENCE of `workbench:durability-progress` (ADR-0359) instead — an
> arriving frame re-arms every pending operation; the budget becomes public
> option `deployment.ownerOperationSilenceTimeoutMs`, default 60 000 ms of
> silence. Silence still kills the owner: only peer death settles an admitted
> mutation.

## Context

`OWNER_OPERATION_TIMEOUT_MS` was a 60 s module constant measuring an
operation's total duration, and blowing it called `failProtocol` — kill +
`ClosedHandleError` on every later `send()` (#255). Two consequences, both
observed by an SDK embedder:

- A first `openProject` restoring a 98.2 MB / 14 492-file baked snapshot spends
  ~42 s in the OPFS flush on a warm laptop, minutes on slow hardware. The
  budget is not a wedge detector there — it is a race against the machine, and
  losing it is a protocol fatality for an environmental condition
  (`false-fallback`).
- No knob existed: the host shipped a pnpm patch on the published dist raising
  the constant to 300 000.

Since ADR-0359 the flush is no longer mute: the drain owner emits REAL
`{persisted, total}` counts on the owner-level `workbench:durability-progress`
message, coalesced to at most one per 200 ms plus first and terminal. Arrival
IS the heartbeat, so slow-but-alive is now distinguishable from wedged, which
the deadline previously could not do.

## Decision

- **Semantics.** The per-operation deadline fires after N ms with NO
  `workbench:durability-progress` frame, not N ms after the request was sent.
  Every arriving progress frame re-arms the deadline of ALL pending operations
  (they share one owner and one flush). An operation whose progress keeps
  flowing therefore completes at any wall clock.
- **Only progress resets it.** No other owner→page traffic (pty, preview, vfs,
  catalog, session tools) touches the deadline. Any-traffic reset would let a
  chatty transport mask a wedged flush forever and would reopen
  `unbounded-read`; the bound must be on the thing that proves durable
  progress.
- **Budget.** Public option `deployment.ownerOperationSilenceTimeoutMs` on
  `WorkbenchOptions` (thus on `PlaygroundWorkbenchOptions`), validated as a
  positive finite number, defaulting to `60_000`. Name says silence because the
  semantics are silence — a host reading `ownerOperationTimeoutMs` would
  reasonably expect total duration and mis-budget it. Page-side policy only: it
  never enters the owner boot config, so the owner protocol is unchanged.
- **Fatality stays.** Genuine silence rejects the pending operation AND kills
  the owner. `fault-classes.md` §Boundary failure models, MessagePort/dedicated
  Worker row: a local deadline never proves not-applied, so only peer death
  settles an admitted mutation. Reject-without-kill (issue #255's literal
  suggestion) would invite retry against an unsettled mutation — `torn-state`.
  Progress-awareness removes the false positives that motivated it.
- **Recovery is in-tab.** After the fatality the host constructs a fresh
  Workbench in the SAME tab; the durable tree re-derives from OPFS. No page
  reload, no automatic respawn (host decides; `owner-respawn-switch-latency`
  owns respawn UX).
- **Uniform policy.** One budget for every operation kind; no per-kind budgets
  and no read-only reject-without-kill classification (§Simplicity).
  `PROJECT_VFS_COMMIT_TIMEOUT_MS` and kernel/child timeouts are untouched.

## Consequences

- The shipped default handles #255's 42 s first open with no host
  configuration; the pnpm patch on dist becomes unnecessary.
- An operation kind that emits no progress frames keeps a plain fixed budget of
  silence — exactly today's behavior, now configurable.
- A wedged owner still dies within one budget of silence, so the
  `unbounded-read` bound is real; a chatty-but-wedged transport cannot extend
  it.
- `WorkbenchOptions.deployment` gains one optional field: additive, no
  migration for existing embedders, and the meaning of the existing 60 s
  changes from duration to silence (loud in the timeout message, which now
  reads `… timed out after Nms without owner durability progress`).
- Re-arming touches every pending operation on each progress frame — O(pending)
  per coalesced frame, and pending operations at one owner are a handful.
