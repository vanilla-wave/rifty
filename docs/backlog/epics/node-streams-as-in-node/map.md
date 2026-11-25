# Map — node-streams-as-in-node

Route B (ADR-0575): the stream core and fs streams are Node v24.16.0's own sources, and rifty owns the
bindings. Probe: `reference/` (README, programs, `route-b/`, `results/summary.txt`, `results/route-b-*.txt`).
Rows equal to Node, run at `725576a88` (main `b6d37fc01`'s code; this branch is docs-only).

## Items

- **0** `runtime-js/node-streams-acceptance-carrier` — **carrier**. It runs the 10 `c-*` programs (files
  compared by content) as cases against live Node, in the isolate host and in Chromium on both
  browser hosts (Workbench, SDK; Chromium 108 is the tier floor, ADR-0469). It also runs the
  m-matrices in Chromium. It comes first, before any code, and has one owner for the Chromium line.
  → I8.

Bindings and fs platform. Each is a parity fix that holds without the core, with its own proof
against Node:

- **1** `runtime-js/string-decoder-node-encodings` — `string_decoder` latin1/ucs2/utf16le/base64/hex/ascii
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
- **4b** `runtime-js/fs-fd-read-by-range` — positional fd reads move only the range. In Workbench
  today each 64 KiB call moves the whole file: 16 MiB in 20–26 s, against Node's 3 ms. Acceptance is
  by byte/RPC counter, with an explicit decision per implementation. → I10.
- **4c** `runtime-js/fs-fd-write-by-range` — positional fd writes move only the range. Today
  16 MiB takes 50–82 s, and positional writes 114–199 s. Same acceptance as 4b. → I10.
- **5** `runtime-js/fs-writev-fsync` — `fs.writev`/`writevSync`/`fsync`/`fsyncSync`/`fdatasync`
  (`b1`). Without `writev`, Node's `WriteStream` sets `_writev = null`; without `fsync`, `flush: true`
  throws a misleading `ERR_INVALID_ARG_TYPE` (`streams.js:373-374`). → I10.
- **P** `perf/workbench-guest-write-cost-grows-with-project` — **publication cost per mutation**. In
  Workbench a write costs about +0.18 ms per project file (#453). The unit starts by establishing
  the cause, and its body is a hypothesis until then. 9w stands on it, because Node's `WriteStream`
  writes once per chunk.
- **7** `distribution/isolate-stream-core-abort-controller` — Node's `AbortController` sources
  for the isolate core. Without them, Node's `pipeline` fails in the isolate (`m7` 5/11 on the
  product build). Reachable classes are a fact; the globals fork is the user's (§Open questions). →
  I7 (isolate).

Core, three adjacent PRs (ADR-0575 §7):

- **8a** `runtime-js/stream-core-node-sources-unwired`:
  - vendored sources, license manifest entry, generator, bindings, zlib constants without the zlib
    module;
  - not wired: `check:arch` «no product importer» and byte-identical `main` bundles;
  - a CI differential «Node's bindings = rifty's» on `m1`–`m8`, the hook matrix, `cases/stream` and
    `zlib-diff`.
- **8b** `runtime-js/stream-core-consumer-guard-rows`: regression rows for internal consumers
  and non-stream objects, green on today's core (§Regression risk).
- **8c** `runtime-js/stream-core-node-sources`:
  - wiring and consumer moves (`ServerResponse.write` → `false`; a stream shape `finished`
    accepts for `PortRegistrySocket`), and removal of `packages/io/src/streams`;
  - the es-floor extension;
  - identifier renaming changes 1 of 105 parity cases (`results/route-b-minify.txt`): a declared ⚠️
    with that message listed and a row on the consumer bundle.

  Stands on 8a, 8b, 1, 2 and, in the isolate, 7. Absorbs 21 drafts. → I1–I3, I6, I7.

  Merge order: 8a and 8b merge once 8c is in work; 8a never sits unwired on `main` open-ended.

fs streams, split by side:

- **9r** `runtime-js/fs-read-stream-node-source` — `fs.ReadStream` from Node's
  `lib/internal/fs/streams.js`, which is loaded whole; only `ReadStream` is wired. Stands on 8, 4
  and 4b. In the meantime `fs.WriteStream` is today's class. Measured in-process
  (`results/route-b-9r/`): carrier 8/10 programs = Node. The two left fail on today's write class as
  they do today, and backpressure into today's `WriteStream` holds (in-flight 65536). → I4, I8 (read
  programs).
- **9w** `runtime-js/fs-write-stream-node-source` — `fs.WriteStream` from the same file. Stands on
  8, 4, 4c, 5 and the publication cost unit. Today's 16 MiB write stream on Workbench takes 518 ms,
  and it stays so until 9w. → I5, I8 (write programs).

Implementation order once the goal is ready:
- 1, 2, 3 (independent) → 4, 4b → 8a → 8b → 8c → 9r;
- in parallel and after: 4c, 5 and P (publication cost) → 9w;
- 7 by the user's answer on `AbortController`.

Probe totals on route B, in-process (`summary.txt`):

