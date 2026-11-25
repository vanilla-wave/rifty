---
kind: epic
status: draft
title: Node streams as in Node — stream lifecycle, fs.ReadStream/WriteStream as Readable/Writable, Transform backpressure, pipeline stages
created: 2026-11-25
value: A program that reads or writes files through fs streams, pipes them through Transform/Duplex or pipeline stages — exceljs, fast-csv, graceful-fs/fstream/unzipper or its own code — runs in any rifty host as in Node, no silent empty reads, no unbounded buffering.
user_story: As an agent running model-written Node code in rifty, I want `fs.createReadStream`/`createWriteStream`, `for await`, `pipeline` with an async generator and the libraries built on them to work as in Node, but today fs streams are not `Readable`/`Writable` (no `for await`, a late listener reads nothing, graceful-fs throws), stream hooks `_construct`/`_destroy` never run and `Transform` buffers without bound
tier: works
---

## Outcome

On every rifty host behaviour is Node v24.16.0's. The hosts are the browser hosts (Workbench, SDK)
and the isolate host guest. Covered:

- The stream lifecycle: `_construct`, `_destroy`, a hook's callback called once, the destroy moment,
  `errored`, `autoDestroy`.
- The Readable/Writable state every subclass shows: constructor option and `write` encoding validation,
  `readableFlowing`, `isPaused()`, `writableNeedDrain`.
- The legacy `Stream` in the class chain.
- `fs.ReadStream` and `fs.WriteStream` as Node's `Readable`/`Writable` subclasses, in every class
  shape packages use (`new`, without `new`, `X.apply(this)`, `extends`, overridden `open`).
- `Transform` backpressure, `Duplex` members and event order.
- `pipeline` with function and async-generator stages; `pipeline`/`finished` completion.

Libraries reading and writing through them get Node's bytes and values. Gaps outside stay named loud
throws (compat ❌/⚠️).

## User scenario

One set of programs and their input files, run as `node <program>` by real Node v24.16.0, by the
isolate host (sandbox `exec`) and by a browser host (Chromium, Workbench and SDK). The programs are
the `c-*` carrier programs of `reference/programs/`.

1. exceljs 4.4.0 writes `in.xlsx`, then `xlsx.readFile` (an `fs.createReadStream` + `for await`
   under it) reads it back. A cell is edited, `xlsx.writeFile` writes `out.xlsx`, and a reload reads
   Node's values.
2. exceljs `csv.readFile` reads a CSV (`createReadStream().pipe(fast-csv parse)`).
3. graceful-fs 4.2.11 `createWriteStream` then `createReadStream`. unzipper 0.10.14 `Extract`
   (fstream → graceful-fs) unpacks a STORE zip into a directory.
4. `for await (const chunk of fs.createReadStream(f))`. A `'data'` listener attached after several
   `await`s. An `on('readable')` + `read()` loop.
5. A 16 MiB file through an async `Transform` into an `fs.WriteStream`: Node's bytes, with the
   source held back by backpressure (stdout `maxInFlight<=1MiB true`; Node's in-flight 65536).
6. `stream/promises.pipeline(fs.createReadStream(src), async function* (s) {…}, fs.createWriteStream(dst))`.

The stdout and every file written are what real Node produces from the same files.

## Invariants

<!-- False on main b6d37fc01 (probe run at 17c24ffbc = main's code + this docs-only branch; reference/results/, real Node v24.16.0 vs rifty modules in-process
with and without the async VFS surface vs isolate sandbox exec; summary.txt):
- carrier, 9 programs, every one differs on every rifty column:
  - xlsx.readFile: "TypeError: stream.close is not a function" (in-process and isolate).
  - csv.readFile: "stream.close is not a function" in-process; isolate "isolate-host.ReadableStream".
  - graceful-fs: "Class constructor FileWriteStream cannot be invoked without 'new'".
  - unzipper STORE: in-process 'close' with nothing extracted (listing → ENOENT); isolate
    "isolate-host.ReadableStream".
  - for await: "is not async iterable"; isolate also exit 1 (uncaught isolate-host.ReadableStream).
  - late listener: 0 of 200000 bytes, no 'end'; isolate exit 1.
  - readable/read: 0 of 150000 bytes; isolate exit 1, no 'end'.
  - 16 MiB Transform: maxInFlight<=1MiB false, in-flight 16777216 (Node 65536); isolate
    "isolate-host.ReadableStream".
  - pipeline with async generator: "pipeline: argument must be a stream (index 1 …)"; isolate exit 1.
- rows equal to Node, in-process / isolate: m1 0/14, 0/14; hook matrix 10/76, 10/76;
  m2 0/5; m3 0/4; m4 3/20, 2/20 (+2/+10 lines of uncaught errors); m5 4/14; m6 0/8; m7 0/9;
  m8 6/16 (the 6 are options both accept or both reject). -->

- I1. Lifecycle is Node's on every stream class and every way of defining a hook (option, own,
  class, ES5, chain, late): `_construct` before the first `_read`/`_write`, `_destroy` with its error
  replacement, a hook's callback once (`ERR_MULTIPLE_CALLBACK`), the synchronous destroy moment,
  `errored`, `closed`, and `'close'` after `'end'`/`'finish'` (`autoDestroy`).
