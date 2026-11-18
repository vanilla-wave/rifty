---
kind: epic
status: ready
title: Isolate host worker pool — runCode in fresh isolates inside long-lived shared worker processes
created: 2026-11-18
value: The same `runCode(code, options?)` at ≥ 2× lower warm latency (~10× with a V8 code cache) and ~3× lower memory for 8 concurrent calls, with a guest's OOM or hang costing its neighbours nothing but delay.
user_story: As a Node service running many model-generated snippets, I want `runCode` cheap enough to call per agent turn at density, but today every call spawns and kills its own ~140 MiB Node process (p50 ~130 ms)
tier: robust
---

## Outcome

`runCode(code, options?)` keeps its signature, result and `node -e` parity
(ADR-0557 §1). Each call still gets a fresh rifty isolate, but isolates live in
long-lived worker processes, a small fixed shard of concurrent calls per
worker, instead of one process spawned per call. Cost is measured, recorded
and at least halved against A on warm latency and on memory of concurrent
calls.

Guests of different calls now share a process. A non-escaped guest can change a
neighbour's result only by delaying it: a memory blow-up or a hang ends the
guilty call (`memory` / `timeout`); neighbours of a lost worker are rerun on a
fresh worker at most once and get their own result exactly once. Kept from A:
no host reach, no network, packed install, consumer process stays healthy.
Documents state what sharing costs: an isolate escape reaches every guest the
worker hosts, now and later; cross-isolate side channels are an open class.

## User scenario

1. The service installs the packed package and calls `runCode` as today (no
   API change). The first call warms a worker; later calls reuse it.
2. It fires 8 calls at once: they share 2 worker processes; every result
   equals `node -e`, no output crosses calls, no state survives into the next
   call on the same worker.
3. One of 4 concurrent calls on a worker allocates past its limit (heap
   growth, `new Array(2**28).fill(0)`) or hangs (busy loop, `Atomics.wait`,
   an uninterruptible builtin), or floods output or timers: that call gets
   `memory` / `timeout`; the 3 others get exactly their solo result; the next
   call works.
4. An operator kills a worker (`kill -9`, OOM-killer): its calls rerun once
   on a fresh worker and resolve; killed again, they reject naming the signal.
5. The service finishes its work and exits on its own; killed, it leaves no
   worker behind.
6. `node scripts/measure.mjs` reports warm latency, per-call memory and 8-call
   peak RSS; README records them next to A.

## Invariants

