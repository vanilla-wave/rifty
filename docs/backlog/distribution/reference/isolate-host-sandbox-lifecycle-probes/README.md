# Lifecycle revisit probes — fresh isolate per `exec` vs live isolate per sandbox vs FS in the worker

Input for the user's revisit (2026-11-25) of ADR-0568's «a fresh isolate per `exec`, the state =
bytes in the consumer». Disposable probes; `packages/*/src`, ADRs and goals untouched.

Raw output: `life2.out.txt` (round 2, current: macOS, `memoryLimit` 256 unless a row says
otherwise), `life-linux.out.txt` (round 2 on Linux), `life.out.txt` (round 1, limit 1024, kept for
history — its v2 used an unsafe boundary, see «Boundary»). macOS: Apple M3 Pro, 12 cores, load 2–6
(per row). Linux: colima VM aarch64, 4 CPUs, 7.7 GiB, container `node:24.16.0-bookworm` `--cpus 4
-m 6g`, on the same Mac (host load ~2–4). Node v24.16.0, isolated-vm 7.0.2, main @ `bc3412420`.

```sh
mkdir -p /tmp/life-probe/deps && cp ../isolate-library-probe/deps/package*.json /tmp/life-probe/deps/
(cd /tmp/life-probe/deps && npm ci --ignore-scripts)        # 8 000 files, 86.6 MB, 8 792 entries
pnpm --filter @riftydev/isolate-guest build
P="node --no-node-snapshot --expose-gc life.mjs /tmp/life-probe/deps/node_modules"
LIMIT=256 N=7 $P cost conc ; $P floor ; LIMIT=256 $P heap retain rebuild turn ; $P escape life host
ARMS=v2bs MEMW=mix K=6 LIMIT=256 $P mem ; ARMS=v1 LIMIT=256 $P burst     # one process per arm
$P cata                                   # aborts the process (expected)
node ipc.mjs
# Linux: LIFE_PREBUILT_OUT=<dir> $P prebuild ; ./linux.sh <node_modules> <dir> cost conc ...
```

`life.mjs` drives isolated-vm and the guest bundle (real entry + the template probes'
`probe-guest.ts` + `life-guest.ts`) worker side; the template FS is the template probes'
`layered.ts` (ADR-0572 §2). No pool, no consumer process: consumer ↔ worker IPC is `ipc.mjs`
apart; «consumer» steps (validation, base64) run in the same process.

## Arms

