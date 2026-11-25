# Lifecycle revisit probes — fresh isolate per `exec` vs live isolate per sandbox vs FS in the worker

Input for the user's revisit (2026-11-25) of ADR-0568's «a fresh isolate per `exec`, the state =
bytes in the consumer». Disposable probes; `packages/*/src`, ADRs and goals untouched. Machine: Apple
M3 Pro (12 cores), macOS, Node v24.16.0, isolated-vm 7.0.2, main @ `bc3412420`, load 2–4 (each
row carries its load). Raw output: `life.out.txt`.

```sh
mkdir -p /tmp/life-probe/deps && cp ../isolate-library-probe/deps/package*.json /tmp/life-probe/deps/
(cd /tmp/life-probe/deps && npm ci --ignore-scripts)        # 8 000 files, 86.6 MB, 8 792 entries
pnpm --filter @riftydev/isolate-guest build
node --no-node-snapshot --expose-gc life.mjs /tmp/life-probe/deps/node_modules cost conc floor heap retain host life
ARMS=v2 K=8 node --no-node-snapshot --expose-gc life.mjs /tmp/life-probe/deps/node_modules mem   # one process per arm
node --no-node-snapshot --expose-gc life.mjs /tmp/life-probe/deps/node_modules cata              # aborts the process
node ipc.mjs
```

`life.mjs` drives isolated-vm and the guest bundle (real entry + the template probes'
`probe-guest.ts` + `life-guest.ts`) worker side; the template FS is the template probes'
`layered.ts` (ADR-0572 §2's construction). No consumer process, no pool: consumer ↔ worker IPC is
`ipc.mjs` apart.

## Arms

| arm | isolate | where the files live between `exec`s | template |
|---|---|---|---|
| v1 | fresh per `exec` | bytes in the consumer (ADR-0568) | copied into each run's isolate (ADR-0572 F1 (a), today's plan) |
| v1b | fresh per `exec` | same | read lazily through 2 host functions (F1 (b), deferred) |
| v2 | one per sandbox, kept for its life | context A of that isolate; each `exec` = a new context B (fresh realm, bundle re-run from the isolate's compiled script), its `FsSync` a copying membrane onto A | copied into A once per sandbox |
| v2b | same as v2 | same | lazy from the worker, cached in A for the sandbox's life |
| v3 | fresh per `exec` | the worker's realm (a `LayeredFs` per sandbox over the worker's one template); every guest `FsSync` call is one sync host call | in the worker only |

Not built: host disk (ADR-0568 B, rejected by the user). Named, built from measured parts, not run
end to end: **v2b+rp** — v2b plus a restore point (the state of A, 0.4 ms / 3 KB, L7) handed to
the consumer after every mutating `exec` / host write, and a rebuild from it (27 ms, = v1's `exec`
path) on a kill, an OOM or a lost worker; optionally **+eviction**: after X s idle capture and
dispose, rebuild on the next op (v1's idle memory, v2b's speed in tight fix loops, both paths).

## Cost (four-library template; ms, median of 7 warm repeats in one sandbox; `life.out.txt` §cost)

| `exec` | v1 | v1b | v2 | v2b | v3 |
|---|---|---|---|---|---|
| empty file | 30.4 | 17.1 | 8.1 | 8.0 | 16.0 |
| pdf (pdf-lib) | 203 | 205 | 145 | 146 | 250 |
| docx | 171 | 166 | 125 | 126 | 159 |
| pptx | 332 | 324 | 280 | 285 | 330 |
| xlsx (exceljs) | 430 | 464 | 333 | 336 | 604 |
| first `exec` of a sandbox, pdf / xlsx | 205 / 432 | 202 / 461 | 191 / 432 (+ create 23) | 213 / 479 (+ create 10) | 252 / 607 |
| 4 sandboxes at once, wall, pdf / xlsx (§conc) | 270 / 516 | 264 / 591 | 245 / 480 | 231 / 475 | 356 / 826 |
| boot of the run's realm | 9–16 (isolate + context + bundle) | 9–14 | 5–9 (context + bundle) | 5–6 | 9–15 |

- v2/v2b's warm `exec` is 22–97 ms (16–29 %) faster than v1: v1's restore + capture (template
  copy + index, ~14 ms on the empty file) and ~4 ms of isolate boot go, and the run phase is 9–22 %
  shorter from the second `exec` on (pdf 140 vs 179, docx 120 vs 146, pptx 271 vs 298, xlsx 327
  vs 405) — the cause (code compiled again in the same isolate) is assumed, not isolated. The
  first `exec` of a sandbox, create included, is 0–13 % slower than v1's (v2b xlsx 490 vs 432).
