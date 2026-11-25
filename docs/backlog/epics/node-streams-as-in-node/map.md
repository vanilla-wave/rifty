# Map — node-streams-as-in-node

Probe: `reference/` (README, programs, `results/summary.txt`). Rows equal to Node on main
`b6d37fc01` are given per unit as in-process / isolate.

## Items

0. `runtime-js/node-streams-acceptance-carrier` — **carrier** — the `c-*` programs as cases on the
   isolate host and on Chromium (both browser hosts) against live Node, each pinning today's outcome.
   First, before any stream code. → I8.
1. `runtime-js/stream-destroy-construct-hooks` — **lifecycle** — `_construct`/`_destroy`, callback
   once, destroy moment, `errored`, `autoDestroy` `'close'` after `'end'`. Stands on nothing. Unlocks
   4, 5 and zlib's one-shots. `m1` 1/12, hook matrix 10/76. Absorbs 2, plus the readable half of a
   third. → I1.
2. `runtime-js/readable-flowing-property` — **state members** — `readableFlowing`, `isPaused()`,
   `writableNeedDrain`. Independent. `m2` 0/5. Absorbs 2. → I2.
3. `runtime-js/stream-classes-skip-legacy-stream` — **legacy `Stream` in the chain** — Independent.
   Its own unit because it changes the prototype chain of every class and falls under the io bundle
   budget (trap `io-treeshake-side-effect`). `m3` 0/4. Absorbs 1. → I3.
4. `runtime-js/fs-read-stream-is-readable` — **`fs.ReadStream` = `Readable` subclass, fd source** —
   Stands on 1. Unlocks scenario 1, 2 (with 5) and 4, the isolate read, and the Web API goal's
   scenario 3. `m4` 3/18 / 2/18. Absorbs 5 (2 shared with 5). → I4.
5. `runtime-js/fs-write-stream-is-writable` — **`fs.WriteStream` = `Writable` subclass, graceful-fs
   shape** — Stands on 1. Unlocks scenario 3 and the write side of 1, 5 and 6. `m5` 4/14. Absorbs 2,
   both shared with 4. → I5.
6. `runtime-js/transform-readable-backpressure` — **`Transform` backpressure, `Duplex` surface and
   order** — Independent of 1–5. Unlocks scenario 5 and zlib's streams. `m6` 0/8. Absorbs 3, one of them shared with 1. → I6.
7. `runtime-js/stream-pipeline-function-stages` — **pipeline function/async-generator stages, callback
   arguments** — Independent. Unlocks scenario 6. `m7` 0/7. Absorbs 1 (+1 branch-only). → I7.

Order: 0, then 1, 2, 3, 6, 7 in any order (1 first unblocks most), then 4 and 5 after 1. The
`readableFlowing`/`isPaused`/`writableNeedDrain` and `instanceof Stream` behaviour of fs streams is
unit 2's and 3's matrix (`m2`, `m3` carry fs-stream rows). Units 4 and 5 do not wait for them, and
their matrices leave these members out.

Rows of `m4`/`m5` that come from inherited core gaps outside the goal (§Out of scope, core residuals)
pin today's value under that draft's name. `setEncoding` on base64/utf16le is
`readable-set-encoding-string-decoder-residue`.

## Absorption

The drafts on main (37) that concern streams, each with the unit that closes it. Nothing is deleted
here: each is deleted when its unit lands.

| unit | drafts |
|---|---|
| 1 | `stream-destroy-construct-hooks`, `stream-hook-multiple-callback`; readable `'close'` half of `duplex-end-finish-close-order` |
| 2 | `readable-flowing-property`, `writable-sync-dispatch-state` |
| 3 | `stream-classes-skip-legacy-stream` |
| 4 | `fs-readstream-pipe-node-options`, `fs-readstream-set-encoding`, `distribution/isolate-host-fs-read-stream-needs-web-readablestream`; read half of `fs-stream-class-call-shape` and `fs-stream-close-method-missing` |
| 5 | write half of `fs-stream-class-call-shape` and `fs-stream-close-method-missing` |
| 6 | `transform-readable-backpressure`, `duplex-writable-surface-gaps`, `duplex-end-finish-close-order` (rest) |
| 7 | `stream-pipeline-finished-callback-args` |

That makes 14 distinct drafts inside the goal (`duplex-end-finish-close-order` is split between 1
and 6; two fs drafts are split between 4 and 5). 23 are outside, see §Out of scope.

Drafts that exist only on parked branches go to their unit when they reach main:

- `fs-streams-not-node-streams` (branch `t3/fs-stream-close`) → 4/5; its `destroy(err)` part → 1.
- `fs-stream-autoclose-false` → 4/5.
- `fs-readstream-preaborted-signal-sync-destroy` → 4.
- `fs-read-stream-flows-without-consumer` → 4.
- `fs-read-stream-utf16le-surrogate-split` (branch `t3/isolate-fs-read-stream`, local commit
  `397555c3d`) → 4.