| arm | isolate | the files between `exec`s | template |
|---|---|---|---|
| v1 | fresh per `exec` | bytes in the consumer (ADR-0568) | copied into each run's isolate (ADR-0572 F1 (a)) |
| v1w | v1 from a pre-warmed spare: bundle booted + template copied + indexed off the `exec`'s path | same | same, ahead |
| v1b | fresh per `exec` | same | lazy, 2 host functions (F1 (b), deferred) |
| v2s | one per sandbox for its life: context A holds the FS, each `exec` a new context B | A | copied into A once |
| v2bs | same | A | lazy from the worker, cached in A |
| v3 | fresh per `exec` | the worker's realm (a `LayeredFs` per sandbox over the worker's one template); every guest `FsSync` call one sync host call | worker only |
| v2bs+rp (`turn`) | v2bs + a restore point (A's state: blob + rows) validated and kept by the «consumer» after every mutating `exec` / host write; a killed, OOM'd or aborted run is rolled back by rebuilding from it | A, + the point | lazy |

`v2` / `v2b` (round 1) are v2s / v2bs with the unsafe boundary; they stay in the code to show it red.
Host disk (ADR-0568 B) is not built: rejected by the user.

## What the numbers say (no recommendation)

v2bs trades memory that grows with every open turn (55–105 MiB each, Memory) for a faster repeated
`exec` (21–104 ms against v1, 32–149 ms with pauses; Cost); its first `exec` is not faster, its
correctness needs a restore point, a rebuild path and a guard against dead realms (§haunt).
v1w removes only v1's fixed cost, at 2× v1's memory and only when its spare is ready. v2's remaining
gain over v1w is V8's in-isolate compile cache; whether a fresh isolate can get it is open. Which
side matters depends on the strategy (an isolate per turn or per run) and on the load (open turns vs
concurrent runs) — the user's.

## Boundary (v2): what crosses between the FS realm A and a run realm B (§escape)

Round 1's membrane handed B objects of A and deep-copied them with B's intrinsics: a guest that
replaces `Object.keys` gets A's objects, writes A's prototypes, and the next `exec` breaks (external
review's program, E0: `run2: mkdir -p FAILED ENOENT`).

v2s/v2bs's boundary (`life-guest.ts` «safe boundary»): **only primitives and fresh typed arrays
cross, read through internal slots.** B → A: a method name, a JSON string of the arguments, at most
one `Uint8Array` that B allocated and filled itself, and its length as a number. A reads that array
only with `ArrayBuffer.isView` + `%TypedArray%.prototype.set` (internal slots, no property lookup on
a B object). A → B: a JSON string; result bytes are copied by A into a `Uint8Array` B allocated
(`set` with B's array as `this`). Errors cross as JSON; an A exception escaping `serveSafe` (its
stack ran out) is caught in B and dropped unread. Every intrinsic either side uses is captured at
bundle evaluation, before any guest code in that realm (A never runs guest code). Chosen over
freezing A's intrinsics (breaks the runtime's own code by the override mistake — `VfsError` assigns
`this.name`) and over host-mediated copies (every FS call through the Node thread: v3's per-call
cost).

| §escape | v2 (round-1 membrane) | v2s | v2bs |
|---|---|---|---|
| E0 `Object.keys` hook → A's prototype → next `exec`'s `mkdir -p` | **planted, run 2 ENOENT** | no A object reached, run 2 ok | same |
| E1 hooks on 31 intrinsics (`Object.*`, `Array.*`, `JSON.*`, `Reflect.*`, typed-array / Map / Set / Promise methods), accessors on `Object.prototype` for 19 keys, `Symbol.species` on 4 constructors, Proxy data / options, getter with `.caller`, thenable options, every fs op incl. fd, stack exhaustion (3 956 frames macOS, 65 248 Linux) calling fs while unwinding, callback / promise / stream reads: foreign objects reached | **6** (`map`, `isView`, `isArray`, `keys` args; `readdir` result; the stack-overflow error of A) | **0** | **0** |
| A's intrinsic prototypes after E1 (host-side fingerprint of 15 roots) | **changed** | unchanged | unchanged |

Linux: the same. Not a proof: V8 bugs and paths not enumerated remain; a third realm-separation
mechanism (a separate isolate for A) would be by construction and costs v3's per-call price.

## Cost (§cost, ms, median of 7 warm repeats in one sandbox, `memoryLimit` 256)

macOS (`life2.out.txt`):

| `exec` | v1 | v1w | v1b | v2s | v2bs | v3 |
|---|---|---|---|---|---|---|
| empty file | 29.6 | 8.7 | 16.5 | 7.8 | 8.0 | 15.3 |
| pdf | 210 | 190 | 209 | 161 | 159 | 255 |
| docx | 180 | 159 | 179 | 140 | 135 | 172 |
| pptx | 315 | 294 | 308 | 281 | 282 | 323 |
| xlsx | 459 | 430 | 490 | 362 | 355 | 619 |
| first `exec` of a sandbox, pdf / xlsx (+ create) | 214 / 468 | 195 / 433 | 204 / 511 | 211 + 23 / 475 + 25 | 211 + 10 / 489 + 11 | 268 / 638 |
| 4 sandboxes at once, wall, pdf / xlsx (§conc) | 303 / 566 | 304 / 579 | 280 / 659 | 266 / 579 | 274 / 582 | 366 / 893 |

Linux (`life-linux.out.txt`):

| `exec` | v1 | v1w | v1b | v2s | v2bs | v3 |
|---|---|---|---|---|---|---|
| empty file | 41 | 9.8 | 19.8 | 10.3 | 10.3 | 17.8 |
| pdf | 273 | 245 | 278 | 206 | 202 | 497 |
| docx | 219 | 189 | 221 | 167 | 170 | 204 |
| pptx | 382 | 359 | 386 | 348 | 362 | 431 |
| xlsx | 573 | 577 | 723 | 429 | 464 | 1 417 |
| first `exec`, pdf / xlsx (+ create) | 262 / 583 | 245 / 505 | 288 / 673 | 254 + 35 / 547 + 38 | 304 + 12 / 1 071 + 39 | 510 / 1 470 |
| 4 at once, pdf / xlsx | 540 / 1 019 | 569 / 1 006 | 492 / 1 149 | 474 / 948 | 464 / 987 | 770 / 2 325 |

- **Against plain v1 (what is built), v2bs is 21–104 ms faster per warm `exec`** (macOS: empty 29.6
  → 8.0, pdf 210 → 159, docx 180 → 135, pptx 315 → 282, xlsx 459 → 355; Linux: 41 → 10, 273 → 202,
  219 → 170, 382 → 362, 573 → 464). It buys that with memory that grows with every open turn
  (Memory below). Its first `exec` of a sandbox is not faster: v2s ≈ v1, v2bs slower on the lazy
  template's first reads (§think: Linux xlsx first 738–789 vs v1 618–724 ms).
- **v1w (a pre-warmed spare, not built) removes only v1's fixed cost**, at 2× v1's memory: its
  window (`ms`) is 8.7 ms on the empty file, but it excludes waiting for the spare (`life.mjs`
  `Fresh.exec` awaits `this.next` before `t.start`); the caller's wall is 8.9 → 24 ms back to back
  and 16.4 ms after a 300 ms pause (external review), and equals v1's whenever the spare is not ready.
  Its refill also competes with the measured run on few CPUs (Linux xlsx run phase 574 vs v1 537).
- **What v2 keeps over v1w is the run phase of a repeated `exec`**, 5–26 % shorter, and its cause is
  V8's in-isolate compilation cache (round-2 critic, rerun here and by the external review): with
  `--no-compilation-cache` v2s − v1w goes from −30 to −10 ms (pdf) and from −70 to −6 ms (xlsx). Whether
  a fresh isolate can get that gain (a V8 code cache for the template's sources) is an **open
  question, not probed** (below); it is not a measured substitute for the live isolate.
- **§think — a 1 s pause before every `exec`, arms interleaved, the caller's wall** (K = 5 turns ×
  (create + first + 2 repeats); macOS load 4.2–5.4, the Linux VM on a host at load 5–14):

| ms | v1 | v1w | v2s | v2bs |
|---|---|---|---|---|
| macOS pdf: first / repeat / turn | 293 / 273 / 828 | 280 / 271 / 806 | 273 / 237 / 760 | 274 / 241 / 750 |
| macOS xlsx: first / repeat / turn | 630 / 668 / 1 989 | 648 / 633 / 1 941 | 646 / 547 / 1 852 | 730 / 519 / 1 908 |
| Linux pdf: first / repeat / turn | 331 / 340 / 974 | 323 / 288 / 894 | 301 / 262 / 909 | 354 / 259 / 904 |
| Linux xlsx: first / repeat / turn | 655 / 635 / 1 922 | 631 / 636 / 1 886 | 578 / 568 / 1 736 | 746 / 554 / 1 891 |

  With pauses the repeated `exec` of v2 is 32–149 ms faster than v1's, v1w's gain over v1 mostly
  disappears, and a 3-`exec` turn is 2–10 % shorter on v2 (create and the first `exec` included).
  The external review's own run (pause 1 s, N = 7, load 3.4–5.2): pdf v1w 251, v1 273, v2s 219, v2bs
  217; xlsx v1w 511, v1 476, v2s 432, v2bs 388. Round 2's «per turn on Linux v1w 1.66 s vs v2bs 2.04
  s» rested on one first-`exec` sample (1 071 ms) and is withdrawn.
- The safe boundary costs ≤ 5 % against round 1's membrane (v2, same run: pdf 161 vs 159, xlsx 362
  vs 350, pptx 281 vs 269).
