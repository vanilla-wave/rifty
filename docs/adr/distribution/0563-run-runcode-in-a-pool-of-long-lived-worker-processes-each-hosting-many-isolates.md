# ADR 0563: Run runCode in a pool of long-lived worker processes, each hosting many isolates

Status: Accepted
Date: 2026-11

> TL;DR: `runCode` keeps its API and a fresh isolate per call, but the isolates live in long-lived worker processes of a lazy pool, 4 calls per worker. A guest's OOM or hang costs its neighbours only delay; a lost worker's calls rerun once, each alone on a worker of its own; the guests of one worker share its process.

## Context

Goal `isolate-host-worker-pool`. User (2026-11-18, via the manager, verbatim): «Давай пойдем в C и сразу сделаем экспорт чистого rifty для кастомных интегарций. Ничего страшного, что контракт будет меняться». ADR-0557 §2 spawned a child process per call: p50 137 ms, ~140 MiB per call, 1118 MiB for 8 concurrent calls (M3 Pro, Node v24.16.0). Step-0 probes on a throwaway prototype, plus the landed tree (`docs/backlog/distribution/reference/isolate-host-pool-step0.md`):
- a warm worker serves a call in 13 ms with a V8 code cache, 60 ms without one;
- each concurrent isolate adds ~11.5 MiB of RSS;
- after `dispose()`, small-object heaps stay resident (macOS);
- a default-comparator `sort` of 3e6 doubles ignores termination for ~4.7 s, and an ivm memory-limit disposal can leave the run unsettled for > 10 s;
- `onCatastrophicError` had not fired 8 s into `new Array(2**28).fill(0)`, while ivm had already disposed that isolate;
- `SharedArrayBuffer` and `Atomics` reach the guest; guest `performance.now` resolution is 3.3 µs (Node: 41 ns).

## Decision

Overturns ADR-0557 §2 (process per call) and the kill shape of §3, including:
- §1 "a child that exits without a result rejects the call at once": its calls rerun once (§6);
- §1 "every memory path shares one reason" and §3 "child RSS over the ceiling → `memory`": `memory` now needs the call's own isolate signal, or an RSS crossing of the solo worker it reruns on alone; a crossing on a shared worker is a lost worker (§5, §6);
- §6 "a channel closed with no result settles as its own error": it is a lost worker too.

ADR-0557 §1's API, result shape and `timeoutMs` + 1000 ms bound, §4–§7 otherwise, and its escape posture still hold, widened below.

1. **Topology.** A lazy pool in the consumer process, created by the first `runCode`. Workers are `process.execPath --no-node-snapshot dist/child.js`, `env: {}`. There is no host object, no `close()`, no process-per-call mode and no queue.
   - Idle workers are `unref`'d: only a pending call's deadline timer keeps the consumer alive.
   - A worker kills itself when its stdin ends.
   - Each call gets a fresh isolate, built by the worker as an embedder of `@riftydev/isolate-guest` (ADR-0558; no second bridge).
2. **Placement.** A fresh call goes to the oldest worker that takes fresh calls and has a free slot (`SHARD` = 4), else to a new worker. One idle worker stays warm; a second idle one ends.
   - Each worker produces its own V8 code cache with its first compile; concurrent first calls wait for it.
