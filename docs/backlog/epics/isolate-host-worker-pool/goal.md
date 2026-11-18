---
kind: epic
status: draft
title: Isolate host worker pool — runCode in fresh isolates inside long-lived shared worker processes
created: 2026-11-18
value: The same `runCode(code, options?)` at ~10× lower warm latency and ~4× lower memory per concurrent call, with a guest's OOM or hang costing its neighbours nothing but delay.
user_story: As a Node service running many model-generated snippets, I want `runCode` cheap enough to call per agent turn at density, but today every call spawns and kills its own ~140 MiB Node process (p50 ~130 ms)
tier: robust
---

## Outcome

`runCode(code, options?)` keeps its signature, result and `node -e` parity
(ADR-0557 §1). Each call still gets a fresh rifty isolate, but isolates live in
long-lived worker processes, up to 4 concurrent calls per worker, instead of
one process spawned per call. Cost is measured, recorded and at least halved
against A on warm latency and on memory of concurrent calls.

Guests of different calls now share a process. A non-escaped guest can change a
neighbour's result only by delaying it: a memory blow-up or a hang ends the
guilty call (`memory` / `timeout`); neighbours on a lost worker get their own
result exactly once, rerun on a fresh worker at most once. Kept from A: no host
reach, no network, packed install, consumer process stays healthy.
Documents state what sharing costs: an isolate escape reaches every guest on
that worker; cross-isolate side channels are an open class.

## User scenario

1. The service installs the packed package and calls `runCode` as today (no
   API change). The first call warms a worker; later calls reuse it.
2. It fires 8 calls at once: they run in 2 worker processes; every result
   equals `node -e`, no output crosses calls, no state survives into the next
   call on the same worker.
3. One of 4 concurrent calls on a worker allocates past its limit (heap
   growth, `new Array(2**28).fill(0)`, 20000 intervals) or hangs (busy loop,
   `Atomics.wait`, an uninterruptible builtin): that call gets `memory` /
   `timeout`; the 3 others get exactly their solo result; the next call works.
4. An operator kills a worker (`kill -9`, OOM-killer): its calls rerun once
   on a fresh worker and resolve; killed again, they reject naming the signal.
5. The service finishes its work and exits on its own; killed, it leaves no
   worker behind.
6. `node scripts/measure.mjs` reports warm latency, per-call memory and 8-call
   peak RSS; README records them next to A.

## Invariants