| | equal to Node |
|---|---|
| carrier | 10/10 programs |
| `m1` | 14/14 |
| hook matrix | 76/76 |
| `m2` | 7/7 |
| `m3` | 4/4 |
| `m4` | 18/22 |
| `m5` | 13/14 |
| `m6` | 8/8 |
| `m7` | 11/11 |
| `m8` | 15/16 |

Chromium 148, on main `692babe13` + route B (`results/chromium-b/summary.txt`):
- SDK: 12/12 programs = Node.
- Workbench: the 7 that need no closure = Node (5 `c-*`, `m1`, hook matrix). The 5 closure programs
  did not run, because seeding the 5941-file closure did not complete. `c-transform-big` takes
  73.5 s there, on the quadratic fd paths (4b/4c).

Remainder by binding:

- `m4` timers → 4;
- `m4` `encoding` option → 1 (B2): every non-utf8 encoding throws `NotImplementedError`, while today
  base64/latin1/hex through `'data'` equal Node in-process;
- `m5` `_writev` → 5;
- `m8` unknown encoding → 1;
- parity `cases/stream` 63/66 with product bindings: latin1/utf16le → 1, `'UTF8'` → 2.

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
  after streams units 8a–8c «Core»; 8a's differential includes `zlib-diff` = 0 (state and load).»
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
- **Goal isolate-guest-web-api**: its scenario 3 (exceljs `xlsx.readFile`, then `writeFile`) stands on
  9r for the read, and on today's write class until 9w. Unit 7's globals fork travels with its
  question 1 (ADR-0575 §6).

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
    Workbench: the 7 programs without the closure = Node; 5 not run (closure seeding);
    `c-transform-big` 73.5 s (`results/chromium-b/`).
  - Chromium 108 not run.
- fd I/O in Workbench (Chromium 148, main `692babe13`; `results/chromium-fd/`, probes `chromium/fd*`):
  every fd read and write path moves the whole file per call. 16 MiB in 64 KiB calls takes 20–26 s
  to read and 50–82 s to write; positional writes take 114–199 s. Node takes 3–7 ms; `readFileSync`
  and `writeFileSync` are linear. Timer ticks are 0 on every path → units 4b, 4c, 4.
- S7, measured (`results/chromium/durability.jsonl`): Workbench, OPFS `persistence: 'required'`,
  4 MiB through `fs.WriteStream`, then `'finish'` or `'close'` → `process.exit(0)` → reload. 18/18
  runs read back 4194304 bytes with Node's sha256, with or without a flush and with an immediate
  reload. No gap: I11 is dropped and no unit is seeded; the sequence becomes a guard row of 9w.
  Side fact: rifty's `ws.bytesWritten` is `undefined` after finish (`m5`).
- The bundle caps — owner: user — on main `692babe13` (`results/route-b-product-build-main.txt`):
  - route B: generic gzip 288 404 → 312 037 (+23 633) of 332 000; toolchain 331 931 → 355 626
    (+23 695) of 386 000;
  - with the zlib engine and its handle wired (#452, measured by the PR #450 reviewer): 351 690 and
    394 735, which is +19 690 and +8 735 over, before `lib/zlib.js`;
  - #452 as it stands adds 0 B, because nothing imports it.

  A lazy stream chunk is doubtful: `require('stream')` is synchronous, and the core is used at boot.
  Options for the user:
  - raise the caps;
  - a lazy zlib engine;
  - order the two goals.

  Until this is answered, the goal stays draft.
- Product shape of route B — settled by the probe (`route-b/product/`, `results/route-b-product-*.txt`):
  - With rifty bindings only, the probe artefacts vanish: parity `cases/stream` 63/66 (3 binding
    rows → 1, 2); fs parity 6/6; `zlib-diff` 0 fields with `lib/zlib.js` on rifty's `Buffer`.
  - On a throwaway product build `test:client-bundles` passes; the numbers are in the bundle-caps
    item above. `main`/`sw` −27/−43 B, io guard 950/1021 B, `guest.js` gzip +24 792.
  - In the isolate, the m-matrices equal the in-process route-B rows, except `m7` 5/11 and
    `c-pipeline-asyncgen`: the guest has no `AbortController` (unit 7). The budget with the zlib
    engine is the user's question above.
  - Not run through `check:es-floor`; Chromium 108 floor APIs are listed at unit 8.
- Isolate `AbortController` globals — owner: user — carried with the Web API goal's question 1.
  - Unit 7 brings Node's `abort_controller.js` + `event_target.js` + `webidl.js` (≈31 KB min / 9 KB
    gzip, `results/route-b-size.txt`).
  - Without globals the classes are still reachable: through `signal.constructor` (statics work), an
    `EventTarget` through the prototype chain, and `Event` through an event. The globals stay
    ceiling throws, and `instanceof AbortSignal` throws.
  - The fork: (a) leave it like that, or (b) make `AbortController`/`AbortSignal`/`EventTarget`/`Event`
    isolate globals from the same sources. The bytes are the same either way.
  - Browser hosts bind the host globals. On the SDK, route B equals Node; on Workbench, the 7 programs run equal Node. None calls
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
