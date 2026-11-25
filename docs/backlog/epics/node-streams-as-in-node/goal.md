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
- The Readable/Writable state every subclass shows: `readableFlowing`, `isPaused()`, `writableNeedDrain`.
- The legacy `Stream` in the class chain.
- `fs.ReadStream` and `fs.WriteStream` as Node's `Readable`/`Writable` subclasses, in every class
  shape packages use (`new`, without `new`, `X.apply(this)`, `extends`, overridden `open`).
- `Transform` backpressure, `Duplex` members and event order.
- `pipeline` with function and async-generator stages.

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
   source held back by backpressure (in-flight ≤ 1 MiB; Node 65536).
6. `stream/promises.pipeline(fs.createReadStream(src), async function* (s) {…}, fs.createWriteStream(dst))`.

The stdout and every file written are what real Node produces from the same files.

## Invariants

<!-- False on main b6d37fc01 (reference/results/, real Node v24.16.0 vs rifty modules in-process
with and without the async VFS surface vs isolate sandbox exec; summary.txt):
- carrier, 9 programs, every one differs on every rifty column:
  - xlsx.readFile: isolate "TypeError: stream.close is not a function"; in-process crashes with
    exit 1 "Chunk must be one of type String, Buffer or StringBuf".
  - csv.readFile: "stream.close is not a function" in-process; isolate "isolate-host.ReadableStream".
  - graceful-fs: "Class constructor FileWriteStream cannot be invoked without 'new'".
  - unzipper STORE: in-process 'close' with nothing extracted (listing → ENOENT); isolate
    "isolate-host.ReadableStream".
  - for await: "is not async iterable".
  - late listener: 0 of 200000 bytes, no 'end'.
  - readable/read: 0 of 150000 bytes.
  - 16 MiB Transform: in-flight 16777216 (Node 65536); isolate "isolate-host.ReadableStream".
  - pipeline with async generator: "pipeline: argument must be a stream (index 1 …)".
- m1: 1 of 12 rows equal; the hook matrix 10 of 76.
- m2: 0 of 5; m3: 0 of 4.
- m4: 3 of 18 in-process, 2 of 18 isolate; m5: 4 of 14.
- m6: 0 of 8; m7: 0 of 7. -->

- I1. Lifecycle is Node's on every stream class and every way of defining a hook (option, own,
  class, ES5, chain, late): `_construct` before the first `_read`/`_write`, `_destroy` with its error
  replacement, a hook's callback once (`ERR_MULTIPLE_CALLBACK`), the synchronous destroy moment,
  `errored`, and `'close'` after `'end'`/`'finish'` (`autoDestroy`).
- I2. `readableFlowing`, `isPaused()` and `writableNeedDrain` report Node's values on every
  Readable/Writable/Duplex and every subclass.
- I3. `Readable` and `Writable` inherit the legacy `Stream` (`instanceof Stream`, `Stream.prototype.pipe`)
  as in Node.
- I4. `fs.ReadStream` is Node's `Readable` subclass on every host:
  - every member and value Node shows;
  - the class shapes (`ReadStream(p)` without `new`, `ReadStream.apply(this)`, `extends`, an
    overridden `open`);
  - paused-mode buffering, so no data is lost to a late listener;
  - `for await`, `read()`, `setEncoding`, `pause`/`resume`, `close(cb)`, `destroy(err)`, `pipe`
    backpressure.
- I5. `fs.WriteStream` is Node's `Writable` subclass on every host, with the same class shapes
  (graceful-fs `WriteStream.apply(this)` + overridden `open`), members, `drain`, `cork`,
  `close(cb)`, `destroy(err)` and event order.
- I6. `Transform`/`PassThrough` hold backpressure as in Node (`write()` turns false, `_transform`
  waits for the reader). `Duplex` has Node's writable members and per-side options, and emits
  `'data'`/`'finish'`/`'end'`/`'close'` in Node's order.
- I7. `pipeline`/`stream/promises.pipeline` accept function and async-generator stages as Node does
  (source, transform, sink, returned value, errors). Their and `finished`'s success callbacks get
  Node's arguments.
- I8. The scenario programs print Node's stdout and write Node's files on every host.

## Challenge

challenge: <pending — fresh critic over the request, goal, map and probe>

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
  - the legacy `Stream` chain, I3;
  - `'close'` after `'end'` (`autoDestroy`) moved into the lifecycle, I1;
  - `Duplex` surface and order with `Transform` backpressure, I6.
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
  rounds).
- rejected route: an `fs.ReadStream` that reads through `Vfs.openReadable` (a web `ReadableStream`) —
  violates Outcome «every rifty host». The isolate guest has no `ReadableStream` (`m4`, isolate:
  `NotImplementedError isolate-host.ReadableStream`). Node's own source is `fs.open`/`fs.read(fd)`,
  which works on every host today (`m4` row «Node's ReadStream source»).