- Four at once (the worker's 4 slots) the arms converge (macOS xlsx 566–582 for v1, v1w, v2s, v2bs).
- v3 pays a host call per FS call on the worker's one thread: 1.2–2.5× slower on pdf/xlsx, worst on
  Linux (xlsx 1 417 vs 573); chunked I/O across it is quadratic (template probe L: 8 MiB 259 vs 64 ms).
- v1 also moves the sandbox's own files both ways per `exec` (3 KB here): an input of S MiB costs the
  codec + base64 each way per `exec` (§rebuild's steps for 8 MiB: capture 8, wire out 1.4, validate
  8.8, wire in 1.3–3.2 ms ≈ 2.5 ms / MiB each way); v2bs+rp pays the out-half after each mutation.
- Heap of one live sandbox at limit 256 over 40 `exec`s (§heap): used 16–204 MiB, collected inside
  the limit, `exec` time mostly flat (pdf 157–182 ms; xlsx 347–415, one 500); 60 / 60 pass at 160 / 192 (round 1
  §retain). With the isolated-vm `Reference`s into each run realm left unreleased (`LEAK_REFS=1`)
  the sandbox dies out of memory after 11–13 `exec`s (round 1): every handle into a run realm must be
  released.

### v1 with v2's two realms (§tworealm)

The capture unit (`capture-outside-guest-realm`) does not need a live isolate: a fresh isolate per
`exec` can hold the FS in context A (restored from the state) and run the guest in context B behind
the same boundary, capturing from A. Same run, macOS load ~4, ms: empty 31 → 40 (copy) / 24 (lazy),
pdf 225 → 243 / 238, docx 192 → 196 / 185, pptx 313 → 331 / 317, xlsx 454 → 509 / 514 — +2…+12 %
for the copy form (one more bundle boot + the boundary), off the path if pre-warmed (v1w). The
two-realm timing includes the isolate's `dispose()`, the v1 reference does not (a small bias against
two realms). The same split would let v1 keep a killed run's partial writes as Node does (capture A
after a deadline instead of rolling back) — not measured; F4 was answered «rollback» as the cheap
option.

