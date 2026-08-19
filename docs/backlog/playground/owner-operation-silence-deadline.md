---
area: playground
status: ready
title: Owner operation deadline — silence-based, configurable, recoverable in-tab
created: 2026-08-19
why: OWNER_OPERATION_TIMEOUT_MS is a hard 60s module constant measuring TOTAL duration, and blowing it calls failProtocol — a slow-but-alive first materialization kills the transport for good and the only host recovery is a full page reload (issue #255)
user_story: As an SDK embedder opening a project from a 98 MB baked snapshot (~42 s of owner flush on a warm laptop), I want slow-but-progressing opens to complete and a genuine wedge to fail recoverably, but today 60 s of wall clock — however alive the owner is — poisons every later send() with ClosedHandleError until the page reloads
sources: ["https://github.com/vanilla-wave/rifty/issues/255", "https://github.com/vanilla-wave/rifty/issues/256", docs/process/fault-classes.md]
code:
  - packages/workbench/src/workbench/workbench-browser-owner.ts
---

## Context

`request()` arms a fixed 60 s timer per operation
(`workbench-browser-owner.ts:106,384-393`); on fire it rejects the pending op
AND calls `failProtocol` → `rejectPending` + `worker.kill('SIGTERM')` + every
later `send()` throws `ClosedHandleError` (`:327-333,361-375`). Two defects,
one non-defect:

- defect 1 (`false-fallback`): the deadline ignores the progress signal that
  exists since #256 — owner-level `workbench:durability-progress` frames.
  Slow-but-alive (big tree, cold OPFS, battery) is indistinguishable from
  wedged, so an environmental condition becomes a protocol fatality.
- defect 2: after the fatality there is no in-tab recovery — the host cannot
  build a fresh workbench handle and reopen; observed remedy is page reload
  (issue #255), which also drops the runtime the user worked in.
- non-defect, keep: kill-on-genuine-timeout. Boundary model
  (`fault-classes.md` §Boundary failure models, MessagePort/Worker row): a
  local deadline never proves not-applied; only peer death settles an admitted
  mutation. Reject-without-kill would invite retry against an unsettled
  mutation — `torn-state`. The fix is progress-awareness + recovery, NOT
  removing the fatality.

Mechanics for the implementing agent:

- Deadline semantics: fire after N ms of durability-progress SILENCE, not N ms
  total. A `workbench:durability-progress` frame arrival resets the deadline of
  pending operations. Other traffic does NOT reset it (a chatty transport must
  not mask a wedged flush — `unbounded-read` bound stays).
- Budget knob: host-configurable via the public workbench options; default
  stays 60 s (of silence). Option name/shape + the semantics change = one ADR
  in the implementing PR (public API → IRREVERSIBLE).
- Recovery: after `failProtocol`, a fresh `openWorkbench` in the SAME tab
  reopens the same project successfully. Evidence this needs no new machinery:
  Web Locks auto-release on worker death
  (`internal/browser-workbench-composition.ts:25-29`), owner `close()` state
  machine tolerates closing/closed re-entry (`open-workbench.ts:478-499`),
  durable state re-derives from OPFS stamp/ledger. The RED test names whatever
  actually blocks; fixing that blocker is in-scope.
- Existing carrier: `workbench-browser-owner.test.ts` (browser-unit harness
  with fake owner) — extend, don't build a new one.
- `PROJECT_VFS_COMMIT_TIMEOUT_MS` (`:105`) untouched.

## User scenario

Issue #255 repro: host embeds `@riftydev/workbench@0.3.x`, opens a project
restored from a 98.2 MB / 14 492-file baked snapshot; owner-side open takes
~42 s (flush-dominated) on fast hardware, minutes on slow. Today at 60 s:
operation rejects, transport poisons, every later call throws
`ClosedHandleError`, page reload required (host ships a pnpm patch raising the
constant to 300 s as insurance). Expected: open completes regardless of wall
clock while flush progress flows; a genuinely wedged owner fails within the
budget of silence; the host then constructs a fresh workbench handle in the
same tab and reopen succeeds.

## Acceptance

- An operation whose durability-progress frames keep arriving never times out,
  for wall clock ≫ budget (fake-timer browser-unit proof).
- Progress silence ≥ budget → pending op rejects with the timeout error AND the
  owner worker is killed (death settles) — same observable fatality as today.
- Host-supplied budget respected; unset → 60 000 ms of silence; the arriving
  progress frame re-arms the CONFIGURED budget, and re-arms every pending
  operation (they share one owner and one flush), not just the newest.
- A non-positive or non-finite budget is refused at the public options boundary
  before any lock, service-worker, storage, or owner effect — same authority
  and same message shape as `previewProbeTimeoutMs` (one validator, no twin;
  the Playground options surface delegates to it).
- After a silence-timeout (and after any `failProtocol`), a fresh
  `openWorkbench` + `openProject` of the same project in the same tab succeeds
  with the durable tree intact (fault test, real OPFS in browser-unit).
- The pnpm patch raising the constant becomes unnecessary: the shipped default
  handles the 42 s first-open without host configuration.
- A fake that asserts timer bookkeeping without driving the real
  `createBrowserOwner` request path cannot close this.
- No deadline proof may rest on a scheduling race or on a runner timeout: an
  operation that should stay pending is asserted pending by a bounded
  observation, and injected silence is a delay far larger than the budget.
- The option is proven on the PUBLIC types, uncast: the acceptance literals
  typecheck as `WorkbenchOptions` and `PlaygroundWorkbenchOptions`, so a
  runtime-only knob absent from the SDK surface fails to compile.
- Kill state is sampled INSIDE each rejection observation, so reject-now /
  kill-later cannot pass the observable-order row.

## Parity cases

No external oracle — own-product transport policy. RED targets, each
failing-first on the browser-unit harness:

1. Progress-reset: open with flush frames every 5 s for 3× budget → completes.
2. Silence fires: frames stop mid-flush → reject at budget-of-silence, worker
   killed, `ClosedHandleError` on later send names the timeout cause.
3. Non-progress traffic does not reset: health/heartbeat-unrelated frames flow
   while progress is silent → still fires at budget.
4. Knob: budget 5 s honored; default 60 s when unset.
4b. Progress under a CONFIGURED 5 s budget re-arms 5 s, never the shipped
   60 000 ms; the deadline fires exactly one budget after the LAST frame.
4c. Sibling sweep over the timer owner: ONE progress frame, delivered just
   under expiry, re-arms EVERY `PendingOperation` variant (`open`, `delete`,
   `playground-open`, `playground-catalog`, `close`). Proof shape is
   discriminating, not a stream: pending is asserted PAST the original deadline
   (a timer the frame missed dies exactly there, so partial or round-robin
   re-arm fails), and expiry lands one configured budget after that frame to
   the millisecond.
5. Recovery: after case 2, fresh `openWorkbench` in the same realm reopens the
   project; durable tree readable; no residual Web Lock / claim blocks it.
   Silence is injected deterministically, never raced: one admitted owner
   request is DELAYED (the MessagePort/Worker row's "slow peer" — never
   dropped, duplicated, or reordered) an order of magnitude past the budget, so
   the owner provably cannot answer or emit progress inside it, and the failure
   must land at the budget rather than at the delay.
6. In-flight ops at failure all reject with the protocol failure (no hang) —
   pinned unchanged from today.
7. Budget validation: `0`, a negative value, `Infinity`, `NaN`, and a
   non-number are refused naming `deployment.ownerOperationSilenceTimeoutMs`,
   before lock/SW/storage/owner effects, on both the plain and the
   Playground-shaped options surface.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| false-fallback | environmental slowness WITH progress completes; never protocol death | cases 1, 4b, 4c |
| unbounded-read | silence deadline is a real bound; chatty-but-wedged cannot hang forever | cases 2–3 |
| corrupt-input | a host budget that is not a positive finite number is refused at the one options validator before any external effect — never a silently ignored, zero, or infinite deadline | case 7 |
| torn-state | timeout never invites retry against an unsettled mutation: fatality + fresh-handle reopen reconciles from durable OPFS state only | cases 2, 5 |
| provenance-lie | post-failure `ClosedHandleError` carries the original timeout cause; recovery does not mask it | cases 2, 5 |
| observable-order | pending rejections happen with kill initiated, not before deciding fatality | case 6 |

## Out of scope

- Per-operation-kind budgets, read-only-op reject-without-kill classification —
  uniform policy stays (§Simplicity; progress-awareness removes the false
  positives that motivated them).
- Automatic owner respawn / session-state restoration after fatality — host
  decides; `playground/owner-respawn-switch-latency` owns respawn UX.
- Progress emission coverage for further operation kinds beyond what #256
  ships — an op without progress frames keeps a plain fixed budget of silence
  (= today's behavior, now configurable).
- `PROJECT_VFS_COMMIT_TIMEOUT_MS` and kernel/child timeouts.

## Decisions

- Silence-based deadline + kept fatality + in-tab recovery chosen over
  reject-without-kill (issue #255's literal suggestion): boundary model rules a
  local deadline can't prove not-applied; user ratified this direction in
  conversation 2026-08-18 («настоящий no-progress → kill (смерть settles) +
  возможность пересоздать owner»).
- Only durability-progress frames reset the deadline — any-traffic reset would
  reopen `unbounded-read`.
- Public option + semantics change documented in one ADR with the implementing
  PR; this item pins the observable contract, the ADR owns naming/shape.
- No new coordination mechanism: deadline policy + existing close/Web-Lock
  lifecycle; class-kill inventory clean (no correlation/FIFO/epoch/ledger/lock
  added).