- Not in these rows: v1 also moves the sandbox's own files both ways per `exec` (here 3 KB). An
  input of S MB (a user's PDF, images for pptx) adds per `exec` the codec both ways (ADR-0568
  Consequences: ~1.6 ms consumer + ~3.3 ms isolate per ~1 MB) and base64 IPC (6.4 ms / MiB,
  `ipc.mjs`); v2/v3 move unchanged files never.
- v1's `ms` stops before its isolate's dispose (slightly favours v1); every arm ran at
  `memoryLimit` 1024, so a live isolate rarely collected — `exec` time at a production limit not
  measured.
- v3 pays a host call per FS call on the worker's one thread (xlsx +175 ms, four at once +310);
  the template probes' L measured chunked I/O quadratic across that bridge (8 MiB: 259 vs 64 ms).
- v1b: lazy template reads cost more per `exec` than the copy saves on real generators.

## Memory (`life.out.txt` §mem, §floor, §heap, §retain)

Idle sandbox (after one pdf `exec`; 8 per process):

| | v1 | v1b | v2 | v2b | v3 |
|---|---|---|---|---|---|
| held per idle sandbox | 3.1 KB of state (+ the consumer's FS, ~3 KiB, template probe W) | same | isolate: heap 13.6 used / 59.7 committed + 97.3 MiB external (the template copy); RSS +157 MiB | heap 10.4 used / 31.5 committed + 17.2 MiB external (touched template bytes, grows with the libraries touched); RSS +57 MiB | 0.5 MiB worker heap |
| where | consumer | consumer | a worker, pinned | a worker, pinned | a worker, pinned |

RSS deltas include ~13–21 MiB per sandbox of allocator retention from running K isolates in a row
(v1 shows 21 holding nothing); the isolate's own heap statistics are the cleaner figure.
Per worker, independent of sandboxes: one template copy (82.6 MiB + index) in every arm.

Smallest passing `memoryLimit` (create + 3 `exec`s, 4 MiB steps; v2's limit is the sandbox's
whole life): empty 103 / 19 / 107 / 19 / 19 MiB (v1 / v1b / v2 / v2b / v3), pdf 107 / 27 / 111 /
31 / 23, xlsx 115 / 39 / 115 / 39 / 31. Under the default 256 MiB the guest code keeps ~140 MiB in
v1/v2 and ~220 in v1b/v2b/v3.

Heap of one live sandbox over 60 `exec`s (§retain, limit 160 pdf / 192 xlsx): 60 / 60 pass, used
heap after a GC in the isolate 14.3 / 25 MiB — the same as after the first. Without a GC the used
heap climbs to 166–180 MiB (pdf, limit 1024) and falls back: garbage, not retention. **But** with
the probe's first version, which left the isolated-vm `Reference`s into each run's context
unreleased, the same sandbox died out of memory after 11–13 `exec`s (`LEAK_REFS=1`): in v2 every
handle into a run realm must be released, or each `exec` leaks its whole realm into the sandbox's
heap.

As a function of the consumer's numbers — T live sandboxes (turns) on a worker, R runs in flight,
R ≈ T × E / (E + P) on average for an `exec` of E and a pause P between `exec`s, R = T at the peak
(every turn runs at once):

| | worker memory beyond its one template | peak (R = T) | average, E 0.3 s, P 10 s | average, P 1 s |
|---|---|---|---|---|
| v1 | R × 107–115 MiB (each run's isolate holds the template; floor) | T × ~110 | T × ~3.3 | T × ~25 |
| v1b | R × 27–39 | T × ~35 | T × ~1 | T × ~8 |
| v2 | T × ~150 (RSS) + R × the run's garbage | T × ~150+ | T × ~150 | T × ~150 |
| v2b | T × ~45–57 (RSS) + R × the run's garbage | T × ~50–90 | T × ~50 | T × ~50 |
| v3 | T × 0.5 + R × 23–31 | T × ~30 | T × ~1.3 | T × ~7 |

Floors and RSS are different units; measured RSS of 4 sandboxes running xlsx at once, 5 rounds
(§burst, one process per arm, start 363 MiB): peak +716 MiB v1, +759 v2b, +1 052 v2, +352 v3.
So **at the peak v2b ≈ v1**; v2b costs more only on average, while turns sit idle — ~50 MiB per
idle turn against ~0. On macOS a worker's RSS stays at its peak after the burst in every arm (v1
+716 MiB with all isolates disposed), so the 256 MiB idle-retire line (`protocol.ts`
`RECYCLE_RSS_BYTES`) is crossed by v1 after any burst too — but a v1 worker holds no state and can
be retired; a v2 worker cannot without moving its sandboxes. Linux not measured.

## Host op (`life.out.txt` §host, §ipc; worker side, median of 201)

| | `writeFile` 10 KiB | `readFile` (pdf, 1.4 KB) | `list('/workspace')` |
|---|---|---|---|
| v1 (in the consumer, synchronous) | 0.002 ms | 0.001 | 0.001 |
| v2 (a call into context A) | 0.009 + IPC | 0.005 + IPC | 0.068 + IPC |
| v3 (the worker's FS) | 0.001 + IPC | 0.001 + IPC | 0.000 + IPC |

IPC round trip, a JSON line each way (today's transport shape, bytes base64): 0.015 ms empty,
0.025 ms with 10 KiB, 6.4 ms for 1 MiB (`ipc.mjs`; the pool's real frames and a loaded event loop
not measured).

## Contract (`life.out.txt` §life)

| | v1 | v2 | v3 |
|---|---|---|---|
| L1 between `exec`s: globals, prototypes, `require` cache, `process.exitCode`, `exit` listeners, `env`, cwd, `Error.stackTraceLimit` | fresh | fresh (new context) | fresh |
| L2 guest reaches the FS realm through what `fs` hands back | — | no: stats, bytes, errors are the run realm's own objects (copying membrane) | — (host functions) |
| L3 a V8-internal task queued before `process.exit()` (`WebAssembly.compile(...).then(write)`) | its write lands in the captured state (the declared class «work queued at `process.exit()` runs») | lands in A (same class) | does not run (isolate disposed at the end) |
| L3, the same 30 compiles deep | does not run | does not run, even with no guard, after 300 ms–1.5 s gaps | does not run |
| L4 timeout: sync loop, microtask loop, loop in a timer, pending wait | rollback: `before.txt` absent | isolate alive, next `exec` runs; files kept as Node keeps them (`before.txt` kept) | files kept |
| L5 killed inside FS work (writes + renames + `rm` + `cpSync`), 40 trials; L5b 64 files renamed back and forth, killed at 20–117 ms, 200 trials | — | 0 inconsistent trees, 0 lost files | — (a host call is not interruptible) |
| L6 out of isolate memory (limit 256) | rollback, sandbox alive | **isolate disposed: the sandbox and all its files gone** | files kept (`before.txt`), next run gets a fresh isolate |
| catastrophic OOM (`new Array(2 ** 28).fill(0)`) in one sandbox's run, 3 live sandboxes in the process | (step 0: the worker dies; runs in flight rerun from consumer bytes) | **process aborts (exit 134): every live sandbox on the worker gone** | same as v2 for the files the worker holds |
| L7 a restore point for v2 (capture of A's state after an `exec`) | — | 0.4 ms, 2 976 B (pdf sandbox); rebuilding the sandbox from it: 27 ms | (LayeredFs `toWire` in the worker, not timed) |

A one-off: the long run (§cost → §retain, ~1 000 isolates including floor bisection's OOM
disposals) ended in a segmentation fault of the probe process at §retain v2 xlsx; three isolated
reruns of §retain and one after did not reproduce it. Not attributed to an arm; a worker that
crashes this way is a lost worker for every arm (v1 reruns, v2/v3 lose their live sandboxes).

## What each variant removes and adds (machinery)

- **v1** (ADR-0568 + ADR-0572 as proposed, mostly not built yet): per `exec` the state crosses both
  ways (blob + `lazy`/`ref` rows, row validation ADR-0572 §5, cap = codec count), `LayeredFsSync` in
  the consumer and in the guest, the touched-entries bound of the consumer's FS (open user fork),
  capture in the guest's realm (open unit `capture-outside-guest-realm`), template copy per run,
  the binary template frame and per-worker template cache.
- **v2** removes: the per-`exec` state wire and its validation, the consumer's FS and its
  touched-entries fork, the template copy per run, the capture in the guest realm (the files never
  are in a guest realm: the capture unit closes by construction, as long as the membrane holds).
  Keeps: the template intake, binary frame and worker cache, one `LayeredFsSync` (in A), `EROFS`
  (LayeredFs's refusal). Adds: sandbox → worker affinity and a host-op protocol (every
  `writeFile`/`readFile`/`list`/`remove` an IPC call to that worker), a per-sandbox isolate
  lifecycle in the worker, a deadline without dispose (per-call isolated-vm timeouts + context
  release), reference hygiene per run realm (else the leak above), a sandbox-life `memoryLimit`, the
  worker's RSS accounting of live sandboxes, the cap checked inside A at the write (an `ENOSPC`-like
  refusal instead of `stateRefused`). To keep ADR-0568 I1 («no ending of a run loses the sandbox»)
  it needs a restore point outside the worker after every mutation — which brings back the
  state-out half of today's wire (blob + rows + validation, for a rebuild) and a rebuild path.
- **v2b+rp**: v2's list, minus the state-in half per `exec` (it is the rebuild path, run only on a
  kill / OOM / lost worker / eviction); the killed run is rolled back by the rebuild, as today, so
  a timeout never depends on A's FS surviving a cut mid-operation. The capture-unit candidate «a
  fresh realm over the guest's FS records» (`isolate-host-sandbox-capture-outside-guest-realm`) is
  this design's two-realm split, without the per-`exec` copy.
- **v3** removes what v2 removes and the template in any isolate; adds: ~12 synchronous host
  functions taking guest-chosen paths and bytes (the FS becomes part of the exposed seam the user
  wants hardened), per-call copies (ranged FS operations needed against chunked I/O), the same
  affinity / host-op protocol, and, for I1 under worker loss, the same restore point.

## Invariants (ADR-0568 I1–I9 and the goals) — who said what

User's words: «в пределах одного прогона агента один экземпляр живёт через write → exec → ошибка →
fix → exec» (2026-11-17); «не нужно давать настоящую fs» (2026-11-22); «харденинг нужен только на
внешнем шве: выставленные хостовые функции…» and «Владелец ФС живёт в том же realm, что и гость
(внутри isolate)» (requirements 2026-11-17); F4 rollback of a killed run «оставим как есть»
(2026-11-25, chosen as the cheap option over keeping); persistence between turns deferred
(2026-11-25); «Изолейты — быстрые короткоживущие (один ход агента) рантаймы» (2026-11-25).
Manager/agent decisions: fresh isolate per run with restore + capture and rollback (ADR-0568 §Not
the user's words), the I-list's wording, one op at a time.

| | v2 | v3 |
|---|---|---|
| live-sandbox Outcome «between operations the sandbox is bytes held by the consumer» | changes (bytes only as a restore point, if kept) | changes |
| I1 no ending loses the sandbox; killed run rolled back | OOM / worker loss lose it unless a restore point; timeout keeps partial writes (Node) unless rebuilt from the point (F4 asked again) | worker loss loses it unless a restore point; OOM and timeout keep partial writes (Node) — F4 asked again |
| I2 fresh process per run | holds (context per run; L1) | holds |
| I5 destroy | simpler: dispose the isolate | drop the worker FS + dispose the run |
| I6 «an idle sandbox holds no process and no isolate» | breaks by definition | holds no isolate; holds worker memory |
| I7 trust | unchanged seam; the FS realm shares the guest's isolate | the FS becomes exposed host functions |
| «Владелец ФС … в том же realm (внутри isolate)» | same isolate, another realm | breaks (FS in the worker) |
| template I4/I5 cost independence | `exec` latency independent of the template from the 2nd `exec` on; v2: idle memory includes the template; v2b: only what was touched | independent; slower per FS call |
| template open fork (touched-entries bound in the consumer) | gone from the consumer, moves into the live isolate's memory | gone from the consumer, into the worker's |

## Not verified

- Termination inside an FS operation of A (v2): 240 kills, no inconsistency — not excluded by
  construction (V8 can terminate between two statements of A's code). Carrier: a mutant-style
  probe that kills at every interrupt point of a `renameSync`/`cpSync`.
- v2 on the real pool (worker frames, affinity, IPC under load); ipc.mjs is a bare pipe.
- v2 idle memory after V8's memory reducer runs (committed heap 31–60 MiB may shrink; used is
  10–14).
- Template bytes / entries sweep (T1 vs T95) for v2/v3; only the four-library template here.
- The segfault's cause.
- Linux (the deployment target) — every number here is macOS.
- v3's chunked I/O on the agent's files (template probe L measured it on T1).
- The epoch guard of v2 (a released context's late FS call): no probe made a released context run
  later, so the guard was never exercised (`staleCalls` 0).