## Memory

Smallest passing `memoryLimit` (create + 3 `exec`s, 4 MiB steps; v2's is the sandbox's whole life),
macOS = Linux ±4: empty 103 / 107 / 19 / 107 / 19 / 19 (v1 / v1w / v1b / v2s / v2bs / v3), pdf 107 /
107 / 27 / 111 / 27–31 / 23, xlsx 115 / 115 / 39 / 115–119 / 39 / 31. At the default 256 the guest
code keeps ~140 MiB where the template is copied (v1, v1w, v2s), ~220 elsewhere.

Idle sandbox, isolate statistics (used heap / committed heap / external) and RSS delta per sandbox
(K = 6, one process per arm and workload; RSS includes allocator retention — v1 shows +21 MiB
holding nothing):

| idle after | v2s | v2bs | v3 (worker heap) | v1 / v1b |
|---|---|---|---|---|
| pdf | 17 / 36 / 99 MiB, RSS +139 | 15 / 22 / 19, RSS +48 | 0.4 MiB | state 3.1 KB in the consumer |
| xlsx | 22 / 36 / 101, RSS +146 | 18 / 29 / 22, RSS +62 | 1.3 | 10 KB |
| pptx | 21 / 28 / 97, RSS +132 | 11 / 21 / 18, RSS +47 | 0.3 | 84 KB |
| the 4 generators in a row | 27 / 39 / 101, RSS +154 (Linux +155) | 34 / 44 / 47, RSS +105 (Linux +112) | 1.6 | 96 KB |

After a GC inside each idle isolate (`life2.out.txt`, last «mem» block): v2bs pdf 4.7 used / 16.7
committed / 16.8 external, the 4 generators 10.2 / 28.6 / 45.1; v2s 7.9 / 19.2 / 96.8 and 12.5 /
28.8 / 96.9. External = template bytes cached in A for the sandbox's life (a design choice: dropping
the cache re-reads per `exec`, v1b's cost).

**An idle v2bs sandbox grows with the libraries its turn touched: 22–34 MiB after one generator
(after GC: used + external … committed + external), 55–74 MiB after all four (RSS +105–112 before
GC, RSS not returned).** v1w's spare (bundle + template, ~107 MiB floor,
RSS +133–141 in this probe, one spare per sandbox here; in a pool, one per slot) is the price of v1's
fixed-cost cut.

Peak RSS of a worker, 4 sandboxes running xlsx at once, 5 rounds (§burst, start ~345–363 MiB):

| | v1 | v2bs | v2s | v3 |
|---|---|---|---|---|
| macOS peak / at rest after dropping the sandboxes (v1, v3: round 1, limit 1024; v2bs, v2s: round 2b, 256) | +716 / +716 | +611 / +537 | +1 024 / +933 | +352 / +352 |
| Linux | +395 / +395 | +662 / +543 | +978 / +508 | +311 / +311 |

RSS stays near the peak after the burst on both systems in every arm (allocator retention): a worker
that has run 4 template runs at once sits above the 256 MiB idle-retire line
(`protocol.ts` `RECYCLE_RSS_BYTES`) in v1 too — but a v1 worker holds no state and can be retired; a
v2 worker holds live sandboxes.

### As a function of the consumer's numbers