<!-- False on main 4018de0fc: `runCode` spawns one child per call and kills it
after the result (`src/run-code.ts` `spawn` per call; `isolation.test.ts` "no
child process outlives its result" asserts `childPids()` empty after a call);
N concurrent calls = N children; frames carry no call id (`src/protocol.ts`);
an externally killed child rejects its call at once (`lifecycle.test.ts`);
README §Cost: p50 128 ms, 8 concurrent 1115 MiB; trust-model §Isolate host
names only the child's uid as escape reach. Step 0 premise probes:
`docs/backlog/distribution/reference/isolate-host-pool-step0.md`. -->

- I1. Shared warm workers: each call runs in a fresh isolate inside a
  long-lived worker process holding up to 4 concurrent calls; sequential calls
  reuse one worker; N concurrent calls run in ⌈N/4⌉ workers. `runCode(code,
  options?)` and its result shape are unchanged.
- I2. Freshness inside a worker: files, globals, timers and unsettled promises
  of one call are not visible in, and do not act during, any other call on the
  same worker, sequential or concurrent; a call's output reaches only that
  call's result.
- I3. Memory on a shared worker (isolate heap limit, V8 fatal OOM, worker RSS
  ceiling): the consumer stays alive; the culprit resolves `{exitCode: null,
  termination: 'memory'}` and is never rerun; every neighbour in flight on
  that worker resolves its own solo result exactly once — no loss, hang,
  duplicated or foreign output.
- I4. Time on a shared worker: a call past `timeoutMs` resolves `{exitCode:
  null, termination: 'timeout'}` within `timeoutMs` + 1000 ms, a guest inside
  `Atomics.wait` or a builtin that ignores termination included; a guest not
  stopped 1000 ms after termination costs its worker, never a neighbour's
  result (neighbours as in I3).
- I5. Bounded reruns: a worker that dies with no culprit known (external
  SIGKILL, OOM-killer, crash) has its in-flight calls rerun once on a fresh
  worker; a call whose worker dies a second time rejects with an error naming
  code/signal. No call runs more than twice.
- I6. Lifecycle: an idle worker never keeps the consumer alive (a consumer
  that called `runCode` exits on its own) and never outlives the consumer
  (consumer SIGKILL → worker gone).
- I7. Call-addressed protocol: every worker → consumer frame names its call; a
  frame for a call not in flight on that worker (unknown, or already settled)
  is a protocol violation that kills the worker and rejects its in-flight
  calls with `isolate-host child protocol violation: …`; no output or status
  is ever attributed to another call.
- I8. Delay only: a non-escaped guest flooding output, 20000 intervals, a busy
  loop, `Atomics.wait` or heap growth to its own limit leaves a concurrent
  neighbour's result equal to its solo result, given the neighbour's deadline
  covers the delay.
- I9. Shared-process security is documented: trust-model, README and the ADR
  state that an escape reaches every guest on that worker, that
  cross-isolate side channels are an open class (`SharedArrayBuffer`/`Atomics`
  present; guest `performance.now` resolution measured), and enumerate the
  worker's shared resources each with its guard.
- I10. Measured density: README §Cost records `scripts/measure.mjs` on the
  landed tree next to A on one machine; warm-call p50 and peak RSS of 8
  concurrent calls are each ≤ ½ of A's (A on M3 Pro: 137 ms, 1118 MiB).

## Challenge

challenge: pending

## Decisions

- 2026-11-18 — user (via manager thread `31383f4b`, verbatim): «Давай пойдем в C и сразу сделаем экспорт чистого rifty для кастомных интегарций. Ничего страшного, что контракт будет меняться».
- 2026-11-18 — manager interpretation, shown to the user, unanswered at FIT: «C» = option C of the A/B/C table (pool of worker processes, many isolates each); the export is a separate goal in another thread. The user saw this OOM frame before choosing: small shard of K isolates per worker; culprit known via `onCatastrophicError` of its isolate, on an RSS kill by per-isolate heap stats; culprit `memory`, neighbours rerun elsewhere (possible because `runCode` is pure — no network, no host files); worker restart at an RSS threshold before a catastrophe.
- 2026-11-18 — overturns ADR-0557 §2 (process per call) and the kill shape of §3 for this host; recorded per `DEC-2` as a superseding ADR + dated ADR-0557 §Corrections note, critic before landing.
- 2026-11-18 — tier: robust — the new value is fault behaviour (OOM, hang, worker death with neighbours); every reachable axis × operation gets an honest outcome + fault test.
- 2026-11-18 — no process-per-call mode kept: no consumer need names it (`REV-7`); a consumer wanting a process per tenant runs separate consumer processes.
- 2026-11-18 — deadline stays from call start across a rerun (ADR-0557 §1 bound `timeoutMs` + 1000 ms kept); a neighbour whose rerun outlives its remaining budget resolves `timeout` — declared compat ⚠️, not a fresh budget.
- 2026-11-18 — side channels declared, not closed: the guest has no second thread and no shared memory with other isolates, so `SharedArrayBuffer` gives no timer; `Atomics.wait` stops on termination (0.2 ms, step 0); coarsening `performance.now` would break Node parity (Node 41 ns, guest 3.3 µs) without closing the class. Process separation per tenant is the remedy, the consumer's.
- rejected route: keep A (process per call) — violates I1, I10.
- rejected route: pool of warm single-isolate children (A reused) — violates I10 (≈140 MiB per concurrent call stays; step 0).
- rejected route: in-process pool in the consumer (B) — violates I3 (fatal OOM is unrecoverable in-process, ADR-0557 Context probe).