- `stream-pipeline-callback-generator-stage` → 7.
- `fs-read-stream-reads-snapshot-not-open-file` → fog below.
- `events-listener-argument-validation` → outside (events).

The node:zlib drafts (`zlib-class-call-shape`, `zlib-crc32`, `zlib-trailing-bytes-after-stream-end`,
`zlib-web-compression-subset`) belong to the zlib goal.

## Links

- **Goal node-zlib-on-every-host** (branch `t3/zlib-engine-probe`, `map.md` item 3–4). The same line
  goes into both maps: «zlib's one-shots need streams unit 1 (`_destroy`); zlib's streams need streams
  unit 6 (`Transform` backpressure).» Evidence:
  - Node's `zlibBuffer` runs on a `Transform`: `on('data'/'error'/'end')`, `end(buf)`, then `close()`,
    which is `finished` + `destroy()` → `_destroy` → `_close(handle)` (`lib/zlib.js:113-160,367-375`).
  - The error path is `zlibOnError` → `destroy(err)` → `_destroy` → `'error'` (`:185-194`).
  - Stream backpressure comes from `processCallback` replacing `_read` once `push()` returns false
    (`:529-560`).
  - `m1` rows «zlibBuffer shape» and «zlibOnError shape» show `_destroy` never runs today (Node
    `data ab,prefinish,end,_destroy null,finish,close cb,close`; rifty
    `prefinish,data ab,finish,end,close,close cb`).
  - To be checked against the zlib thread's own measurement when it lands; until then this is derived
    from Node's source.
  - The joint consumer cases (unzipper DEFLATE, `createGzip` pipe) live in the zlib carrier.
- **PR #434** (`t3/fs-stream-close`, parked). Its parity cases `cases/fs/read-stream-close.case.ts`
  (rows 1–10a) and `cases/fs/write-stream-close.case.ts` (rows 11–20), its conformance
  `fs-stream-close-async-vfs.test.ts` and its corpus rows `fs-read-stream-close`/`fs-write-stream-close`
  move into units 4/5 as Node-oracle cases. The three review rounds' findings are rows of `m4`/`m5` or
  of those cases. Its EventEmitter `close()` code does not move (rejected route).