<!-- False on main 4018de0fc: `runCode` spawns one child per call and kills it
after the result (`src/run-code.ts` `spawn` per call; `isolation.test.ts` "no
child process outlives its result"); N concurrent calls = N children; an
externally killed child rejects at once (`lifecycle.test.ts`); README §Cost:
p50 128 ms, 8 concurrent 1115 MiB; trust-model §Isolate host names only the
child's uid as escape reach. I2, I4's stuck clause, I5 and I7 quantify over
a worker hosting several calls, which main never has: each carrier row first
asserts the calls share one pid, and that precondition is what fails on main
(RED run 2026-11-18, 20/20 failing). Step 0 probes:
`docs/backlog/distribution/reference/isolate-host-pool-step0.md`. -->

- I1. Shared warm workers: each call runs in a fresh isolate inside a
  long-lived worker process that hosts a fixed shard of concurrent calls
  (size in the ADR); sequential calls reuse one worker; N concurrent calls
  run in ⌈N/shard⌉ workers. `runCode(code, options?)` and its result shape are
  unchanged.
- I2. Isolation under sharing: calls on one worker, sequential or concurrent,
  see none of each other's files, globals, timers or unsettled promises, and
  a call's output reaches only its own result. A non-escaped guest flooding
  output or timers, spinning, waiting in `Atomics.wait` or growing its heap to
  its own limit leaves a concurrent neighbour's result equal to its solo
  result, given the neighbour's deadline covers the delay.
- I3. Memory on a shared worker: a guest past its isolate heap limit or in a
  V8 fatal OOM resolves `{exitCode: null, termination: 'memory'}` and is never
  rerun; the consumer stays alive; every neighbour in flight on that worker
  resolves its own solo result exactly once — no loss, hang, duplicated or
  foreign output. Blame needs a certain signal from the culprit's own isolate;
  a worker over its RSS ceiling with no such signal blames nobody (I5).
- I4. Time on a shared worker: a call past `timeoutMs` resolves `{exitCode:
  null, termination: 'timeout'}` within `timeoutMs` + 1000 ms, a guest inside
  `Atomics.wait` or a builtin that ignores termination included. A guest still
  running 1000 ms after termination retires its worker: no new call goes
  there, neighbours finish there undisturbed, then the worker is killed.
- I5. Lost worker, no culprit known (external SIGKILL, OOM-killer, crash, RSS
  ceiling without a certain culprit): its in-flight calls rerun once, together,
  on a fresh worker no other call is placed on; with budget left the rerun is
  transparent (the call resolves its own result once). A call whose worker is
  lost a second time, or whose rerun cannot finish inside its original
  deadline, rejects with `code: 'ERR_ISOLATE_HOST_WORKER_LOST'` and a message
  naming the lost worker's code/signal, built from no guest or worker-written
  bytes. A fresh call never shares a worker with rerun calls, so a second loss
  rejects only calls already lost once. No call runs more than twice.
- I6. Lifecycle: an idle worker stays warm without keeping the consumer alive
  (a consumer that called `runCode` exits on its own) and never outlives the
  consumer (consumer SIGKILL → worker gone).
- I7. A hostile worker (after an escape) reaches only the calls in flight on
  it: anything it sends for an unknown call, a call on another worker or a
  settled call kills it and rejects its in-flight calls with `isolate-host
  child protocol violation: …`; no other call's result changes.
- I8. Shared-process security is documented: trust-model, README and the ADR
  state that an escape reaches every guest the worker hosts, concurrently and
  later, that cross-isolate side channels are an open class
  (`SharedArrayBuffer`/`Atomics` present; guest `performance.now` resolution
  measured), enumerate the worker's shared resources each with its guard,
  and state that a guest may repeat an attack in new calls without bound —
  rate limiting calls per source stays with the consumer.
- I9. Measured density: README §Cost records `scripts/measure.mjs` on the
  landed tree next to A on one machine; warm-call p50 and peak RSS of 8
  concurrent calls are each ≤ ½ of A's (A on M3 Pro: 137 ms, 1118 MiB).

## Challenge

challenge: 2026-11-18 — 8 problems (fresh critic over request, goal, carrier, step 0; verified, dispositions below)

1. Omitted user choice — a rerun neighbour's budget: deadline from call start makes victims of a time-path worker kill read `timeout`. Resolved for the time path by design (I4: a stuck guest retires its worker, neighbours finish there, no rerun); for I5 reruns: manager decision F1 below (shown to the user, unanswered).
2. Omitted user choice — rerun on a worker lost with no culprit reverses A's reject-at-once (ADR-0557 §1): manager decision F2 below (shown to the user, unanswered).
3. Escape persistence on a long-lived worker — documented (I8 "now and later"); not a fork: an escape runs as the worker's uid, so recycling the worker would not bound it (ADR-0557 Safety promise).
4. Cheaper route A + code cache — probed: 74.5 ms p50, 108 MiB per call (step 0); rejected below.
5. Value overstated — value line corrected (≥ 2× uncached, ~10× cached; ~3× at 8 calls in 2 workers).
6. Invariants true on main as user statements — merged I2/I8 into I2; false-on-main note above states the shared-pid precondition; wire mechanism moved to the carrier/ADR, I7 restated by what a hostile worker can reach.
7. Shard size fixed in the goal — moved to the ADR (I1 "fixed shard"); the carrier pins 4.
8. User's OOM frame partly refuted — `onCatastrophicError` did not fire in 8 s and heap stats lead by 4 MiB under a timer flood (step 0): recorded below; I3 blames only on a certain signal, uncertain → I5.

## Decisions

- 2026-11-18 — user (via manager thread `31383f4b`, verbatim): «Давай пойдем в C и сразу сделаем экспорт чистого rifty для кастомных интегарций. Ничего страшного, что контракт будет меняться».
- 2026-11-18 — manager interpretation, shown to the user, unanswered at FIT: «C» = option C of the A/B/C table (pool of worker processes, many isolates each); the export is a separate goal in another thread. The user saw this OOM frame before choosing: small shard of K isolates per worker; culprit known via `onCatastrophicError` of its isolate, on an RSS kill by per-isolate heap stats; culprit `memory`, neighbours rerun elsewhere (possible because `runCode` is pure — no network, no host files); worker restart at an RSS threshold before a catastrophe.
- 2026-11-18 — frame point 2 refuted in part by step 0: in the catastrophic case ivm disposes the culprit's isolate for its memory limit (seen at the RSS crossing) while `onCatastrophicError` had not fired after 8 s; per-isolate heap stats separate a host-side timer flood by 4 MiB only. Blame = the culprit isolate's own disposal/fatal signal; no heap-stats guess (I3, I5).
- 2026-11-18 — manager decision by delegation (F1; both forks shown to the user, no answer yet; reversible until merge, a user answer lands as `amend:`): a rerun keeps the call's original deadline; out of budget it rejects `ERR_ISOLATE_HOST_WORKER_LOST`, never `timeout`, never a fresh `timeoutMs` — the consumer builds its own timeouts on `timeoutMs`, so a silent doubling is worse than a rare reject it can retry. Text and code carry no guest data.
- 2026-11-18 — manager decision by delegation (F2): one rerun, a second loss rejects. Quarantine, minimal form: the calls of one lost worker rerun together on a worker of their own that takes no other call, so an unknown culprit's second kill reaches only calls lost once with it, never a fresh innocent call. Burst price: one extra process per lost worker. Rejected: rerun each suspect alone (names the culprit exactly, costs up to shard-size processes per loss).
- 2026-11-18 — manager: blame only on a certain signal from the culprit's isolate accepted («угадывание по heap хуже честного "неизвестно"»).
- 2026-11-18 — overturns ADR-0557 §2 (process per call) and the kill shape of §3 for this host; recorded per `DEC-2` as a superseding ADR + dated ADR-0557 §Corrections note, critic before landing.
- 2026-11-18 — tier: robust — the new value is fault behaviour (OOM, hang, worker loss with neighbours); every reachable axis × operation gets an honest outcome + fault test.
- 2026-11-18 — lazy pool behind `runCode`, no host object or `close()`: I6 holds with unref'd idle workers that kill themselves when their stdin ends; a `close()` has no scenario need (`REV-7`).
- 2026-11-18 — no process-per-call mode kept: no consumer need names it (`REV-7`).
- 2026-11-18 — side channels declared, not closed: the guest has no second thread and no memory shared with other isolates, so `SharedArrayBuffer` gives no timer; `Atomics.wait` stops on termination (0.2 ms, step 0); coarsening `performance.now` would break Node parity (Node 41 ns, guest 3.3 µs) without closing the class. Process separation per tenant is the remedy, the consumer's.
- rejected route: keep A (process per call) — violates I1, I9.
- rejected route: A + V8 code cache (spawn per call, cached compile) — violates I9: p50 74.5 ms > ½ × 137 ms, 108 MiB per concurrent call (step 0).
- rejected route: pool of warm single-isolate children — violates I9 (≥ 108 MiB per concurrent call stays; step 0).
- rejected route: in-process pool in the consumer (B) — violates I3 (fatal OOM is unrecoverable in-process, ADR-0557 Context probe).
