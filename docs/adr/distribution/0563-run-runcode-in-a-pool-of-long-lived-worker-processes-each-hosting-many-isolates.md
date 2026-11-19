# ADR 0563: Run runCode in a pool of long-lived worker processes, each hosting many isolates

Status: Accepted
Date: 2026-11

> TL;DR: `runCode` keeps its API and a fresh isolate per call, but the isolates live in long-lived worker processes of a lazy pool, 4 calls per worker. A guest's OOM or hang costs its neighbours only delay, a lost worker's calls rerun once on a worker of their own, and the guests of one worker share its process.

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
- §1 "every memory path shares one reason" and §3 "child RSS over the ceiling → `memory`": `memory` now needs a signal from the call's own isolate; an RSS crossing without one is a lost worker (§5, §6), so even a solo call reruns, then rejects `ERR_ISOLATE_HOST_WORKER_LOST`;
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
   - The worker's RSS ceiling is 256 MiB + 3 × the sum of its live calls' `memoryLimitMb` (ADR-0557 §3, summed). Crossing it, or a catastrophic error, kills the worker (SIGKILL) after it flushes its frames.
   - No heap-stats guess: per-isolate heap stats separated a host-side timer flood by 4 MiB only.
   - An idle worker above `RECYCLE_RSS_BYTES` = 256 MiB retires.
   - Guest memory isolated-vm does not count against `memoryLimit` (probes: step-0 reference) does not exist in a worker's guests, because it would make an RSS crossing that nobody can be blamed for:
     - `WebAssembly` has two layers. The engine flag `--wasm-max-mem-pages=0` on every worker means no wasm memory can hold a page. Separately, the global is deleted from each context before any guest code, so no reference remains. In its place the guest bundle installs a namespace whose every member is `NotImplementedError('isolate-host.WebAssembly')`. The bundle itself needs no wasm: its cjs-module-lexer is the plain-JS build.
     - Resizable `ArrayBuffer` / growable `SharedArrayBuffer` (`maxByteLength`) have no engine knob. The guest bundle wraps both constructors before any runtime module, so `maxByteLength` is `NotImplementedError('isolate-host.ArrayBuffer.maxByteLength' | '…SharedArrayBuffer.maxByteLength')`. The originals are unreachable: the global and `prototype.constructor` are replaced, and the wrapper hands them only primitives. Fixed-length buffers, `transfer` included, go through the counted allocator.
   - Host resources made on a guest's behalf are bounded per guest:
     - at most `memoryLimitMb` × 1024 live host timers (~1 KiB of worker memory each, measured). The next start is refused and the call ends `memory`, a breach of its own budget;
     - `code` is at most 1 MiB of UTF-8, checked in the consumer before anything is sent (`ERR_OUT_OF_RANGE`). The worker reads requests linearly.
6. **Lost worker.** A worker that exits without the consumer ending it — external SIGKILL, OOM-killer, crash, its own RSS kill, a closed result channel — loses its unsettled calls.
   - They rerun once, together, on a new worker of their own that takes no other call and ends when they are settled.
   - The rerun keeps the original deadline. A second loss, or a rerun past the deadline, rejects with `code: 'ERR_ISOLATE_HOST_WORKER_LOST'` and `isolate-host child exited unexpectedly (code …, signal …)` (+ ` after closing its result channel without a result` when the consumer forced that exit, + `; its rerun did not finish within timeoutMs`). The text holds no guest or worker-written bytes: worker stderr is ignored.
   - A worker the consumer ends itself (idle, retired, quarantine done) takes no call from that moment and its exit loses nothing.
   - No call runs more than twice. A guest that keeps killing workers costs at most two workers per call, and its co-runners only the calls lost with it.
   - The cost of a culprit-less loss is one extra process per lost worker.
7. **Shared worker resources**, each with its guard:

   | Resource | Guard |
   |---|---|
   | RSS / address space | per-isolate heap limit, worker ceiling (§5), idle recycle |
   | isolated-vm thread pool (cores + 1 threads) | shard 4; a stuck isolate's thread retires its worker (§4) |
   | The worker's main thread (bridge callbacks, frames) | output capped per call; at most one timer `fire` in flight per timer (ADR-0558 Decisions 2026-11-19) |
   | Host timers | per-call bridge, closed with the call; ≤ `memoryLimitMb` × 1024 live, past it the call ends `memory` (§5) |
   | Requests (stdin) | `code` ≤ 1 MiB, refused in the consumer; read linearly |
   | Guest memory outside the isolate heap | wasm removed (engine flag + realm), `maxByteLength` buffers a named gap (§5); unmeasured: Intl/ICU data and caches, compiled-code and regexp spaces |
   | Pipes | bounded per call by the consumer (ADR-0557 §6) |
   | V8 code cache | produced by a compile before that isolate's guest code runs; bytes only |
   | CPU | OS scheduling, delay only. On 1–2 cores the pool has 2–3 threads for a shard of 4: busy neighbours wait for a thread, not just a time slice |

   A non-escaped guest changes a neighbour's result only by delaying it. A neighbour whose deadline the delay outlives resolves `timeout` (compat ⚠️).
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
- rerunning each suspect of a lost worker alone: names the culprit exactly, but costs up to 4 processes per loss;
- a fresh `timeoutMs` for a rerun: silently doubles the consumer's bound;
- blaming the largest heap at an RSS crossing.

## Not the user's words

Manager decisions by delegation (2026-11-18/19), shown to the user and not answered at landing; reversible until merge, a user answer lands as a correction here:
- «C» = option C of the A/B/C table: a pool of worker processes;
- F1: a rerun out of budget rejects `ERR_ISOLATE_HOST_WORKER_LOST`, never `timeout` and never with a fresh budget;
- F2: one rerun, quarantined.

Manager decision by delegation, 2026-11-19 (shown to the user, no answer yet): wasm is unavailable in the pool's guests (option 2 of the manager's cross-review round 1: no per-isolate signal for wasm memory exists, probe in the step-0 reference); two layers, each with its own mutant.

Manager decision, 2026-11-18: blame only on a certain signal from the culprit's own isolate («угадывание по heap хуже честного "неизвестно"»).

Agent decisions: the shard size, the 1000 ms grace, the 256 MiB watermark and the summed ceiling, keeping one warm idle worker, no `close()`, no process-per-call mode, side channels declared rather than mitigated (no `performance.now` coarsening), and the wire's `retire` kind.

## Consequences

- Measured on landed code (README §Cost): warm call p50 13 ms vs 137 ms; +22 MiB per concurrent call in one worker; 8 cold concurrent calls 414 MiB vs 1118 MiB. Measurements, not promises.
- An externally killed worker no longer rejects its calls at once: they rerun once (ADR-0557 §1 sentence superseded).
- An RSS crossing with no isolate signal blames nobody: its calls, including the unknown culprit, rerun together and reject on its second kill — innocent co-runners included.
- A worker carries guests of many calls, so an escape's reach is wider than under ADR-0557.
- `WebAssembly` worked in `runCode` guests before this pool (one process per call) and is now a named gap; so are resizable/growable buffers. Direction (ROADMAP M14): wasm calls in a process of their own, where its memory is the process's.
- Directions, not scoped: per-tenant worker affinity, a concurrency limit, an `AbortSignal` option.