- **PR #437** (`t3/isolate-fs-read-stream`, parked) is absorbed by unit 4. Its sync-only guest wiring
  is not needed: the fd source works in the isolate today (`m4` «Node's ReadStream source»). Moving
  into unit 4:
  - `cases/fs/read-stream.case.ts`;
  - corpus rows `fs-read-stream`, `-changed`, `-late-consumer` and `-close` (each `ceiling:` row
    becomes green);
  - its review findings (sync `readable` loop, async-generator pipeline (→ 7), `await` before
    `pipe`/`'data'`, `setInterval` starvation, utf16le split).
  What stays isolate work in its own small PR:
  - `tests/conformance/builtins/fs-sync-mirror-swap.test.ts` (overlay substitution point);
  - the isolate-host README cost numbers;
  - the compat `isolate-host.md` read row;
  - the exceljs library-probe row.
- **Goal isolate-guest-web-api** (branch `t3/isolate-web-api-goal`). Its scenario 3 (exceljs
  `xlsx.readFile` reads its own file) stands on unit 4 (read) and unit 5 (`writeFile`). Its map items
  8–9 point to drafts that unit 4 absorbs. Under its question 1 (a), no web `ReadableStream` is needed
  for `fs`.

## Regression risk

Unit 1 changes the lifecycle of every stream rifty builds itself: 13 constructions in 7 files, plus
5 subclasses in 4 files.

- Kernel: `process-manager.ts:700-701` (child stdout/stderr Readables) and `worker-stdin-writer.ts:7`.
- runtime-js:
  - `child_process.ts:323,475-476` and `child_process-exec.ts:71`;
  - `process-file-stdout.ts:16`;
  - `worker_threads-stdio.ts:41-42`;
  - `ipc/no-coi-child-process.ts:48-50`;
  - `zlib.ts:243` (`Gzip extends Transform`).
- net: `http/request.ts:229,272` (`IncomingMessage`, `IncomingMessageFromFetch`).
- isolate guest: `ceiling-zlib.ts:46`, `egress-net.ts:95`.

Lanes that catch it:

- `test:parity` (stream 71, fs 41, child_process 35, process 36, worker_threads 20, http 14, zlib 7
  cases);
- `test:run` conformance (`builtins/stream*.test.ts`, `child_process*.test.ts`,
  `http-incoming-body.test.ts`, `zlib.test.ts`, `fs-streams.test.ts`);
- the isolate-host corpus and library tests;
- e2e-chromium, whose shell, npm and dev-server specs consume child stdio.

What they do not catch:

- Destroy and error paths on these internal streams. Only `net/src/http/request.test.ts` and
  `conformance/builtins/zlib.test.ts` call `destroy` on them; nothing destroys child stdout/stderr or
  worker stdio mid-stream.
- Chromium ordering. Parity runs on Node's event loop (trap `parity-runner-in-process`), and the e2e
  only shows happy paths.
- The no-COI child-process stdio. Only the no-coi lane covers it.

So unit 1 adds a destroy/error row per internal stream kind (child stdio, worker stdio,
`IncomingMessage`) to its acceptance.

## Faults outside parity

These are reachable failures that are not plain Node behaviour, so parity alone does not prove them.
They are input to the tier question.

- **VFS failure during a read or write.** OPFS I/O error, quota exceeded, or an owner-RPC timeout on
  the browser hosts' fd read/write. What `'error'` code and message reach the stream?
- **Durability.** `'finish'`/`'close'` on an OPFS-backed `WriteStream` before the write-through has
  drained (trap `write-ack-not-durable`).
- **Host kill mid-stream.** Isolate `memoryLimit` termination, sandbox `destroy`, or a worker
  terminated mid-stream: partial files (`distribution/isolate-host-sandbox-killed-run-partial-writes`).
- **Memory ceilings.** A guest that ignores backpressure (Node's memory only grows) meets the isolate
  `memoryLimit` or the browser worker's ceiling sooner than Node's RSS.
- **Starvation.** A huge synchronous source starving timers. #437 measured 0 `setInterval` ticks while
  16 MiB streamed in microtasks. Node interleaves I/O callbacks.

Under `works` these may throw loudly; each must still be honest, never a silent truncation.

## Open questions

- Which e2e harness carries the carrier in Chromium on Workbench and SDK, with Chromium 108 as the
  tier floor (ADR-0469) — owner: agent — settled by unit 0.
- A read through an fd after unlink/rewrite of the file. Node keeps the open inode; rifty's
  `FsSync`/`Vfs` have no open-file handle (`fs-read-stream-reads-snapshot-not-open-file`, branch
  only) — owner: agent — probed in unit 4 against `fs.open`/`fs.read` on each VFS. Until then it is a
  ⚠️ row, not part of I4's matrix.
- Whether exceljs's in-process crash «Chunk must be one of type String, Buffer or StringBuf» comes from
  the fs stream (a string chunk out of the hand-written `pipe`) or from a core gap — owner: agent —
  re-run of the carrier after unit 4.

## Out of scope

- **Next goal candidates, same root (hand-written EventEmitter, not `Readable`/`Writable`/`Duplex`)**:
  - `http.ServerResponse` (`net/src/http/response.ts:40`);
  - `ClientRequest` (`net/src/http/server.ts:297`);
  - `net.Socket`/`PortRegistrySocket` (`net/src/http/request.ts:90`), and the isolate's loud
    `net.Socket`;
  - `process.stdin` (`runtime-js/src/builtins/process-stdin-reader.ts:28`).
  Related drafts: `process-stdio-writable-end-surface`, `child-process-stdio-stream-slot`. Manager's
  scoping, user confirmation pending.
- **Web streams**: `web-stream-adapter-terminal-lifecycle`, the isolate `ReadableStream` (goal
  isolate-guest-web-api), `vfs/memory-vfs-openreadable-true-backpressure` (no longer on the fs path
  after unit 4).
- **Performance**: `perf/io-stream-single-schedule-drain`, `kernel/binary-stdio-messageport-backpressure`.
- **node:zlib**: goal node-zlib-on-every-host.
- **Core residuals on no unit's path**, each staying a draft:
  - `pipe-unpipe-destination-events`, `readable-flow-new-listener-hook`, `readable-from-iterator-lifecycle`;
  - `readable-pipe-ended-source`, `readable-read-option-non-function`,
    `readable-set-encoding-string-decoder-residue`, `readable-sized-read-hwm-growth`;
  - `stream-byte-chunk-kinds`, `stream-internal-listener-registration`, `duplex-from-source-ownership`,
    `add-abort-signal-reason-identity`.
  Manager's scoping, user confirmation pending. Any of them the carrier hits becomes a unit, reported
  to the manager first.
- **Other areas**:
  - `cjs-record-guest-writable-lifecycle` (module loader);
  - `fs-promises-filehandle` (FileHandle API; `filehandle.createReadStream` follows unit 4 when that
    API lands);
  - `readline-chunk-stateful-decode`;
  - `builtin-function-names`, `guest-builtin-names`;
  - `fs-mode-arguments-ignored` (VFS has no modes).