T open turns (live sandboxes) and R_max concurrent `exec`s the consumer allows, per worker set,
beyond one template per worker. Per-unit figures: isolate floor for a run (v1 107–115, v1b 27–39, v3
23–31), idle sandbox after the 4 generators (v2s ~125–155, v2bs ~55–105: after GC … RSS, v3 ~1.6), a run's own garbage in a
live isolate ≤ ~40 (floor xlsx − empty, v2bs).

| | formula | T 4, R 4 | T 20, R 4 | T 20, R 8 | T 100, R 8 |
|---|---|---|---|---|---|
| v1 | R × 115 | 0.45 GiB | 0.45 | 0.9 | 0.9 |
| v1w | (R runs + R spares) × 115 | 0.9 | 0.9 | 1.8 | 1.8 |
| v1b | R × 39 | 0.15 | 0.15 | 0.3 | 0.3 |
| v2s | T × (125–155) + R × 40 | 0.6–0.8 | 2.6–3.2 | 2.8–3.3 | 12.5–15.5 |
| v2bs | T × (55–105) + R × 40 | 0.4–0.6 | 1.2–2.2 | 1.4–2.4 | 5.7–10.6 |
| v3 | T × 1.6 + R × 31 | 0.13 | 0.15 | 0.27 | 0.4 |

v1 does not depend on T at all; v2 grows with every open turn whatever the pause between `exec`s.
v2bs ≤ v1 only while T ≈ R (every open turn runs at once). Idle eviction (capture + dispose after X s
without an op, rebuild on the next one, 12–43 ms) caps v2's T-term at the turns active within X s.

## Host op (§host, §ipc; worker side, median of 201)