- I2. Every Readable/Writable/Duplex/Transform and every subclass validates its constructor options
  as Node does (`highWaterMark`, `readableHighWaterMark`/`writableHighWaterMark`, `signal`,
  `encoding`, `defaultEncoding`) and the `write` encoding argument (`''` = default) as Node does. It
  reports Node's `readableFlowing`, `isPaused()` and `writableNeedDrain`.
- I3. `Readable` and `Writable` inherit the legacy `Stream` (`instanceof Stream`, `Stream.prototype.pipe`)
  as in Node.
- I4. `fs.ReadStream` is Node's `Readable` subclass on every host:
  - every member and value Node shows;
  - the class shapes (`ReadStream(p)` without `new`, `ReadStream.apply(this)`, `extends`, an
    overridden `open`);
  - paused-mode buffering, so no data is lost to a late listener;
  - `for await`, `read()`, `setEncoding`, `pause`/`resume`, `close(cb)`, `destroy(err)`, `pipe`
    backpressure;
  - timers and other callbacks keep running while a file streams, as Node interleaves them.
- I5. `fs.WriteStream` is Node's `Writable` subclass on every host, with the same class shapes
  (graceful-fs `WriteStream.apply(this)` + overridden `open`), members, `drain`, `cork`,
  `close(cb)`, `destroy(err)` and event order.
- I6. `Transform`/`PassThrough` hold backpressure as in Node (`write()` turns false, `_transform`
  waits for the reader). `Duplex` has Node's writable members and per-side options, and emits
  `'data'`/`'finish'`/`'end'`/`'close'` in Node's order.
- I7. `pipeline`/`stream/promises.pipeline` accept function and async-generator stages as Node does
  (source, transform, sink, returned value, errors). `finished` reports `ERR_STREAM_PREMATURE_CLOSE`
  for a stream closed before it ended. The success callbacks of both get Node's arguments.
- I8. The scenario programs print Node's stdout and write Node's files on every host.

## Challenge

challenge: 2026-11-25 — 14 problems. One fresh read-only critic ran a premise and final-result check
in one pass over the request, the user's relayed answer, the manager's extensions, goal, map, probe
and seeded drafts. Its verdict: «the premise holds; not ready until 1–8 are fixed». Each finding was
verified and fixed in this draft:

1. major — the in-process xlsx crash («Chunk must be one of type String, Buffer or StringBuf») was a
   harness artefact: the guest's bare `Buffer` was Node's. `inproc.mts` now installs rifty's `Buffer`.
   On the re-run xlsx gives `stream.close is not a function` on every column, and that fog line is
   gone.
2. major — unit 6 is not independent of 1: its three `'close'` rows need `autoDestroy`. Map now says
   so.
3. major — the fs rows of `m2`/`m3` need 4/5 too. They are joint rows now; units 2 and 3 close on the
   plain-stream rows.
