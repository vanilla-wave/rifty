# Map — node-streams-as-in-node

Route B (ADR-0575): the stream core and fs streams are Node v24.16.0's own sources, and rifty owns the
bindings. Probe: `reference/` (README, programs, `route-b/`, `results/summary.txt`, `results/route-b-*.txt`).
Rows equal to Node, run at `725576a88` (main `b6d37fc01`'s code; this branch is docs-only).

## Items

0. `runtime-js/node-streams-acceptance-carrier` — **carrier** — 10 `c-*` programs (files compared by
   sha256) as cases against live Node, in the isolate host and in Chromium on both browser hosts
   (Workbench, SDK); Chromium 108 is the tier floor (ADR-0469). It also runs the m-matrices in
   Chromium. It comes first, before any code, and has one owner for the Chromium line. → I8.

Bindings. Each is a parity fix that holds without the core and carries its own proof against Node.
They run in any order; 1–3 and 7 come before 8, and 4–5 before 9:

1. `runtime-js/string-decoder-node-encodings` — `string_decoder` latin1/ucs2/utf16le and every
   spelling Node accepts; an unknown encoding → `ERR_UNKNOWN_ENCODING`, not `NotImplementedError`
   (`b1` rows). → I9.
2. `runtime-js/buffer-encoding-names` — `Buffer.from`/`toString`/`write`/`byteLength` accept every
   name Node's `normalizeEncoding` maps (`'UTF8'`, `'LATIN1'`, `'BASE64'`, …). Today `isEncoding` is
   true, but `toString`/`from` throw `Unsupported encoding` (`b1` rows). → I9.
3. `runtime-js/events-add-abort-listener` — `events.addAbortListener` is absent today (`b1`). It is
   the only gap among the core's needs from `events`. → I9.
4. `runtime-js/fs-callbacks-io-turn` — `fs` callback APIs complete in an I/O turn, not in a microtask
   chain. Row: timers interleave with an `fs.read` loop (`m4` «fs.read(fd) loop»: Node `ticks>0=true`,
   rifty `false`). A write issued before close lands on main already (`b1`, fs-stream parity A 6/6),
   so that is a guard row, not a gap. It touches every callback API of `fs`, so it gets its own
   regression row (§Regression risk). → I10.
5. `runtime-js/fs-writev-fsync` — `fs.writev`/`writevSync`/`fsync`/`fsyncSync`/`fdatasync`, absent
   today (`b1`). Without `writev`, Node's `WriteStream` sets `_writev = null` (`m5` route B); without
   `fsync`, `flush: true` throws a misleading `ERR_INVALID_ARG_TYPE`
   (`streams.js:373-374`). → I10.
6. (dropped) durability after `'finish'` + exit + reload: it holds today (S7, 18/18, §Open questions);
   it is kept as a guard row of 9.
7. `distribution/isolate-stream-core-abort-controller` — the isolate's core-private
   `AbortController`/`AbortSignal` for Node's `pipeline`/helpers. `pipeline` works in the isolate
   today and must keep working. Measured route and cost: §Open questions. → I7 (isolate).

Core and fs streams:

8. `runtime-js/stream-core-node-sources` — **Core** — one replacement, no state with two cores. Stands
   on 1–3 and 7. Absorbs 21 drafts. → I1–I3, I6, I7. Scope:
   - `lib/stream.js`, `lib/stream/promises.js` and `lib/internal/streams/*.js` generated from the
     pinned tarball (ADR-0574's pipeline), plus the bindings;
   - the hand-written `packages/io/src/streams` and its unit tests removed;
   - internal consumers moved (§Regression risk).

   Acceptance:
   - the differential «verbatim core on Node's bindings = on rifty's» = 0, committed as a CI test (not
     only a docs probe). `zlib-diff` = 0 is the consumer check that zlib unit 3 runs as its own entry
     criterion;
   - the plain-stream rows of `m1`–`m3`, `m6`–`m8` and the hook matrix = Node in the isolate and in
     Chromium (the fs-stream rows of `m2`/`m3` belong to 9);
   - `check:es-floor` on the generated module + bindings, and the Chromium 108 floor lane. Floor APIs
     reached: `AbortSignal.any`, `Symbol.dispose`/`asyncDispose`;
   - parity `cases/stream` 66/66;
   - each absorbed draft's own repro (§Absorption) = Node;
   - no regression in the existing lanes;
   - one normal-completion row and one error/destroy row per internal stream kind (§Regression risk).
9. `runtime-js/fs-streams-node-sources` — **fs streams** — `lib/internal/fs/streams.js` unedited over
   the core, reading through fds on every host (ADR-0575 §3). Stands on 8, 4 and 5. Absorbs 5 drafts
   and PRs #434/#437. → I4, I5. Acceptance:
   - `m4`/`m5` and the fs-stream rows of `m2`/`m3` = Node on every host;
   - the carrier = Node on every host (I8);
   - guard: a `WriteStream` file is intact after `'finish'` + exit + reload on Workbench/OPFS
     (`results/chromium/durability.jsonl`);
   - route-B fs parity 6/6;
   - PR #434's and #437's cases.

Order: 0 first, then 1–5 and 7 in any order. 8 comes after 1–3 and 7, then 9 after 8, 4 and 5.

Probe totals on route B, in-process, with Node's own `internal/*` as bindings:

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

Remainder by binding:

- `m4` timers → 4; `m4` `encoding` option → 1 (B2): every non-utf8 encoding throws `string_decoder` `NotImplementedError`,
  where today base64/latin1/hex through `'data'` equal Node in-process (`m4` «through 'data'»). So 1
  lands before 9; `m5` `_writev` → 5; `m8` unknown encoding → 1.
- Parity `cases/stream` 59/66: latin1/utf16le → 1, `'UTF8'` → 2, and 4 rows from the probe's mixed
  `Buffer`/adapters.
- fs parity 3/6: a probe artefact, 6/6 with product bindings.
- `zlib-diff` state 6/45, all flush paths: the probe's mixed `Buffer` drops `kFlushFlag`.

The mixed-`Buffer` cause vanishes in product shape (§Open questions).

## Absorption

There are 37 stream drafts on main: 26 inside the goal, 11 outside. Nothing is deleted here; each
goes when its unit lands. Under route B a core draft closes by construction, so its repro becomes a
row of unit 8's acceptance; these repros have not yet been run on route B one by one.

| unit | drafts |
|---|---|
| 8 Core (21) | the earlier lifecycle and member drafts: `stream-destroy-construct-hooks`, `stream-hook-multiple-callback`, `duplex-end-finish-close-order`, `readable-flowing-property`, `writable-sync-dispatch-state`, `stream-classes-skip-legacy-stream`, `transform-readable-backpressure`, `duplex-writable-surface-gaps`, `stream-pipeline-finished-callback-args`; the core residuals route A left outside: `pipe-unpipe-destination-events`, `readable-flow-new-listener-hook`, `readable-from-iterator-lifecycle`, `readable-pipe-ended-source`, `readable-read-option-non-function`, `readable-set-encoding-string-decoder-residue` (with 1), `readable-sized-read-hwm-growth`, `stream-byte-chunk-kinds`, `stream-internal-listener-registration`, `duplex-from-source-ownership`, `add-abort-signal-reason-identity`; with Node's web adapters (ADR-0575 §5): `web-stream-adapter-terminal-lifecycle` |
| 9 fs streams (5) | `fs-readstream-pipe-node-options`, `fs-readstream-set-encoding`, `fs-stream-class-call-shape`, `fs-stream-close-method-missing`, `distribution/isolate-host-fs-read-stream-needs-web-readablestream` |

Drafts that exist only on parked branches:

- → 9: `fs-streams-not-node-streams`, `fs-stream-autoclose-false`,
  `fs-readstream-preaborted-signal-sync-destroy`, `fs-read-stream-flows-without-consumer`.
- → 9 with §Open questions: `fs-read-stream-reads-snapshot-not-open-file`.
- → 9 + 1: `fs-read-stream-utf16le-surrogate-split`; → 8: `stream-pipeline-callback-generator-stage`.
  These two live only in the local unpushed commit `397555c3d`.
- → outside (events): `events-listener-argument-validation`.

## Links

- **Goal node-zlib-on-every-host.** Its `map.md` §Dependencies is updated in this branch. The line in
  both maps: «zlib unit 2 (engine) needs no streams unit. zlib unit 3 (`lib/zlib.js` whole) starts
  after streams unit 8 «Core», whose acceptance includes `zlib-diff` = 0 (state and load).»
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
- **PR #434** (`t3/fs-stream-close`, parked): its parity cases and conformance move into unit 9 as
  Node-oracle cases. Its EventEmitter code does not move (rejected route).
- **PR #437** (`t3/isolate-fs-read-stream`, parked): absorbed by unit 9, on condition that unit 9's
  isolate run shows the `isolate-host.ReadableStream` wall gone. The fd source already reads in the
  isolate (`m4` «Node's ReadStream source»).
  - Moving to unit 9: `cases/fs/read-stream.case.ts`, corpus rows `fs-read-stream*`, its review
    findings.
  - Staying isolate work: the swap test (`fs-sync-mirror-swap.test.ts`), the isolate-host README cost
    numbers, compat `isolate-host.md`, the exceljs library-probe row.
- **Goal isolate-guest-web-api**: its scenario 3 (exceljs `xlsx.readFile`) stands on unit 9. Unit 7
  adds no global, so its question 1 stays open (ADR-0575 §6).

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

So unit 8's acceptance carries one normal-completion row and one error/destroy row per internal
stream kind, Writable kinds included.

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
(S7, §Open questions), so it is a guard, not a fault.

## Open questions

- Chromium baseline — measured on main `c2d03ce05`, Chromium 148.0.7778.96, Workbench (COI,
  browser-unit) and SDK (no-COI toolchain sandbox). Data: `reference/chromium/`,
  `results/chromium/summary.txt`. The program set is the one at copy time: `m4` 20 rows, and the
  older `c-transform-big`/`c-unzip-stored` without content hashes.
  - Both hosts give the in-process route-A outcomes row for row.
  - Workbench `c-transform-big` does not finish in 180 s; the SDK takes 870 ms. Workbench `m4` adds
    «no settle in 3s» on the fd-loop row.
  - The SDK on a COI page has no `node <file>` entry; generic mode offers only `runtime.eval`.
  - Not run yet: route B in Chromium, Chromium 108 — owner: agent — unit 0 (carrier) and unit 8's
    floor lane.
- S7, measured (`results/chromium/durability.jsonl`): Workbench, OPFS `persistence: 'required'`,
  4 MiB through `fs.WriteStream`, then `'finish'` or `'close'` → `process.exit(0)` → reload. 18/18
  runs read back 4194304 bytes with Node's sha256, with or without a flush and with an immediate
  reload. No gap: I11 is dropped and unit 6 is not seeded; the sequence becomes a guard row of unit 9.
  Side fact: rifty's `ws.bytesWritten` is `undefined` after finish (`m5`).
- The generic bundle cap — owner: user — the measured sum does not fit:
  - route B: +23 686 B gzip (303 440);
  - the zlib engine: +36 950 (ADR-0573 §8);
  - together 340 390 of 332 000, 8 390 over, before zlib's handle and `lib/zlib.js`; toolchain
    383 798 of 386 000.

  A lazy stream chunk is doubtful: `require('stream')` is synchronous, and the core is used at boot.
  Options for the user:
  - raise the cap;
  - a lazy zlib engine (ADR-0573's own open question);
  - order the two goals so that one lands under the cap.

  Until this is answered, the goal stays draft.
- Product shape of route B — settled by the probe (`route-b/product/`, `results/route-b-product-*.txt`):
  - With rifty bindings only, the probe artefacts vanish: parity `cases/stream` 63/66 (3 binding
    rows → 1, 2); fs parity 6/6; `zlib-diff` 0 fields with `lib/zlib.js` on rifty's `Buffer`.
  - On a throwaway product build `test:client-bundles` passes: generic gzip 279 754 → 303 440 of
    332 000; `main`/`sw` −27/−43 B, io guard 950/1021 B. `guest.js` gzip is +24 786.
  - In the isolate, the m-matrices equal the in-process route-B rows, except `m7` 5/11 and
    `c-pipeline-asyncgen`: the guest has no `AbortController` (unit 7). The budget with the zlib
    engine is the user's question above.
  - Not run through `check:es-floor`; Chromium 108 floor APIs are listed at unit 8.
- Isolate `AbortController` for unit 7 — owner: agent — measured file sizes (`results/route-b-size.txt`), esbuild min/gzip:
  `lib/internal/abort_controller.js` 9 036/2 646, `internal/event_target.js` 16 768/4 296, their
  `internal/webidl.js` 5 131/1 889 and `perf/utils` 520/265 — about 31 KB min / 9 KB gzip in
  `guest.js`. They need `util.inspect` (rifty has it) and stubs for `internalBinding('messaging')`
  symbols and the lazy `MessageChannel` transfer path (a named gap; the isolate has no
  `MessageChannel`).
  - Option (a): install them as guest globals. That decides the Web API goal's question 1 (b)
    without the user.
  - Option (b), chosen in ADR-0575 Decision 6: the same files private to the core. What the guest observes is the
    `signal` handed to pipeline stages and `map`/`filter` (Node's object: `aborted`, `reason`,
    `addEventListener`, `AbortError`), with no `AbortController`/`AbortSignal` global, as today.
  - Not run in the isolate yet: the product-shape probe.
  - Browser hosts use the host globals. Whether the verbatim core on Chromium's `AbortSignal`
    (`any`, `reason`) equals Node is unmeasured; owner unit 0.
- Web adapters — settled: Node's `internal/webstreams/adapters` verbatim over the host globals
  (ADR-0575 §5). 13 of the 14 parity cases using them equal Node in product shape; the 14th
  (`writable-admission`) fails on `'UTF8'` (unit 2).
- A read through an fd after unlink/rewrite of the file (Node keeps the inode; rifty's `FsSync`/`Vfs`
  have no open-file handle; `fs-read-stream-reads-snapshot-not-open-file`) — owner: agent — probed
  in unit 9 per VFS; a ⚠️ row until then.
- OPFS cost of fd reads through owner-RPC on Workbench — owner: agent — measured in unit 9 (no perf
  acceptance).

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
  - `fs-promises-filehandle` (FileHandle: a named gap in unit 9's bindings until it lands);
  - `readline-chunk-stateful-decode`;
  - `builtin-function-names`, `guest-builtin-names`;
  - `fs-mode-arguments-ignored` (the VFS has no modes).
- **Compat fact**: `docs/public/compat/streams.md` «Legacy streams ✅» contradicts `m3` 0/4. It is
  corrected to ⚠️ with this goal's link; the proof is unit 8.