v1: synchronous in the consumer, 0.001–0.002 ms (`writeFile` 10 KiB, `readFile` pdf, `list`). v2: a
call into context A, 0.005–0.07 ms + IPC; v3: 0.001 ms + IPC. IPC round trip, a JSON line each way
(today's transport shape, bytes base64): 0.015 ms empty, 0.025 ms with 10 KiB, 6.4 ms for 1 MiB
(`ipc.mjs`, a bare pipe). v2bs+rp adds the restore point to every mutating host op: 0.2–4 ms in §turn
(1 MiB in the state), ~2.5 ms / MiB of state.

## Contract

| | v1 | v2s / v2bs (no restore point) | v2bs+rp (§turn) | v3 |
|---|---|---|---|---|
| between `exec`s: globals, prototypes, `require` cache, `process.exitCode`, `exit` listeners, `env`, cwd, `Error.stackTraceLimit` (L1) | fresh | fresh (new context); the FS realm unreachable (§escape) | same | fresh |
| a V8 task queued before `process.exit()` (one `WebAssembly.compile(...).then(write)`, L3) | its write lands in the captured state (declared class «work queued at `process.exit()` runs») | lands in A | same | does not run |
| timeout (sync loop, microtasks, timer loop, pending wait, L4) | rollback | isolate alive, partial writes kept (Node) | rollback by rebuild: 13–15 ms, `partial.txt` gone, earlier `out.pdf` kept | partial writes kept |
| killed inside an FS operation of A (L5/L5b, 240 kills) | — | 0 inconsistent trees; not excluded by construction | n/a: rebuilt from the point | a host call is not interruptible |
| out of isolate memory (L6) | rollback | **the sandbox and all its files lost** (v2, v2bs) | rollback by rebuild: 23–29 ms | files kept |
| a run ends (`process.exit`) with 30 chained `WebAssembly.compile` pending and 50 MiB live (§haunt, round-2 critic's probe) | gone with the isolate | **its realm stays alive: +51 MiB used heap after GC in the next 4 `exec`s** (62.7 vs 11.5); with 170 MiB the next run is a spurious `memory` and the sandbox is lost | same retention; a spurious `memory` → rollback. Needs a heap watermark → rebuild, not built | gone with the isolate |
| `AbortSignal` mid-run | rollback (#431) | — | rollback by rebuild: 14–15 ms | — |
| catastrophic OOM in one sandbox's run (§cata) | worker aborts (exit 134 macOS, 133 Linux); ≤ 4 runs in flight rerun from consumer bytes | **every live sandbox on the worker lost** | every sandbox of the worker rebuilt from its point elsewhere | same as v2 for the worker's FSs |
| ordering, host ops + `exec` issued without awaiting | one chain per sandbox | — | one chain; `readBack: seq` | — |
| `destroy` mid-run | `DESTROYED` for the run and later ops | — | same: both `ERR_ISOLATE_HOST_SANDBOX_DESTROYED`, isolate disposed | — |

`turn` runs in one process: no pool, no IPC, no lost-worker path; the restore point is validated by
decoding it (`restoreFs`) and rebuilding its rows over the template index.

Rebuild from a restore point (§rebuild, v2bs, macOS / Linux): state 3 KB → 11.6 / 13.6 ms to ready
(capture 0.5, validate 0.1, new isolate + A + restore 11–13); 1 MiB → 16 / 19; 8 MiB → 37 / 43
(capture 7–8, validate 9, base64 both ways 2.7–4.6, rebuild 18–21). v2s (template copied): +13 ms.

Two probe processes died in long multi-arm runs, neither reproduced on rerun: a segmentation fault
(round 1, §retain v2 xlsx after ~1 000 isolates) and a silent death (round 2, §cost after docx v1b,
the first stage of a pipe, no stderr kept). Not attributed to an arm; a crashed worker is a lost
worker for every arm.

## Blast radius in the pool (ADR-0563: `SHARD` = 4 calls per worker, idle retire at 256 MiB RSS)

- v1: a crashed worker loses ≤ 4 runs in flight; each reruns alone from consumer bytes (ADR-0563
  §6); idle sandboxes are not on any worker. Retiring a worker needs nothing.
- v2 without a restore point: every sandbox pinned to that worker, idle ones included, is lost. With
  v2bs at 55–105 MiB idle, a worker holding T_w sandboxes loses T_w turns' files.
- v2bs+rp: the same crash costs T_w rebuilds elsewhere (12–43 ms each + IPC of the point) and reruns
  of the runs in flight from their points (the point is the state before the run, so a rerun is
  idempotent). Retiring a worker (RSS line, recycle) = moving its T_w sandboxes the same way; the
  idle-retire line has to count live sandboxes (a worker with the template ~130–150 MiB + one idle
  v2bs sandbox 55–105 already crosses 256).

## What moving to v2bs+rp redoes and reuses (merged code)

Redone: `isolate-host/src/sandbox.ts` (726 lines: the consumer-side FS decoded from bytes, host ops
synchronous on it, the cap by encoding, a run = a pool call with state in and out) → host ops become
RPCs to the sandbox's worker, the consumer keeps only the point; `pool.ts` placement (any free slot
→ affinity sandbox → worker, a lost worker → rebuild elsewhere instead of a plain rerun, retire with
migration); `child/main.ts` (per call fresh isolate → per-sandbox isolates + per-`exec` contexts,
deadline without dispose, rebuild, handle hygiene); `protocol.ts` (frames: sandbox open/close, host
op request/result, point); the guest contract (ADR-0558: two realms, the boundary, `installSafe`);
the tables `sandbox-destroy-table` (every end × destroy moment: the `gone` event changes),
`sandbox-abort-table` (#431: abort → rebuild), `sandbox-faults` (worker loss → rebuild), much of
`protocol.test`. New, not in today's code: the realm-leak guard (§haunt: a heap watermark after each
`exec` → rebuild), per-worker memory admission and idle eviction, host-op timeouts, handle hygiene
per run realm. Kept: the public API and its shapes (`createSandbox` … `destroy`, `AbortSignal`,
`stateRefused`), `sandbox-acceptance` at the API level, ADR-0567's codec (the point's format),
`runCode` unchanged. Template layer (ADR-0572, mostly unbuilt): kept — intake and identity (§1, §4),
binary frame and per-worker cache, `LayeredFsSync` (one side: A; the consumer only validates rows),
the rows and their validation (§5, now for the point), read-only `EROFS`, changed paths (§7, in A),
probe G/S oracles; dropped — the consumer-side FS and its touched-entries fork, the per-`exec` state
in, the template copy per run, the capture in the guest's realm (the unit
`capture-outside-guest-realm` closes if the boundary holds).

Not built on v1's side either (so not a transition cost of v2): v1w's spares, the two-realm capture,
ADR-0572's consumer-side FS and its touched-entries fork, the per-`exec` row transport — all ADR-0572
map items still ahead; v2bs+rp drops the consumer FS and the per-`exec` state-in, keeps the rest.

## Browser hosts, for the comparison (by code)

- COI (workbench): one persistent owner Worker holds the FS (OPFS); every `node` is a fresh kernel
  Worker, a fresh realm, reaching the FS synchronously over a SharedArrayBuffer RPC. A killed
  process's writes stay. Closest to v3 (FS outside the process, fresh process).