3. **Wire** (`src/protocol.ts`).
   - Consumer → worker: JSON lines `run{call, code, memoryLimitMb, maxOutputBytes}` and `cancel{call}`.
   - Worker → consumer: frames `u32be length, u8 kind, u32be call, payload` on fd 3, with ADR-0557 §6's kinds plus `retire` (call 0).
   - A frame may name only a call in flight on that worker; a call stops being addressable at its terminal frame. A call the consumer cancelled stays addressable until then, and its frames are dropped (the worker's terminal frame for it only ends the addressing).
   - Anything else is a protocol violation: the worker is killed and its unsettled calls reject `isolate-host child protocol violation: …`, with no rerun.
4. **Time.** The consumer owns the deadline: at `timeoutMs` it resolves `timeout` with the output so far and sends `cancel`, and the worker disposes the isolate.
   - A disposed isolate still running after `STUCK_GRACE_MS` = 1000 ms (a builtin that ignores termination) makes the worker `retire`: no new call goes there.
   - Its neighbours finish where they are, without a rerun; the consumer kills the worker once every call on it is settled.
5. **Memory.** Blame needs a certain signal from the culprit's own isolate: ivm disposing it for its heap limit (polled every 25 ms, reported at once even while a builtin holds its thread), or its `onCatastrophicError`. The culprit resolves `memory` and is never rerun.
   - The worker's RSS ceiling is 256 MiB + 3 × the largest sum of its live calls' `memoryLimitMb` since it was last idle (ADR-0557 §3, summed; it never shrinks while the worker is busy, so memory a finished call left resident is not a later call's). Crossing it, or a catastrophic error, kills the worker (SIGKILL) after it flushes its frames.
   - No heap-stats guess: per-isolate heap stats separated a host-side timer flood by 4 MiB only.
   - An idle worker above `RECYCLE_RSS_BYTES` = 256 MiB retires.
   - In a solo worker (§6) an RSS crossing is its one call's own: it resolves `memory`. In a shared worker nobody is blamed, even with one call left: memory others left resident may be the cause.
   - No per-source accounting of guest memory outside the isolate heap (wasm, `maxByteLength` buffers, ICU, compiled code, host timers, a large `code`): any exhaustion of the worker is attributed by §6, so the protection of neighbours does not depend on listing those sources.
6. **Lost worker.** A worker that exits without the consumer ending it — external SIGKILL, OOM-killer, crash, its own RSS kill, a closed result channel — loses its unsettled calls.
   - Each reruns once, alone, on a solo worker that takes no other call and ends when the call settles. There the attribution is trivial: an RSS crossing is that call's `memory`; an innocent call simply completes. Its deadline is still the original one (F1): reaching it rejects `ERR_ISOLATE_HOST_WORKER_LOST`, never `timeout`, and it is never refreshed.
   - A solo lost for an unknown reason, or a rerun past the deadline, rejects with `code: 'ERR_ISOLATE_HOST_WORKER_LOST'` and `isolate-host child exited unexpectedly (code …, signal …)` (+ ` after closing its result channel without a result` when the consumer forced that exit, + `; its rerun did not finish within timeoutMs`). The text holds no guest or worker-written bytes: worker stderr is ignored.
   - A worker the consumer ends itself (idle, retired, solo done) or that has exited takes no call from that moment and its exit loses nothing.
   - No call runs more than twice. Processes: a loss of N calls spawns at most N solos, so a mass loss never exceeds one process per call in flight — ADR-0557's worst case (carrier: 8 calls on 2 killed workers peak ≤ 8 processes).
7. **Shared worker resources**, each with its guard:

   | Resource | Guard |
   |---|---|
   | Any exhaustion of the worker process (RSS in or out of the isolate heaps, crash) | the guilty isolate's own signal (§5), else the lost-worker path: every call reruns alone, where the exhaustion is its own (§6) |
   | isolated-vm thread pool (cores + 1 threads) | shard 4; a stuck isolate's thread retires its worker (§4). On 1–2 cores the pool has 2–3 threads for a shard of 4: busy neighbours wait for a thread, not just a time slice |
   | The worker's main thread (bridge callbacks, frames) | output capped per call; at most one timer `fire` in flight per timer (ADR-0558 Decisions 2026-11-19); requests read linearly |
   | Pipes | bounded per call by the consumer (ADR-0557 §6) |
   | V8 code cache | produced by a compile before that isolate's guest code runs; bytes only |
   | CPU | OS scheduling, delay only |

   A non-escaped guest changes a neighbour's result only by delaying it, for an exhaustion that repeats in its solo (deterministic). A neighbour whose deadline the delay outlives resolves `timeout`, or `ERR_ISOLATE_HOST_WORKER_LOST` once its worker was lost (compat ⚠️). What the solo rerun does not give: an adaptive culprit — one that exhausts the worker only in its first attempt, or only late — escapes blame (its rerun can end `exit 0`), and its neighbours pay the rerun and may run out of budget (`LOST`).
   - One worker's RSS ceiling is 256 MiB + 3 × A, where A is the largest sum of `memoryLimitMb` over the calls live at the same time since the worker last went from idle to busy (plus one allocation step past the sampled ceiling). A does not fall while the worker stays busy. Example: a 1024 MiB call and a 64 MiB call run together (A = 1088); the 1024 one ends and the 64 one runs on alone — its worker may still reach 256 + 3 × 1088 = 3520 MiB, not 448. A solo's ceiling is 256 MiB + 3 × its own limit.
   - Processes: every worker but one warm idle one holds at least one call in flight — counting a call settled at its deadline whose isolate still runs (until it unwinds, or for the 1 s grace before its worker retires) — so the pool runs at most (those calls + 1) workers at once: with fragmentation, up to the peak of concurrent calls, not ⌈calls / 4⌉. Bound the pool's RSS as that many workers times their ceilings.
8. **Security** (trust-model §Isolate host).
   - An isolate escape runs as the worker's uid inside a process that hosts other guests, now and later: their code, data and output are reachable.
   - Cross-isolate side channels in one process are an open class, declared rather than closed:
     - the guest has no second thread and shares no memory with other isolates, so `SharedArrayBuffer` gives it no timer;
     - `Atomics.wait` stops on termination (0.2 ms);
     - coarsening `performance.now` would break Node parity without closing the class.
   - Process separation per tenant is the consumer's remedy: separate consumer processes. So is limiting the call rate per source: a guest may repeat an attack in new calls without bound.

Rejected:
- keeping ADR-0557 §2: the warm path is 10× slower and costs ~3× the memory;
- ADR-0557 plus a V8 code cache: 74.5 ms and 108 MiB per call (step 0);
- a pool of warm single-isolate children: ≥ 108 MiB per concurrent call stays;
- in-process isolates (ADR-0557 Context);
- rerunning a lost worker's calls together on one quarantine worker: an unknown culprit's second kill took its innocent co-runners with it (accepted first, overturned in §Corrections);
- enumerating guest memory outside the isolate heap with a per-source ceiling (wasm removed, `maxByteLength` refused, a timer quota, a `code` limit): each estimate that was wrong let a guest take its neighbours down again, and the sources are not enumerable (§Corrections);
- a fresh `timeoutMs` for a rerun: silently doubles the consumer's bound;
- blaming the largest heap at an RSS crossing.

## Not the user's words

Decided by the manager, not by the user (who saw them and had not answered at landing): reading «C» as a pool of worker processes, F1, F2, and the solo reruns of a lost worker's calls.

Manager decisions by delegation (2026-11-18/19), shown to the user and not answered at landing; reversible until merge, a user answer lands as a correction here:
- «C» = option C of the A/B/C table: a pool of worker processes;
- F1: a rerun out of budget rejects `ERR_ISOLATE_HOST_WORKER_LOST`, never `timeout` and never with a fresh budget;
- F2: one rerun; how it is placed: together on a quarantine worker (round 1), then each call alone (round 2, §Corrections).

Manager decision by delegation, 2026-11-19, cross-review round 2 (supersedes the round-1 decision that made wasm unavailable): a lost worker with no culprit reruns each call alone; wasm, `maxByteLength` buffers and unbounded timers return (`REV-7`).

Manager decision, 2026-11-18: blame only on a certain signal from the culprit's own isolate («угадывание по heap хуже честного "неизвестно"»).

Agent decisions: the shard size, the 1000 ms grace, the 256 MiB watermark and the summed ceiling (never shrinking while busy, reset when a worker goes busy), blame on an RSS crossing only in a solo worker, keeping one warm idle worker, no `close()`, no process-per-call mode, side channels declared rather than mitigated (no `performance.now` coarsening), and the wire's `retire` kind.

## Consequences

- Proven at landing (goal `isolate-host-worker-pool`, closed 2026-11-19; carriers `packages/isolate-host/tests/pool.test.ts`, `pool-faults.test.ts`, `pool-protocol.test.ts`, each discriminating mutant run): shared warm workers and packing; freshness of files, globals, timers, promises and output across calls on one worker; a culprit's heap limit, fatal OOM, deadline (busy loop, `Atomics.wait`, a builtin ignoring termination) and memory outside its heap (wasm, resizable buffers, ICU) and floods of intervals next to three neighbours — culprit `memory`/`timeout`, neighbours exact once; lost workers (external kill once and twice, budget, spawn failures, mass loss ≤ one process per call); idle workers unref'd, never orphaned; hostile-worker frames confined to their own calls; idle recycle above 256 MiB. Premise and density probes: `docs/backlog/distribution/reference/isolate-host-pool-step0.md`.

- Measured on landed code (README §Cost): warm call p50 13 ms vs 137 ms; +22 MiB per concurrent call in one worker; 8 cold concurrent calls 414 MiB vs 1118 MiB. Measurements, not promises.
- An externally killed worker no longer rejects its calls at once: they rerun once (ADR-0557 §1 sentence superseded).
- An RSS crossing with no isolate signal blames nobody in a shared worker: each call reruns alone, and only the culprit's solo crosses again (its `memory`).
- A worker carries guests of many calls, so an escape's reach is wider than under ADR-0557.
- A guest whose memory grows outside its heap holds its worker's neighbours until the summed ceiling (§5) is crossed; they then rerun from scratch within their deadline. Provision an RSS cgroup above the sum of the workers' ceilings.
- Directions, not scoped: per-tenant worker affinity, a concurrency limit, an `AbortSignal` option.

## Corrections

- 2026-11-19 — §5–§7, cross-review round 2 (manager decision by delegation): the lost-worker path reruns each call alone instead of together on a quarantine worker. The rejected rerun-alone option is accepted: its cost is bounded by one process per call in flight (ADR-0557's worst case), and it closes the class "guest memory outside the heap → worker lost without a culprit" by construction. Round 2 had shown the enumeration failing anew: 100 000 `Intl.DateTimeFormat` (ICU memory), a create/clear loop of intervals (the delivery queue outgrows a quota that clearing returns), and 262 000 intervals below the quota (~3.3 KiB each, not 1) each made all four calls `LOST`. Overturned with it (`REV-7`): wasm removal (engine flag and global), the `maxByteLength` wrappers, the per-guest timer quota and the 1 MiB `code` limit. Carriers: wasm with written pages, resizable and growable buffers, the Intl flood, the interval loop and 262 000 intervals, each next to three neighbours, the culprit `memory`, the neighbours exact once; mass loss ≤ one process per call.
- 2026-11-19 — §5, load runs after the round-2 correction: blaming the last call left on a shared worker blamed memory others had left resident (three heavy calls end, a light one alone gets `memory`; RED `memory retained from finished calls…`). Attribution is now the solo worker's only (the run request carries `solo`), and the ceiling's allowance never shrinks while the worker is busy.
- 2026-11-19 — §5–§6, cross-review round 3: a rerun's worker that fails to start asynchronously (ENOENT, EAGAIN, EMFILE — a mass loss is when they come) rejects `ERR_ISOLATE_HOST_WORKER_LOST`, not the raw error; the allowance resets when an idle worker takes a call (a big call no longer lends its ceiling to the next: 700 MiB of wasm at limit 64 had ended `exit 0`).
- 2026-11-19 — corrects the round-2 line above: the solo rerun does not close the class "by construction". It names a deterministic exhaustion of the worker on its culprit without any list of sources, but not an adaptive culprit — one that exhausts the worker only in its first attempt, or only late (§7). Also cross-review round 4: §7's RSS bound is per busy period, not per concurrent set (example in §7), and the worker count is bounded by calls in flight + 1, not ⌈calls / 4⌉.
- 2026-11-19 — residual at landing: the worker sends its retire frame before the last terminal frame (`src/child/main.ts`), so the consumer stops placing calls on a worker above its watermark; this ordering has no discriminating carrier (a mutant sending it after survives: the consumer usually reads both frames in one chunk). Owner: `backlog/distribution/isolate-host-retire-before-terminal-uncarried`.

- 2026-11-19 — §3, §8: the run request carries the caller’s shared buffer policy across placement and solo retries. The side-channel posture still applies (ADR-0566).
- 2026-11-22 — §6: the closed-channel grace decides after one loop poll, not in its timer callback: a loop turn runs due timers before I/O, so a starved consumer judged a worker's own exit `… after closing its result channel without a result` (the forced-exit suffix on `code 7`). Now an exit that came in time is the worker's own, and from its channel's end to that decision the worker takes no new call and is not idle (a call placed there spent its one rerun on a worker that cannot answer, and counting it idle ended a healthy warm worker; PR #420 cross-review rounds 2–3; the base grace window had the placement half too). Unchanged by design: a worker alive past the grace is killed (`signal SIGKILL … after closing its result channel without a result`) — the red seen on loaded hosts (PRs #413, #414: the hostile child's own `process.exit` came later than 50 ms); a real worker's channel closes with its death, so only a hostile one lives on; the test cues its exit inside the grace. The deadline stays a plain timer (§4, F1): judged after a poll it took results sent after it (PR #420 cross-review); with a starved consumer it is judged by read order, not send time — `backlog/distribution/isolate-host-starved-deadline-outcome`. RED `protocol.test.ts` (starved-consumer cases, both directions; "a worker whose result channel ended takes no new call…", "… is not idle…"); class row `docs/process/rules/fault-classes.md` (Owned native child lifecycle).
