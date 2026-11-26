# Map — node-streams-as-in-node

Route B (ADR-0575): the stream core and fs streams are Node v24.16.0's own sources, and rifty owns the
bindings. Probe: `reference/` (README, programs, `route-b/`, `results/summary.txt`, `results/route-b-*.txt`).
In-process rows (`results/*.txt`, `summary.txt`) run at `e96e93a0d`: main `4f6fa7d98`'s product code (this
branch changes only docs and a compat inventory generator). Chromium results name their own main commit.

## Items

Status (the manager, round 4): **ready** — 0, 2, 3, 4 (none depends on route B or the budget).
**Done** — 1 (PR #462), 4b (PR #457).
**Ready** — 8a (PR #471, held for 8c). **Draft** — 4c, 5, P, 7, AL, 8b, 8c, 9r, 9w; each carries «Open findings (review round 4)»
verbatim, closed when the unit is taken into work.

- **0** `runtime-js/node-streams-acceptance-carrier` — **done**: PR #467. The 10 `c-*` programs on the
  isolate host (`packages/isolate-host/tests/streams-scenario.test.ts`), and those plus `m1`–`m10`,
  `w1`, `b1` on Workbench and SDK (`tests/{browser-unit,no-coi}/streams-scenario.spec.ts`), each
  pinning today's whole outcome against live Node and naming its owners. Programs' one source:
  `packages/isolate-host/tests/fixtures/streams-scenario/`. Declared skips, tied to 4c by markers:
  `c-transform-big` on Workbench, the `m5` 16 MiB WriteStream row on Workbench and SDK. Chromium
  108: SDK import and Workbench owner boot fail by name (`runtime-js/chromium108-sdk-sync-wasm-import`,
  `runtime-js/chromium108-workbench-owner-arraybuffer-detached`). → I8.

Bindings and fs platform. Each is a parity fix that holds without the core, with its own proof
against Node:

- **1** ~~string-decoder-node-encodings~~ **done** (PR #462; item file deleted) — `string_decoder` latin1/ucs2/utf16le/base64/hex/ascii
  and every spelling Node accepts. An unknown encoding → `ERR_UNKNOWN_ENCODING`, not
  `NotImplementedError` (`b1`). Comes before 8 (B2: `m4` «through 'data'»). → I9.
- **2** `runtime-js/buffer-encoding-names` — `Buffer` entry points accept every name Node's
  `normalizeEncoding` maps (`'UTF8'`, `'LATIN1'`, …). Today `isEncoding` is true while
  `toString`/`from` throw (`b1`). → I9.
- **3** `runtime-js/events-add-abort-listener` — `events.addAbortListener` for guest code (`b1`).
  Independent of the core, which carries Node's own `abort_listener`. → I9.
- **4** `runtime-js/fs-callbacks-io-turn` — `fs` callback APIs complete in an I/O turn, so timers
  interleave with them (`m4` «fs.read(fd) loop»: Node `ticks>0=true`, rifty `false`; Workbench 0 ticks
  on every fd path, `results/chromium-fd/`). A write before close lands today, so that is a guard
  row. It has its own regression row. → I10.
- **4b** `runtime-js/fs-fd-read-by-range` — **done**: PR #457, ADR-0576, after-measurements `results/chromium-fd-4b/`. Positional fd reads move only the range. In Workbench
  today each 64 KiB call moves the whole file: 16 MiB in 18.5–26 s, against Node's 3 ms.
  Per host:
  - in-process and isolate (memory) read linearly already (a view, no copy);
  - the SDK reads quadratically (review round 3);
  - Workbench reads quadratically.

  It absorbs the read half of `perf/fs-rpc-chunk-perf` (its «Route 1»). Acceptance is
  by byte/RPC counter, with an explicit decision per implementation. → I10.
- **4c** `runtime-js/fs-fd-write-by-range` — positional fd writes move only the range. Today
  16 MiB takes 50–82 s in Workbench, and positional writes 114–199 s. The memory hosts are quadratic
  too, through memcpy: 4 → 16 MiB goes 7 → 101 ms in-process and 4 → 126 ms in the isolate
  (`results/fd-hosts.txt`). Same acceptance as 4b, plus Storage fault rows. It absorbs the
  `writeChunk` half of `perf/fs-rpc-chunk-perf`; that draft keeps its base64 write inflation. → I10.
- **5** `runtime-js/fs-writev-fsync` — `fs.writev`/`writevSync`/`fsync`/`fsyncSync`/`fdatasync`
  (`b1`). Without `writev`, Node's `WriteStream` sets `_writev = null`; without `fsync`, `flush: true`
  throws a misleading `ERR_INVALID_ARG_TYPE` (`streams.js:373-374`). → I10.
- **P** `perf/workbench-guest-write-cost-grows-with-project` — **publication cost per mutation**. In
  Workbench a write costs about +0.18 ms per project file (#453). The unit starts by establishing
  the cause, and its body is a hypothesis until then. 9w stands on it, because Node's `WriteStream`
  writes once per chunk.
- **7** `distribution/isolate-stream-core-abort-controller` — Node's `AbortController`,
  `AbortSignal`, `EventTarget`, `Event` and `CustomEvent` from Node's sources as ordinary isolate
  globals (the user's answer — recorded by the manager; `CustomEvent` with the four is the manager's
  decision on the Web API goal's question; the «private to the core» option is dropped and 7g is
  merged in). Without them, Node's `pipeline` fails in the isolate (`m7` 5/11 on the product build).
  The unit lives in this goal (manager's decision; its first consumer is Node's `pipeline`). Its
  acceptance includes invariant I3 of goal isolate-guest-web-api: WPT `dom/abort` and `dom/events`
  without `MessageChannel`/GC, the statics, `signal.reason instanceof DOMException`, Node APIs taking
  `signal` (goal isolate-guest-web-api on branch `origin/t3/isolate-web-api-goal` (PR #443, not yet on main)). → I7 (isolate).
- **AL** `runtime-js/stream-core-abort-listeners-host-event-target` — Node's core attaches abort
  listeners with `kResistStopPropagation`/`kWeakHandler`, which a host `EventTarget` ignores (browser
  hosts only; the isolate gets Node's own `EventTarget` from 7). Variants: (A) the direct listener as in
  the source, (B) a derived signal, (C) one patch point in the guest realm's
  `EventTarget.prototype.addEventListener`, (D) Node's classes as guest globals on browser hosts too.
  **No default candidate; the choice is open.** (A) is worse than today on two rows (a hang where today
  throws `TypeError`; strong listeners where Node's are weak), and a hang is not a declarable outcome
  (`docs/process/rules/fault-classes.md`). The probe runs (A) only as the measurement base. Rows `m9`,
  `m10` (`results/abort-variants/`). On browser hosts 8c stands on AL (edge 8c ← AL). The whole
  variants table is the user's question for browser hosts (§Open questions). → I1, I3.

Core, three adjacent PRs (ADR-0575 §7):

- **8a** `runtime-js/stream-core-node-sources-unwired` — **ready**, PR #471 (held for 8c):
  - vendored sources, license manifest entry, generator, bindings, zlib constants without the zlib
    module;
  - `internal/events/abort_listener` whole (variant A); AL decides the variant;
  - not wired: `check:arch` «no product importer» and 0 B on every bundle artifact;
  - a CI differential «Node's bindings = rifty's» over the rows `results/ownership.txt` gives to the
    core. Rows of landed owners equal; rows of 4, 5, AL and two binding findings (`post-guest-paths-use-replaceable-intrinsics`, `events-once-wrapper-bind`) pinned on today's rifty value with the owner (S7 closed in the unit). `zlib-diff`
    is not part of 8a: it is zlib unit 3's entry criterion, measured there after 8c.
- **8b** `runtime-js/stream-core-consumer-guard-rows`: regression rows for internal consumers
  and non-stream objects, green on today's core (§Regression risk).
- **8c** `runtime-js/stream-core-node-sources`:
  - wiring and consumer moves (`ServerResponse.write` → `false`; a stream shape `finished`
    accepts for `PortRegistrySocket`), and removal of `packages/io/src/streams`;
  - the es-floor extension;
  - identifier renaming changes 1 of 105 parity cases run (5 more skipped on both builds:
    stdin/eval/esm kinds; `results/route-b-minify.txt`): `stream/from-web-options`, whose V8 `TypeError`
    text names Node's `signal` inside `abort_listener` (variant A). The Workbench consumer bundle renames,
    so 8c either keeps identifiers in the module there or declares the row; a guard row runs
    `from-web-options` on that bundle. AL's variant can change this.

  Stands on 8a, 8b, 1, 2, AL and, in the isolate, 7. Absorbs 21 drafts. → I1–I3, I6, I7.

  Merge order: 8a and 8b merge only once 8c's PR is open and its CI differential is green, so the
  arrow 8a → 8b → 8c is the build order and the three merges are adjacent.

fs streams, split by side:

- **9r** `runtime-js/fs-read-stream-node-source` — `fs.ReadStream` from Node's
  `lib/internal/fs/streams.js`, which is loaded whole; only `ReadStream` is wired. Stands on 8c, 1, 4,
  4b and 7 (§Row ownership). In the meantime `fs.WriteStream` is today's class. Measured in-process
  (`results/route-b-9r/`): carrier 8/10 programs = Node, and backpressure into today's `WriteStream`
  holds (in-flight 65536). The two other programs fail on today's write class:
  - `c-graceful-fs` exactly as today;
  - `c-unzip-stored` changes, and that is declared: today it exits 0 with a silently empty directory;
    in the 9r window it exits 1 with `TypeError: Class constructor FileWriteStream cannot be invoked
    without 'new'`. A loud error replaces a silent wrong result.

  The window rows are pinned (§Regression risk, windows). → I4, I8 (read programs).
- **9w** `runtime-js/fs-write-stream-node-source` — `fs.WriteStream` from the same file. Stands on
  8c, 4, 4c, 5 and the publication cost unit P (§Row ownership). It comes after 9r by order: the table's
  «9w ← 9r» rows are an artefact of the last-owner rule, not a code dependency. Today's 16 MiB write stream on Workbench takes 518 ms,
  and it stays so until 9w. → I5, I8 (write programs).

The graph is derived from `results/ownership.txt` (`ownership.mjs`), not from this prose: a row with
two or more units is an edge. Its summary is under §Row ownership.

Implementation order once the goal is ready:
- 2 → 1 (one normalisation point), 3 independent → 4, 4b → 7 → AL → 8a → 8b → 8c → 9r;
- in parallel and after: 4c, 5 and P (publication cost), then 9w after 9r;
- 7 comes before 8c: the isolate's pipeline rows need it, and `pipeline` works there today. The
  user's answer decides only its globals.

Probe totals on route B, in-process (`summary.txt`):

| | equal to Node |
|---|---|
| carrier | 10/10 programs |
| `m1` | 14/14 |
| hook matrix | 76/76 |
| `m2` | 7/7 |
| `m3` | 4/4 |
| `m4` | 18/22 |
| `m5` | 13/15 |
| `m6` | 8/8 |
| `m7` | 11/11 |
| `m8` | 15/16 |
| `m9` | 2/5 (variant A; AL) |
| `m10` | 3/3 |
| `w1` | 6/6 |

Chromium 148, on main `692babe13` + route B (`results/chromium-b/summary.txt`):
- SDK: 12/12 programs = Node.
- Workbench: the 7 that need no closure = Node (5 `c-*`, `m1`, hook matrix), and the 5 closure
  programs 5/5 with the closure in the guest's `/tmp` (`results/chromium-c/route-b/`).
  `c-transform-big` takes 73.5 s there, on the quadratic fd paths (4b/4c).

Remainder by binding:

- `m4` timers → 4;
- `m5` timers while a `WriteStream` writes 16 MiB → 4;
- `m4` `encoding` option → 1 (B2): every non-utf8 encoding throws `NotImplementedError`, while today
  base64/latin1/hex through `'data'` equal Node in-process;
- `m5` `_writev` → 5;
- `m8` unknown encoding → 1;
- parity `cases/stream` 63/66 with product bindings: latin1/utf16le → 1, `'UTF8'` → 2.

## Row ownership

`results/ownership.txt` is generated by `reference/ownership.mjs` from `results/`; nothing in it is
written by hand. It is an auxiliary tool, not the full source:

- it covers in-process rows (every matrix and carrier program, the parity cases), isolate rows, and
  Workbench fd and stream-timing rows;
- it does not cover SDK rows, nor the Workbench carrier and matrix rows (`results/chromium*/` hold
  those as program summaries only);
- known limit: the isolate rows go by name rules (Node makes an `AbortController` in `pipeline`,
  `compose` and signal-taking operators → 7; a guest that makes one → 7 too), because no row-level
  isolate run on route B exists.

Rules:
- each row, on each host, gets the units it needs before it equals Node, read from the window
  columns (`-Bp8c`, `-Bp9w`, `-Bp9r`), the binding cause, timer ticks and the host;
- its owner is the last of those units in the implementation order; two or more units make an edge;
- a unit's acceptance: its own rows go green; later owners' rows stay pinned on their window's outcome
  (the window column), and the changes against today are listed and declared (§Regression risk,
  windows).

Summary of `results/ownership.txt` (rows by owner; `guard` = equal today and not broken by route B):

| owner | rows |
|---|---|
| 2 | 2 |
| 1 | 1 |
| 3 | 1 |
| 4 | 1 |
| 4b | 12 |
| 7 | 3 |
| AL | 2 |
| 8c | 137 |
| 9r | 34 |
| 4c | 24 |
| 5 | 1 |
| 9w | 22 |
| guard | 98 |

Edges, as owner ← unit, with the number of rows:

- 1 ← 2: 1
- 8c ← 1: 3
- 8c ← 2: 1
- 8c ← 7: 11
- 8c ← AL: 1
- 9r ← 1: 2
- 9r ← 4: 2
- 9r ← 4b: 1
- 9r ← 7: 3
- 9r ← 8c: 34
- 9w ← 4: 2
- 9w ← 4c: 2
- 9w ← 5: 1
- 9w ← 7: 1
- 9w ← 8c: 22
- 9w ← 9r: 3
- 9w ← P: 1

So the graph is:
- 1 ← 2 (shared normalisation point);
- 8c ← 1, 2, 7, AL;
- 9r ← 1, 4, 4b, 7, 8c;
- 9w ← 4, 4c, 5, 7, 8c, P; «9w ← 9r» is the last-owner rule's artefact, kept as order only;
- 7 now includes the isolate guest globals (the user's answer; 7g merged into 7): it owns the
  isolate `m9`/`m10` rows a guest-made `AbortController` needs; AL does not apply in the isolate;
- 3 has no edge; P owns no row (review S4, open there).

8a and 8b are 8c's build steps, so 8c's rows are theirs to keep pinned.

## Absorption

There are 37 stream drafts on main: 26 inside the goal, 11 outside. Nothing is deleted here; each
goes when its unit lands. Under route B a core draft closes by construction, so its repro becomes a
row of unit 8's acceptance; these repros have not yet been run on route B one by one.

| unit | drafts |
|---|---|
| 8 Core (21) | the earlier lifecycle and member drafts: `stream-destroy-construct-hooks`, `stream-hook-multiple-callback`, `duplex-end-finish-close-order`, `readable-flowing-property`, `writable-sync-dispatch-state`, `stream-classes-skip-legacy-stream`, `transform-readable-backpressure`, `duplex-writable-surface-gaps`, `stream-pipeline-finished-callback-args`; the core residuals route A left outside: `pipe-unpipe-destination-events`, `readable-flow-new-listener-hook`, `readable-from-iterator-lifecycle`, `readable-pipe-ended-source`, `readable-read-option-non-function`, `readable-set-encoding-string-decoder-residue` (with 1), `readable-sized-read-hwm-growth`, `stream-byte-chunk-kinds`, `stream-internal-listener-registration`, `duplex-from-source-ownership`, `add-abort-signal-reason-identity`; with Node's web adapters (ADR-0575 §5): `web-stream-adapter-terminal-lifecycle` |
| 9r read (3 + 2 halves) | `fs-readstream-pipe-node-options`, `fs-readstream-set-encoding`, `distribution/isolate-host-fs-read-stream-needs-web-readablestream`; read half of `fs-stream-class-call-shape` and `fs-stream-close-method-missing` |
| 9w write (2 halves) | write half of `fs-stream-class-call-shape` and `fs-stream-close-method-missing` |

Drafts that exist only on parked branches:

- → 9r/9w by side: `fs-streams-not-node-streams`, `fs-stream-autoclose-false`; → 9r:
  `fs-readstream-preaborted-signal-sync-destroy`, `fs-read-stream-flows-without-consumer`.
- → 9r with §Open questions: `fs-read-stream-reads-snapshot-not-open-file`.
- → 9r + 1: `fs-read-stream-utf16le-surrogate-split`; → 8: `stream-pipeline-callback-generator-stage`.
  These two live only in the local unpushed commit `397555c3d`.
- → outside (events): `events-listener-argument-validation`.

## Links

- **Goal node-zlib-on-every-host.** Its `map.md` §Dependencies is updated in this branch. The line in
  both maps: «zlib unit 2 (engine) needs no streams unit. zlib unit 3 (`lib/zlib.js` whole) starts
  after streams units 8a–8c «Core». `zlib-diff` = 0 is zlib unit 3's own entry criterion; if its state
  group is ≠ 0 after 8c, that is a finding against the streams goal.»
  - The earlier per-member mapping of `zlib-node-lib-port`'s gap rows is moot: in unit 8 they are all
    Node's code.
  - Route B measured `zlib-diff` at 6/45 state scenarios (`results/route-b-zlib-diff.txt`). All are
    flush paths, from the probe's `Buffer` mix.
  - Its load group's extra `'drain'` (rifty today) is gone on route B (load 0/1), so it is the
    hand-written core's, not `perf/io-stream-single-schedule-drain`'s scheduling.
  - S1, `finished` «after an error» in `zlib-node-lib-port`: both sides were right. zlib's scenario
    holds an inflate at its `highWaterMark` with no reader, so it never ended and Node gives
    `ERR_STREAM_PREMATURE_CLOSE`. After a real stored error, Node passes that error (`m7`). The
    scenario name there is corrected in this branch.
  - The joint cases (unzipper `Extract` on DEFLATE, the `createGzip` pipe) are proposed for the zlib
    carrier, not carried here.
- **PR #434** (`t3/fs-stream-close`, parked): its read-stream close cases move into 9r and its
  write-stream cases into 9w, as Node-oracle cases. Its EventEmitter code does not move (rejected route).
- **PR #437** (`t3/isolate-fs-read-stream`, parked): absorbed by 9r, on condition that 9r's
  isolate run shows the `isolate-host.ReadableStream` wall gone. The fd source already reads in the
  isolate (`m4` «Node's ReadStream source»).
  - Moving to 9r: `cases/fs/read-stream.case.ts`, corpus rows `fs-read-stream*`, its review
    findings.
  - Staying isolate work: the swap test (`fs-sync-mirror-swap.test.ts`), the isolate-host README cost
    numbers, compat `isolate-host.md`, the exceljs library-probe row.
- **Goal isolate-guest-web-api** (goal isolate-guest-web-api on branch `origin/t3/isolate-web-api-goal` (PR #443, not yet on main)): its scenario 3 is pdfkit with its built-in font, `compress: true` → `out.pdf`
  (the zlib goal's case 4, reused); which stream units it stands on is not measured here. Unit 7 lives
  in this goal and carries that goal's I3 rows in its acceptance. ADR-0575 §6.

## Regression risk

Unit 8 replaces the core under every stream rifty builds itself: 13 constructions in 7 files, plus 5
subclasses in 4 files.

- kernel:
  - `process-manager.ts:700-701` (child stdout/stderr);
  - `worker-stdin-writer.ts:7` (Writable).
- runtime-js:
  - `child_process.ts:323,475-476`;
  - `child_process-exec.ts:71` (Writable);
  - `process-file-stdout.ts:16` (Writable);
  - `worker_threads-stdio.ts:41-42`;
  - `ipc/no-coi-child-process.ts:48-50` (stdin Writable);
  - `zlib.ts:243` (`Gzip extends Transform`, own `destroy()` at `:306`).
- net: `http/request.ts:229,272` (`IncomingMessage`, `IncomingMessageFromFetch`).
- isolate guest: `ceiling-zlib.ts:46`, `egress-net.ts:95`, `egress-http.ts:303-327` (loud classes on
  `Stream`/`Readable`).
- io internal: `compose`, `Readable.from`, `Duplex.from`, web adapters.

The non-Node API they use moves in unit 8:

- io's `onDestroy` for `Writable.fromWeb`;
- ADR-0353's callable constructors;
- `ServerResponse.write` returns a `Promise` under backpressure (`net/src/http/response.ts:259-283`,
  ADR-0154 D3). rifty's `pipe` pauses on that Promise today (`io/src/streams/readable.ts:754`), but
  Node's `pipe` pauses only on `false`. After unit 8, `fs.createReadStream(f).pipe(res)` (Express
  `send`, `serve-static`) would buffer without bound. So unit 8 makes `ServerResponse.write` return
  `false` + `'drain'`, as Node's does, and carries a bounded-memory row for that pipe.

`net/http/upgrade-socket.ts` keeps its own state object on an `EventEmitter` (`:49`, `:59-61`) and is
untouched. `_writableState.ending` and `_readableState.ended` (`kernel/process-manager.ts:813`,
`runtime-js/child_process.ts:188`) exist in Node too.

Lanes that catch it:

- `test:parity` (`*.case.ts`: stream 69, fs 41, process 35, child_process 31, worker_threads 20, http
  14, zlib 7);
- `test:run` conformance;
- the isolate-host corpus and library tests;
- e2e-chromium (shell, npm and dev-server consume child stdio);
- the no-coi lane.

What they miss:

- destroy/error paths of child stdio, worker stdio and `IncomingMessage`;
- `Gzip`'s own `destroy()`;
- Chromium ordering (parity runs on Node's event loop).

So 8b carries one normal-completion row and one error/destroy row per internal stream kind, Writable
kinds included. It also carries rows for Node's `pipe`/`pipeline`/`finished` into `ServerResponse`,
`ClientRequest`, `PortRegistrySocket`, `process.stdout` and the upgrade socket, success and error.

Measured on route B in-process (`results/route-b-s5-consumers.txt`, cases `route-b/s5/`):
- `finished(req.socket, cb)`: Node and today accept; on route B it throws `ERR_INVALID_ARG_TYPE`
  synchronously, because `PortRegistrySocket` is a plain `EventEmitter`.
- A source piped into an unread `ServerResponse`: Node reads 56–96 chunks, today 8, route B 2001.
- `pipeline(src, res, cb)`: the callback runs on both today (`args=1`) and route B (`args=2`); route B
  ordered it after the response once.

8c closes the first two without turning `net.Socket`/`ServerResponse` into real streams:
- `ServerResponse.write` returns `false` + `'drain'`;
- `PortRegistrySocket` gets the shape `finished` accepts.

Not measured on route B yet: `ClientRequest`, `process.stdout` (parity `stream/pipe-process-stdio*`),
the upgrade socket. These are 8b's to write.

Windows between units (`packages/isolate-host/tests/fixtures/streams-scenario/w1-fs-windows.cjs`, `results/w1-fs-windows.txt`). The columns are
Node, today, after 8c before 9r (`rifty-inproc-Bp8c`: Node's core with today's fs classes) and after
9r before 9w (`rifty-inproc-Bp9r`). Each row is pinned as declared:

- `ws instanceof Writable` / `isWritable(ws)`: Node true/true, today false, both windows false.
- `pipeline(rs, ws)` then `destroyed`/`closed`: Node true/true; today and both windows false/undefined.
  The bytes are right everywhere.
- `pipeline(rs, PassThrough, ws)`: Node's bytes everywhere.
- `promises.pipeline(rs, async gen, ws)`: Node resolves. Today throws `TypeError`; the 8c window
  throws `ERR_STREAM_PREMATURE_CLOSE`, which is still loud; the 9r window resolves.
- `ws.destroy(err)` mid-`pipe`: Node emits `'error'` on `ws`; today and both windows emit none.
- A late `finished(ws)` after close: Node calls the callback; today and both windows do not.

All of these close at 9w.

Rows in a window are pinned on that window's outcome (the window column), not on today's; the changes
against today are listed and declared (`results/ownership.txt` §window changes). Six change in a way
that holds after the earlier units land:

- 8c window:
  - `c-unzip-stored`: today exits 0 and the extraction directory is missing (listing `ENOENT`); the
    window exits 1 with `TypeError: Class constructor FileWriteStream cannot be invoked without 'new'`;
  - `c-pipeline-asyncgen`: `TypeError: pipeline: argument must be a stream` → `ERR_STREAM_PREMATURE_CLOSE`;
  - `m4` `Readable.from(fs.ReadStream)`: rifty's `TypeError` text → Node's `ERR_INVALID_ARG_TYPE`;
  - `w1` `promises.pipeline(rs, async gen, ws)`: `TypeError` → `ERR_STREAM_PREMATURE_CLOSE`.
- 9r window:
  - `c-unzip-stored`: as in the 8c window;
  - `m3` fs streams `instanceof Stream`: `false,false` → `true,false`.

The table lists further window rows whose change goes away once an earlier unit lands, so they are
not declared here: `m4` encoding through `'data'` and with `highWaterMark` 4 (unit 1), `m4` timers in
a 16 MiB stream (unit 4), `m8` encoding `"nope"` (unit 1).

Open, not declared: `m9` `promises.pipeline` with a signal after a stopping listener. Today it throws
`TypeError`; in both windows (variant A) it hangs. It is AL's to resolve before 8c lands on browser
hosts; no window may ship the hang.

Unit 4 changes the timing of every `fs` callback API. Its own row: the fs callback parity cases
(`cases/fs`, 41) plus an ordering case of `fs.readFile`/`stat`/`write` callbacks against timers and
`setImmediate`.

## Faults outside parity

Reachable failures that are not plain Node behaviour; input to the tier (works):

- VFS failure during a read or write (OPFS I/O error, quota exceeded, owner-RPC timeout on an fd
  read/write): what `'error'` reaches the stream?
- Host kill mid-stream (isolate `memoryLimit`, sandbox `destroy`, a terminated worker): partial files
  (`distribution/isolate-host-sandbox-killed-run-partial-writes`).
- Memory ceilings reached sooner than Node's RSS, by a guest that ignores backpressure.

Each outcome must still be honest, never a silent truncation. Durability after `'finish'` holds today
(S7, §Open questions), so it is a guard of 9w, not a fault.

## Open questions

- Chromium — owner: agent, unit 0.
  - Route A baseline on main `c2d03ce05`, Chromium 148: Workbench and SDK give the in-process route-A
    outcomes row for row. Workbench `c-transform-big` does not finish in 180 s; the SDK takes 870 ms.
    Data: `reference/chromium/`, `results/chromium/`, with the program set at copy time.
  - Route B on main `692babe13`: the SDK gives 12/12 programs = Node (10 `c-*`, `m1`, hook matrix).
    Workbench: the 7 programs without the closure = Node, and the 5 closure programs 5/5 via `/tmp`
    (`results/chromium-c/route-b/`);
    `c-transform-big` 73.5 s (`results/chromium-b/`).
  - Chromium 108 not run.
- fd I/O in Workbench (Chromium 148, main `692babe13`; `results/chromium-fd/`, probes `chromium/fd*`):
  every fd read and write path moves the whole file per call. 16 MiB in 64 KiB calls takes 18.5–26 s
  to read and 50–82 s to write; positional writes take 114–199 s. Node takes 3–7 ms; `readFileSync`
  and `writeFileSync` are linear. Timer ticks are 0 on every path → units 4b, 4c, 4.
- S7, measured (`results/chromium/durability.jsonl`): Workbench, OPFS `persistence: 'required'`,
  4 MiB through `fs.WriteStream`, then `'finish'` or `'close'` → `process.exit(0)` → reload. 18/18
  runs read back 4194304 bytes with Node's sha256, with or without a flush and with an immediate
  reload. No gap: I11 is dropped and no unit is seeded; the sequence becomes a guard row of 9w.
  Side fact: rifty's `ws.bytesWritten` is `undefined` after finish (`m5`).
- The bundle caps — answered — recorded by the manager: a cap is recomputed by the rule of
  `tools/checks/client-bundle-budget.mjs` (cleaned size × 1.5, rounded up to 1000 B), in the PR that
  crosses it, with the new measurement and its cause in that file. The cap is not a stop condition.
  So 8c (and zlib unit 3) carry an acceptance row for it. Measured on main `692babe13`
  (`results/route-b-product-build-main.txt`):
  - route B: generic gzip 288 404 → 312 037 (+23 633) of 332 000; toolchain 331 931 → 355 626
    (+23 695) of 386 000;
  - with the zlib engine and its handle wired: 351 690 and 394 735 — review measurement of 25.11
    (PR #450 reviewer, #452's engine; no script in `results/`), +19 690 and +8 735 over, before
    `lib/zlib.js`;
  - #452 as it stands adds 0 B, because nothing imports it.
- Product shape of route B — settled by the probe (`route-b/product/`, `results/route-b-product-*.txt`):
  - With rifty bindings only, the probe artefacts vanish: parity `cases/stream` 63/66 (3 binding
    rows → 1, 2); fs parity 6/6; `zlib-diff` 0 fields with `lib/zlib.js` on rifty's `Buffer`.
  - On a throwaway product build `test:client-bundles` passes; the numbers are in the bundle-caps
    item above. `main`/`sw` −27/−43 B, io guard 950/1021 B, `guest.js` gzip +24 792.
  - In the isolate, the m-matrices equal the in-process route-B rows, except `m7` 5/11 and
    `c-pipeline-asyncgen`: the guest has no `AbortController` (unit 7). The budget with the zlib
    engine: the cap rule above.
  - Not run through `check:es-floor`; Chromium 108 floor APIs are listed at unit 8.
- Isolate `AbortController` globals — answered — recorded by the manager: `AbortController`,
  `AbortSignal`, `EventTarget`, `Event` become ordinary isolate globals from Node's sources (unit 7,
  ≈31 KB min / 9 KB gzip for `abort_controller.js` + `event_target.js` + `webidl.js`,
  `results/route-b-size.txt`), plus `CustomEvent` (the manager's decision, same Node file). Unit 7
  lives in this goal; its acceptance includes goal isolate-guest-web-api's I3.
- Abort listeners on browser hosts — owner: user (the goal's only open user question, so the goal
  stays draft; the ready units do not depend on it):
  - the abort-listener variants table of
    `runtime-js/stream-core-abort-listeners-host-event-target` (today / A / B / C / D, with what each
    row means for a program), D being Node's `AbortController`/`AbortSignal`/`EventTarget`/`Event` as
    guest globals on browser hosts too.
  - Browser hosts bind the host globals today. On the SDK, route B equals Node; on Workbench, the 7 programs run equal Node. None calls
    `AbortSignal`/`EventTarget` directly.
- Web adapters — settled: Node's `internal/webstreams/adapters` verbatim over the host globals
  (ADR-0575 §5). 13 of the 14 parity cases using them equal Node in product shape; the 14th
  (`writable-admission`) fails on `'UTF8'` (unit 2).
- A read through an fd after unlink/rewrite of the file (Node keeps the inode; rifty's `FsSync`/`Vfs`
  have no open-file handle; `fs-read-stream-reads-snapshot-not-open-file`) — owner: agent — probed
  in 9r per VFS; a ⚠️ row until then.

## Out of scope

- **Next goal candidates, same root (hand-written EventEmitter, not `Readable`/`Writable`/`Duplex`)**:
  - `http.ServerResponse` (`net/src/http/response.ts:40`);
  - `ClientRequest` (`net/src/http/server.ts:297`);
  - `net.Socket`/`PortRegistrySocket` (`net/src/http/request.ts:90`), and the isolate's loud
    `net.Socket`;
  - `process.stdin` (`runtime-js/src/builtins/process-stdin-reader.ts:28`).

  Related drafts: `process-stdio-writable-end-surface`, `child-process-stdio-stream-slot`. Outside
  the goal by the user's «ок» 2026-11-25 (goal.md Decisions); `ClientRequest` is the manager's
  addition to that list.
- **Web streams**:
  - the isolate `ReadableStream` (goal isolate-guest-web-api);
  - `vfs/memory-vfs-openreadable-true-backpressure`: fs streams no longer read through
    `openReadable` (ADR-0575 §3).
- **Performance**: `perf/io-stream-single-schedule-drain`, `kernel/binary-stdio-messageport-backpressure`.
- **node:zlib**: goal node-zlib-on-every-host.
- **Other areas**:
  - `cjs-record-guest-writable-lifecycle` (module loader);
  - `fs-promises-filehandle` (FileHandle: a named gap in 9r/9w's bindings until it lands);
  - `readline-chunk-stateful-decode`;
  - `builtin-function-names`, `guest-builtin-names`;
  - `fs-mode-arguments-ignored` (the VFS has no modes).
- **Compat fact**: `docs/public/compat/streams.md` «Legacy streams ✅» contradicts `m3` 0/4. It is
  corrected to ⚠️ with this goal's link; the proof is unit 8.
