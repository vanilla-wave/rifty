---
area: distribution
status: ready
title: A sandbox `exec` (and a queued host op) is cancelled by an `AbortSignal` without destroying the sandbox
created: 2026-11-24
why: A user stopping a turn, or the turn's own deadline ending before the run's `timeoutMs`, can only `destroy()` the sandbox today — losing the turn's files; `signal` is an unknown option (`ERR_INVALID_ARG_VALUE`, sandbox.ts:198-207).
user_story: As a Node service running an agent turn over a sandbox, I want to cancel the run in flight with the turn's `AbortSignal` and keep using the sandbox, but today the only way to stop a run is `destroy()`, which drops every file of the turn.
sources: [/Users/vanilla-wave/ai/rifty-requirements/2026-11-24-server-sandbox-requirements.md §5, ADR-0568, docs/ROADMAP.md M14]
code: [packages/isolate-host/src/sandbox.ts, packages/isolate-host/src/pool.ts]
---

## Context

Requirements §5 (consumer, 2026-11-24). The pool already cancels a call: `handle.abort(error)` →
`#cancel` → the worker's `cancel` frame disposes the isolate as at a deadline (`pool.ts:481`,
`:587-591`); `destroy()` uses it (ADR-0568 §5). No option exposes it per call. Independent of the
template goal: the same handle serves either state model; the post-abort state follows whatever
rule a killed run has (today rollback, ADR-0568 §3; the template goal's open question on killed-run
writes may change both together — `epics/isolate-host-sandbox-template/map.md`).

## Challenge

challenge: 2026-11-24 — clear (existing-baseline extension of an internal mechanism; no premise critic, README §Challenge; final written-result check with the refine set)

## User scenario

1. The service creates a sandbox, writes `main.js` with an endless loop, and calls
   `exec('main.js', { signal })` with the turn's `AbortController.signal`; 200 ms later the user
   stops the turn: `controller.abort(reason)`.
2. The `exec` promise rejects at once with Node's `AbortError` (`code: 'ABORT_ERR'`, `cause` = the
   reason); the run's isolate stops; the sandbox's files are those of before the run.
3. The model fixes `main.js`; the next `exec` (no signal) runs and exits 0.
4. An `exec` queued behind that run with the same signal never starts; one called with an
   already-aborted signal rejects without running.

## Acceptance

1. `exec(path, { signal })` accepts an `AbortSignal`; any other value → `ERR_INVALID_ARG_TYPE`;
   `signal` is no longer an unknown option. → scenario
2. Already aborted at the call → rejects `AbortError` with no pool call placed (no worker spawned,
   no isolate). → scenario
3. Aborted while queued → the operation rejects at the abort and never takes effect; later
   operations keep their order (ADR-0568 §4). → scenario
4. Aborted in flight (restore, run or capture) → rejects at the abort; the isolate is disposed as at
   a deadline (the call's `gone` event as for `destroy`); the state is the rule of a killed run;
   the sandbox stays usable: the next `exec` runs. → scenario
5. Aborted after the result settled → no effect. → scenario
6. Host ops (`writeFile`, `readFile`, `list`, `remove`, `snapshot`) take an optional `{ signal }`:
   aborted at the call or while queued → `AbortError`, no effect; once started they complete (they
   are synchronous in the consumer). → scenario
7. `destroy()`'s guarantees (ADR-0568 §5, I5) are unchanged: an abort and a destroy in any order
   end with every operation settled once (`DESTROYED` wins for an operation not yet settled when
   `destroy()` is called) and no isolate of the sandbox running. → ADR-0568
8. A table "outcome × abort moment" (before call, queued, restore, run, capture, 0–3 microtasks
   after the result, after await) × (exit, timeout, memory, refused state, lost worker) asserts what
   the caller got and the files after, observed on the workers' CPU, as
   `tests/sandbox-destroy-table.test.ts`. → scenario
9. README: the option, the error, the state after an abort; compat row. → scenario

## Reference contract

- Oracle: Node v24.16.0 `AbortError` of a cancelled async API (`fs.promises.readFile(p, { signal })`,
  `child_process.execFile(file, args, { signal }, cb)`): `name: 'AbortError'`, `code: 'ABORT_ERR'`,
  `message: 'The operation was aborted'`, `cause`: `signal.reason` (an `AbortError` "This operation
  was aborted" for `abort()` without a reason). Measured 2026-11-24, macOS arm64.

## Parity cases

1. `abort(new Error('turn over'))` → rejection `{name, code, message}` as the oracle, `cause` the same
   object; `abort()` (in flight) → `cause` a `DOMException`-named `AbortError` as Node gives. → scenario
2. Pre-aborted signal → the oracle's shape, decided before any pool call (no run output). → scenario
3. A value that is not a signal → Node's refusal (`fs.promises.readFile`'s `ERR_INVALID_ARG_TYPE`;
   `execFile`'s `TypeError` for a signal-shaped object without `addEventListener`); a consumer's
   `abort` listener calling `stopImmediatePropagation()` does not stop the cancel (`execFile` on the
   same signal is cancelled too). → scenario

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| abort × worker lost during the run (rerun pending) | rejects `AbortError`; the rerun is not placed | abort-table row "its worker lost, the rerun not yet placed: the rerun is never placed" | → scenario |
| abort × isolate ignoring termination | rejects at once; the worker retires after the stuck grace (ADR-0563 §4); `destroy()` waits for `gone` | abort-table row "during the run of a builtin that ignores termination" | → ADR-0568 |
| abort racing the result (same microtask) | exactly one settlement: the result if it settled first, else `AbortError`; state per the outcome reported | table rows 0–3 microtasks | → scenario |
| abort × destroy | every operation settles once; `DESTROYED` for those unsettled when `destroy()` is called | abort-table rows "abort, then destroy", "destroy, then abort" | → ADR-0568 |
| a signal whose `reason` getter / `addEventListener` throws (consumer bug) | refused at the call with the consumer's own error (as Node's `fs.promises.readFile`), nothing placed | unit "a signal whose own members throw (a consumer bug) …" | → scenario |

## Out of scope

- An `AbortSignal` option of `runCode` (ROADMAP M14 "Also"): no consumer asked; separate item if
  one does.
- Keeping a cancelled run's writes: the killed-run rule, decided in the template goal.

## Decisions

- 2026-11-24 — agent: Node's `AbortError` shape (oracle above), not a rifty code — the consumer's
  abort handling is Node's.
- 2026-11-24 — agent: the state after an abort is the killed-run rule (requirements §5 «как у
  `timeout`»), one rule for both.
- 2026-11-24 — agent (implementation, cross-review round 1): the signal is checked and subscribed
  by Node's own `events.addAbortListener` — one rule, Node's (`'aborted' in signal`, its
  `ERR_INVALID_ARG_TYPE` worded for `options.signal` as `fs.promises.readFile` words it), and a
  listener another listener's `stopImmediatePropagation()` cannot skip. Acceptance 1's "any other
  value" reads as "any value Node refuses".
- 2026-11-24 — agent (implementation): fault row "a member throws" — the consumer's error itself
  is the refusal, at the call, nothing placed (Node's `fs.promises.readFile` rejects with a throwing
  `reason` getter's error, probe 2026-11-24); not wrapped in `ERR_INVALID_ARG_TYPE`. Like every
  error leaving the API, its `stack` is cut to its first line.
- 2026-11-24 — agent (implementation): a run's end state is applied in the microtask that settles
  the caller's promise (the abort races the result there), so an `AbortError` always leaves the
  files of before; `exec`'s options are checked at the call (a refusal still rejects in its turn).