4. major — the unlock claims left out units. Scenarios 3, 5 and 6 now name 4 and 5.
5. major — timer starvation is Node-observable, and the fd route reproduces it. It moved from the
   faults list into I4, with `m4` rows: Node `ticks>0=true`, rifty fd loop `false`.
6. major — «fd source works on every host» was wider than the measurement. Now: in-process and
   isolate measured, Chromium unmeasured (owner unit 0/4). The #437 absorption is conditional.
7. major — the fd route reverses ADR-0020's read mechanism without an ADR. The rejected route was
   removed; the read source per host is unit 4's ADR (map fog).
8. major — the zlib links were wrong against `f4f9c7ded`. Fixed: items 2–3; the line proposed for both
   maps; the DEFLATE `Extract`/`createGzip` joint cases are in no carrier and are proposed to the
   zlib carrier.
9. minor — stale pending labels. The manager records the user's words; kept until then.
10. minor — the one `m1` «same» row was vacuous. `_destroy` now marks itself: `m1` 0/14.
11. minor — parity counts are now `*.case.ts` counts.
12. minor — carrier pins now carry exit status and stderr. Scenario 5 prints the bound, and the
    number goes to stderr.
13. minor — shared `_construct`/`_destroy`/callable shape: unit 4 builds it, 5 reuses it, order 4 → 5.
14. nit — `epic:` added to the reused drafts; the two drafts on an unpushed local commit are marked
    so; io-internal constructions added to the regression risk.

## Decisions

- 2026-11-25 — manager: fs streams become subclasses of `@riftydev/io` `Readable`/`Writable`, and the
  hand-written EventEmitter classes are retired. Basis:
  - Node's own `ReadStream`/`WriteStream` are `Readable`/`Writable` subclasses driven by `_construct`,
    `_read`/`_write` and `_destroy` (`lib/internal/fs/streams.js:230,250,300,401,421,526`).
  - ADR-0020 already decided "exposes a Node `Readable` honoring backpressure"; it was not done.
  - PR #434 completed the EventEmitter classes over three review rounds, and each round found another
    missing piece of `Readable`.
  - No cost of, or reason against, the subclass is recorded in the repo.
- 2026-11-25 — manager's extension of the user-approved composition, user informed (adds, narrows
  nothing), on the probe's facts:
  - `pipeline` function/async-generator stages, I7 (`m7`: rifty rejects every non-stream stage);
  - the Readable/Writable state members, I2;
  - constructor option validation, I2 (from the zlib goal's review 2026-11-25: Node's `lib/zlib.js` over
    rifty's `Transform` accepts `{highWaterMark: -1}` and `{signal: 1}` silently; `m8`);
  - the legacy `Stream` chain, I3;
  - `'close'` after `'end'` (`autoDestroy`) moved into the lifecycle, I1;
  - `Duplex` surface and order with `Transform` backpressure, I6.
- 2026-11-25 — the zlib goal's `zlib-diff` (Node's `lib/zlib.js` over Node's vs rifty's `Transform`)
  adds two gaps, placed by mechanism, manager informed:
  - `finished` premature close → I7 (end-of-stream, same completion path);
  - `write(chunk, '', cb)` → I2 (`write` argument normalization).
- 2026-11-25 — agent, by mechanism, reported to the manager:
  - `finished`/`pipeline` callback arguments go with the pipeline stages (same `pipeline.ts`
    completion path), not with the state members;
  - the legacy `Stream` chain is its own unit: it changes the prototype chain of every stream class,
    and the `@riftydev/io` bundle budget (trap `io-treeshake-side-effect`) applies to it.
- tier: works — manager's provisional default, user confirmation pending. Faults outside Node's own
  behaviour, so not covered by parity, are listed in map §Faults outside parity.
- rejected route: complete the EventEmitter classes (PR #434's route) — violates I4/I5. They stay
  outside `instanceof Readable`/`Writable`, `stream.isReadable`, `Readable.from` and every
  `Readable.prototype` member, and would be a second hand copy of `Readable` (PR #434, three review
  rounds). The read source per host (fd reads vs `openReadable`) is unit 4's ADR, map §Open questions.