- no-COI (toolchain Worker): the FS in the long-lived toolchain Worker; `node` runs in place in that
  reused realm. Per invocation only these are put back: the `require`/`module`/`exports`/
  `__filename`/`__dirname` bindings (`runtime-js/src/module-loader/loader.ts` `captureNodeProcessGlobals`),
  `env`/`argv`/`execArgv`/`exitCode`/cwd and stdout/stderr `write`
  (`workbench/src/workers/no-coi-project-command.ts:185-195`); its timers, process/stdio listeners and
  children are retired (`no-coi-invocation-scope.ts`). Arbitrary globals and prototype edits carry
  to the next `node`; the realm is replaced only when a binding cannot be restored or a handle
  outlives the drain (ADR-0445). Isolation between runs is weaker than v2s's (a fresh context per
  `exec`). A killed process's writes stay.

## Invariants (ADR-0568 I1–I9 and the goals) — who said what

User's words: «в пределах одного прогона агента один экземпляр живёт через write → exec → ошибка →
fix → exec» (2026-11-17); «не нужно давать настоящую fs» (2026-11-22); «харденинг нужен только на
внешнем шве…» and «Владелец ФС живёт в том же realm, что и гость (внутри isolate)» (requirements
2026-11-17); F4 rollback «оставим как есть» (2026-11-25, chosen as the cheap option); persistence
between turns deferred (2026-11-25); «Изолейты — быстрые короткоживущие (один ход агента)
рантаймы» (2026-11-25). Manager/agent decisions: fresh isolate per run with restore + capture and
rollback (ADR-0568 §Not the user's words), the I-list's wording, one op at a time.

| | v2bs+rp | v3 |
|---|---|---|
| live-sandbox Outcome «between operations the sandbox is bytes held by the consumer» | the consumer holds the point (bytes); the live state is in the worker — wording to change | changes |
| I1 no ending loses the sandbox; killed run rolled back | holds by rebuild (measured in one process) | holds only with a point; kills keep partial writes unless rebuilt — F4 asked again |
| I2 fresh process per run | holds (context per run, §escape) | holds |
| I5 destroy | dispose the isolate | drop the worker FS + dispose the run |
| I6 «an idle sandbox holds no process and no isolate» | breaks (~50–110 MiB per idle turn) | holds no isolate; ~1.6 MiB of worker memory |
| I7 trust | the seam unchanged; A shares the guest's isolate (a V8 bug reaches it) | the FS becomes exposed host functions |
| «Владелец ФС … в том же realm (внутри isolate)» | same isolate, another realm | breaks |
| template open fork (touched-entries bound in the consumer) | gone from the consumer; the idle isolate grows with the libraries touched instead | gone from the consumer, into the worker |

## Open questions (recorded, not probed)

- A V8 code cache for the template's sources in fresh isolates: can isolated-vm hand a function
  compiled host-side with cached data into the guest's realm, and can runtime-js's loader use it? The
  only route by which v1 could get v2's repeated-`exec` gain.
- Every module compiled twice: `runtime-js/src/module-loader/cjs-factory.ts:52-64` (a checking `new
  Function` of the source, then the wrapper) — a cheaper candidate for part of the same gain.
- A cheap guard against §haunt for v2: synchronous compilation instead of async
  `WebAssembly.compile`/`instantiate` in the guest runtime (pending V8 tasks keep a dead realm alive);
  else a heap watermark → rebuild.
- v2bs+rp in the real pool (affinity, IPC under load, lost worker → rebuild, retire with migration).
- Linux x64 (only arm64 in a VM here).

## Not verified

- v2bs+rp on the real pool: affinity, IPC under load, lost worker → rebuild elsewhere, retire with
  migration; `turn` is one process.
- Termination inside an FS operation of A (v2 without a point): 240 kills, no inconsistency — not
  excluded by construction; v2bs+rp sidesteps it by rebuilding after every kill.
- The boundary beyond the enumerated attacks (§escape) and V8 bugs.
- The cause of the repeated-`exec` run-phase gain in a live isolate.
- The two crashed probe processes.
- v1 two-realm with partial writes kept on a timeout.
- Template sweep (T1 / T95) for v2/v3; only the four-library template.
- Linux on bare metal (the VM shares the Mac's CPUs; v3's host-call cost is worst there).
- v1w in a pool (spare count per worker, refill under bursts).
