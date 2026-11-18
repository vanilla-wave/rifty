---
area: distribution
status: draft
title: Isolate host pool acceptance carrier — shared warm workers, neighbour-safe limits and reruns as executable tests
created: 2026-11-18
why: First unit of goal isolate-host-worker-pool; the scenario must be executable and RED before the pool exists.
epic: isolate-host-worker-pool
blocked_by: []
sources: [docs/backlog/epics/isolate-host-worker-pool/goal.md, docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md, docs/backlog/distribution/reference/isolate-host-pool-step0.md]
code: [packages/isolate-host/tests]
---

## Context

Goal scenario steps 1–5 as tests in `packages/isolate-host/tests/` (vitest
project `isolate-host`, global setup = the real package build). Every pool
scenario runs in its own consumer process (`node --input-type=module -e`
importing the built `dist/index.js`), so worker counts and kills are
deterministic and no test depends on another's warm workers. Real
isolated-vm, real workers, real guest bundle; hostile-worker cases replace
`dist/child.js` in a package copy with a real Node process (as
`protocol.test.ts`). Step 6 (I9) is `scripts/measure.mjs` + README, read at
CLOSE.

## Challenge

challenge: 2026-11-18 — inherits the goal premise check (`goal.md` §Challenge)

## Acceptance

1. A warm worker outlives its call: after `runCode('1')` the consumer has one
   child; 5 more sequential calls leave the same single pid (`pool.test.ts`)
   → I1
2. Cold consumer: 4 concurrent calls peak at 1 child, 5 and 8 at 2; every
   result exact (`pool.test.ts`) → I1
3. 4 concurrent calls on one worker each write `f`, a global, a timer and
   200 tagged lines: each sees only its own state and its stdout holds only
   its tag; a call that `exit(0)`s with a pending timer and an unsettled
   promise leaves nothing that prints into, or is visible from, the next call
   on the same pid (`pool.test.ts`) → I2
4. A consumer that called `runCode` and then idles exits on its own < 5 s
   with a worker present before exit; the worker is gone < 3 s after; a
   consumer SIGKILLed with an idle worker leaves none (`pool.test.ts`) → I6
5. 3 neighbours (`a<i>` now, `b<i>` at 3 s) + `new Array(2**28).fill(0)`
   at `memoryLimitMb: 64` on one worker: culprit `{stdout: 'big\n', stderr:
   '', exitCode: null, termination: 'memory'}`; each neighbour exactly
   `a<i>\nb<i>\n`, exit 0; a heap-growth culprit likewise; next call works
   (`pool-faults.test.ts`) → I3
6. Same neighbours + a culprit past `timeoutMs` 1500: busy loop,
   `Atomics.wait` forever, a default-comparator `sort` of 3e6 doubles in a
   loop: culprit `timeout` with its prior output, settled ≤ 1500 + 1000 ms
   after its call; neighbours, at `timeoutMs` 4000, exact — a neighbour
   rerun after the worker's loss could not finish inside 4000 ms, so this
   discriminates "finish on the retiring worker" (`pool-faults.test.ts`) → I4
7. Same neighbours + an output flood past a 1 KiB cap, 20000 ×
   `setInterval(f, 1)`: culprit `exitCode: null` with a `termination`;
   neighbours exact (`pool-faults.test.ts`) → I2
8. One call (`x` now, `y` at 3 s) whose worker is SIGKILLed once resolves
   exactly `x\ny\n`, exit 0, on a new pid; SIGKILLed again on that pid it
   rejects `code: 'ERR_ISOLATE_HOST_WORKER_LOST'`, message `isolate-host …
   exited unexpectedly (… SIGKILL)` < 1000 ms after the kill; two calls sharing
   a worker killed once both resolve exactly; a call (`timeoutMs` 4000, `y` at
   3 s) whose worker dies at 1.5 s is rerun (a new pid appears) and rejects
   with that code at its deadline, never `timeout`; a fresh call started
   after a loss survives the kill of the reruns' worker, which rejects only
   the rerun call (`pool-faults.test.ts`) → I5
9. Hostile worker (real process, call-addressed wire below): a frame for a
   call id not in flight on that worker — an unknown id, ids of calls on the
   other worker, a call already settled — rejects that worker's in-flight
   calls with `isolate-host child protocol violation`; calls on the honest
   path resolve with only their own bytes (`pool-protocol.test.ts`) → I7
10. Changed A criteria (PR-4, user decision): "no child process outlives its
    result" (`isolation.test.ts`, `bridge.test.ts`, `limits.test.ts`
    afterEach `childPids() == []`) is replaced by rows 1 and 4; "a child killed
    from outside rejects the call loudly" (`lifecycle.test.ts`) by row 8; the
    pid of "the process hosting this call" is the sole child, not a new one
    (`isolation.test.ts`, `limits.test.ts`). At IMPLEMENT the
    `protocol.test.ts` hostile bodies move to the wire below, criteria
    unchanged. Everything else A proves stays as is → I1, I5, I6

Wire (agent-owned, pinned for the hostile cases): consumer → worker stdin
JSON lines `{"type":"run","call":<u32>,"code","memoryLimitMb","maxOutputBytes"}`
and `{"type":"cancel","call":<u32>}`; worker → consumer fd 3 frames `u32be
length, u8 kind, u32be call, payload`, kinds and payloads as ADR-0557 §6.

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| guest heap limit × shared worker | culprit `memory`, neighbours exact | row 5 heap growth | → I3 |
| V8 fatal OOM / worker RSS with the culprit's isolate disposed × shared worker | culprit `memory`, not rerun; neighbours rerun once, exact | row 5 `Array(2**28)` | → I3 |
| worker RSS over ceiling, no certain culprit × in-flight calls | no blame; lost-worker path | row 7 intervals — step 0's only RSS crossing without a disposed culprit (host-side fire queue); the timer-backpressure wall must remove the growth, else neighbours rerun together with the culprit and row 7 fails | → I5 |
| guest CPU, interruptible × shared worker | culprit `timeout`; neighbours exact | row 6 busy loop, `Atomics.wait` | → I4 |
| guest CPU, termination ignored × shared worker | culprit `timeout` at deadline; worker retires after 1000 ms, neighbours finish there, exact | row 6 sort | → I4 |
| host-side flood (output, intervals) × shared worker | culprit ends; neighbours exact | row 7 | → I2 |
| rerun × original deadline | rejects naming the lost worker | row 8 budget case | → I5 |
| worker killed externally × in-flight calls | rerun once on a worker of their own; second death rejects `ERR_ISOLATE_HOST_WORKER_LOST` | row 8 | → I5 |
| reruns' worker killed × a fresh call started after the loss | fresh call unaffected (never placed with reruns) | row 8 quarantine case | → I5 |
| worker frame misaddressed × in-flight calls | protocol violation, worker killed, its calls reject | row 9 | → I7 |
| consumer exit / SIGKILL × idle worker | consumer exits; worker gone | row 4 | → I6 |
| concurrent calls × one worker | independent state and output | row 3 | → I2 |

## Out of scope

- I8 docs and I9 numbers: no product RED (README, trust-model, ADR; CLOSE reads them).
- Everything ADR-0557 already ceilings (compat `isolate-host.md`).

## Decisions

- 2026-11-18 — each pool scenario in its own consumer process: no `close()` exists to reset a pool between tests, and counting workers needs a fresh consumer.
