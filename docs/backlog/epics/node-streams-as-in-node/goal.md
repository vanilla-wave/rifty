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
  `errored`/`closed`, `autoDestroy`.
- The Readable/Writable state every subclass shows: constructor option and `write` encoding
  validation, `readableFlowing`, `isPaused()`, `writableNeedDrain`, `Symbol.asyncDispose`.
- The legacy `Stream` in the class chain.
- `fs.ReadStream` and `fs.WriteStream` as Node's `Readable`/`Writable` subclasses, in every class
  shape packages use (`new`, without `new`, `X.apply(this)`, `extends`, overridden `open`).
- `Transform` backpressure, `Duplex` members and event order.
- `pipeline` with function and async-generator stages; `pipeline`/`finished` completion.
- What the streams stand on: `string_decoder` and `Buffer` encodings, `events.addAbortListener`,
  `fs` callbacks completing in an I/O turn, `fs.writev`/`fs.fsync`.

Libraries reading and writing through them get Node's bytes and values. Gaps outside stay named loud
throws (compat ❌/⚠️).

## User scenario

One set of programs and their input files, run as `node <program>` by real Node v24.16.0, by the
isolate host (sandbox `exec`) and by a browser host (Chromium, Workbench and SDK). The programs are
the `c-*` carrier programs of `reference/programs/`. Each file written is compared by content: by
sha256, or by the values a reload reads.

1. exceljs 4.4.0 writes `in.xlsx`, then `xlsx.readFile` (an `fs.createReadStream` + `for await`
   under it) reads it back. A cell is edited, `xlsx.writeFile` writes `out.xlsx`, and a reload reads
   Node's values. exceljs `csv.writeFile` writes Node's bytes.
2. exceljs `csv.readFile` reads a CSV (`createReadStream().pipe(fast-csv parse)`).
3. graceful-fs 4.2.11 `createWriteStream` then `createReadStream`. unzipper 0.10.14 `Extract`
   (fstream → graceful-fs) unpacks a STORE zip into a directory with Node's bytes.
4. `for await (const chunk of fs.createReadStream(f))`. A `'data'` listener attached after several
   `await`s. An `on('readable')` + `read()` loop.
5. A 16 MiB file of distinct bytes through an async `Transform` into an `fs.WriteStream`: Node's
   bytes, with the source held back by backpressure (stdout `maxInFlight<=1MiB true`; Node's
   in-flight 65536).
6. `stream/promises.pipeline(fs.createReadStream(src), async function* (s) {…}, fs.createWriteStream(dst))`.

The stdout and every file written are what real Node produces from the same files.

## Invariants

<!-- False on main (probe run at e96e93a0d, main 4f6fa7d98's product code + this docs-only branch;
reference/results/summary.txt; columns: real Node v24.16.0, rifty modules in-process with and
without the async VFS surface, isolate sandbox exec):
- carrier, 10 programs; 9 differ on every rifty column, `c-csv-write-file` (exceljs csv.writeFile)
  is equal today:
  - xlsx.readFile: "TypeError: stream.close is not a function" (in-process and isolate);
  - csv.readFile: "stream.close is not a function" in-process; isolate "isolate-host.ReadableStream";
  - graceful-fs: "Class constructor FileWriteStream cannot be invoked without 'new'";
  - unzipper STORE: in-process 'close' with nothing extracted (listing → ENOENT); isolate
    "isolate-host.ReadableStream";
  - for await: "is not async iterable"; isolate also exit 1 (uncaught isolate-host.ReadableStream);
  - late listener: 0 of 200000 bytes, no 'end'; isolate exit 1;
  - readable/read: 0 of 150000 bytes; isolate exit 1, no 'end';
  - 16 MiB Transform: bytes equal, maxInFlight<=1MiB false (in-flight 16777216, Node 65536); isolate
    "isolate-host.ReadableStream";
  - pipeline with async generator: "pipeline: argument must be a stream (index 1 …)"; isolate exit 1.
- rows equal to Node, in-process / isolate:
  - m1 0/14; hook matrix 10/76; m2 0/7; m3 0/4;
  - m4 3/22 / 2/22 (plus uncaught-error lines: 2 in the sync-only column, 14 in the isolate);
  - m5 5/15; m6 0/8; m7 0/11; m8 6/16 (the 6 are options both accept or both reject);
  - b1 (bindings) 3/8.
- I9–I10 false: b1 (StringDecoder utf8 only, 'UTF8' "Unsupported encoding", no addAbortListener, no
  writev/fsync); m4 fs.read loop ticks>0=false; Workbench fd read/write 16 MiB in 64 KiB calls
  18.5–26 s / 50–82 s vs Node 3–7 ms (results/chromium-fd/).
- Chromium 148 on main c2d03ce05 (results/chromium/summary.txt): Workbench and SDK give the same
  route-A outcomes as in-process, row for row (e.g. m1 0/14, hook matrix 10/76, m6 0/8). -->

- I1. Lifecycle is Node's on every stream class and every way of defining a hook (option, own,
  class, ES5, chain, late): `_construct` before the first `_read`/`_write`, `_destroy` with its error
  replacement, a hook's callback once (`ERR_MULTIPLE_CALLBACK`), the synchronous destroy moment,
  `errored`, `closed`, and `'close'` after `'end'`/`'finish'` (`autoDestroy`).
- I2. Every Readable/Writable/Duplex/Transform and every subclass validates its constructor options
  (`highWaterMark`, `readableHighWaterMark`/`writableHighWaterMark`, `signal`, `encoding`,
  `defaultEncoding`) and the `write` encoding argument (`''` = default) as Node does. It reports
  Node's `readableFlowing`, `isPaused()` and `writableNeedDrain`, and has Node's
  `[Symbol.asyncDispose]`.
- I3. `Readable` and `Writable` inherit the legacy `Stream` (`instanceof Stream`,
  `Stream.prototype.pipe`) as in Node.
- I4. `fs.ReadStream` is Node's `Readable` subclass on every host:
  - every member and value Node shows;
  - the class shapes (`ReadStream(p)` without `new`, `ReadStream.apply(this)`, `extends`, an
    overridden `open`);
  - paused-mode buffering, so no data is lost to a late listener;
  - `for await`, `read()`, `setEncoding` and the `encoding` option for every encoding across chunk
    boundaries, `pause`/`resume`, `close(cb)`, `destroy(err)`, `pipe` backpressure;
  - timers and other callbacks keep running while a file streams, as Node interleaves them.
- I5. `fs.WriteStream` is Node's `Writable` subclass on every host, with the same class shapes
  (graceful-fs `WriteStream.apply(this)` + overridden `open`), members (`_writev` included),
  `drain`, `cork`, `close(cb)`, `destroy(err)` and event order.
- I6. `Transform`/`PassThrough` hold backpressure as in Node (`write()` turns false, `_transform`
  waits for the reader). `Duplex` has Node's writable members and per-side options, and emits
  `'data'`/`'finish'`/`'end'`/`'close'` in Node's order.
- I7. `pipeline`/`stream/promises.pipeline` accept function and async-generator stages as Node does
  (source, transform, sink, returned value, errors, the `signal` passed to stages). `finished`
  reports `ERR_STREAM_PREMATURE_CLOSE` for a stream closed before it ended. The success callbacks
  of both get Node's arguments.
- I8. The scenario programs print Node's stdout and write Node's files on every host.
- I9. `string_decoder` decodes every encoding Node's does (latin1, utf16le included) and rejects an
  unknown one with `ERR_UNKNOWN_ENCODING`. `Buffer` accepts every spelling of an encoding name
  Node's `normalizeEncoding` accepts (`'UTF8'`, `'LATIN1'`, …). `events.addAbortListener` exists as
  in Node.
- I10. `fs` callback APIs complete in an I/O turn as in Node, so timers interleave with a chain of
  `fs.read`/`fs.write` callbacks. A positional fd read or write moves only its range, not the whole
  file, so reading or writing a file in chunks scales linearly. `fs.writev` and `fs.fsync` (and their
  `Sync` forms) exist as in Node.

<!-- No I11: review S7 (a WriteStream file complete after 'finish' + exit + reload on
Workbench/OPFS) holds today, 18/18 (reference/results/chromium/durability.jsonl); unit 9 guards it. -->

## Challenge

challenge: 2026-11-25 — 1 blocker, 5 major, 14 minor, nits. One fresh read-only critic ran over the
route-B rewrite: goal, map, ADR-0575, the probe, the seeded drafts and the zlib edits. Its verdict:
«не готово». It reproduced the generator (sha `53e386…`), S1 and the AbortController sizes. Each
finding was verified:

1. blocker — the bundle budget. The «≈+27 KB» for the zlib engine had no source. It is now an
   `owner: user` question in map §Open questions, so the goal stays draft. Round 2 re-measured the
   numbers on main `692babe13` (below).
2. major — the Chromium 108 floor: `AbortSignal.any`, `Symbol.dispose`/`asyncDispose`, and the probe's
   `Promise.withResolvers`. Now in ADR-0575 §2 and unit 8's acceptance (`check:es-floor`, floor lane).
3. major — the «write before close lands» half of I10 is true on main (`b1`, fs parity A 6/6). It was
   removed from I5, I10, unit 4 and the ADR, and is a guard row now.
4. major — a hidden 8→9 dependency: the fs-stream rows of `m2`/`m3` moved into unit 9's acceptance.
5. major — `pipe` into `ServerResponse` would lose backpressure after unit 8 (Promise-returning
   `write`, ADR-0154 D3). It now has a regression row and unit 8 moves `ServerResponse.write` to
   `false` + `'drain'`. ADR-0154 D3 is listed as superseded.
6. major — the Superseded section was inaccurate: 0034 §1 stays, 0069 is superseded wholly, the 0237
   reference is fixed, 0239 and 0154 D3 are added, and 0458 stays.
7–20. minor, all fixed:
   - the order wording was made consistent;
   - unit 8's entry criteria were corrected, and `m4` numbers updated;
   - the AbortController choice is stated in one place;
   - Decision 2's binding list completed, with the host `EventTarget` gap;
   - regression list fixed (`egress-http.ts`; `upgrade-socket` and `ending`/`ended` corrected);
   - B2 measured through `'data'`: today base64/latin1/hex equal Node in-process, and route B throws
     until unit 1;
   - the rejected route A is now argued on risk and §Simplicity;
   - I11 became a candidate and its child is not seeded;
   - I8 is owned by unit 9;
   - `zlib-diff` became zlib unit 3's own entry check (unit 8 commits its differential as a CI test);
   - stale zlib docs were updated;
   - probe limits are named in the README;
   - AbortController sizes are in `results/route-b-size.txt`;
   - README columns and units fixed.

   Nits fixed: 23 + 5 modules, `AbortController2`, the 6402 test lines, «compared by content»,
   `flush: true` → `ERR_INVALID_ARG_TYPE`, 13/14 adapter cases, `main`/`sw` −27/−43 B, the zlib
   probe label, the zlib map path. Duplicate noted: `node-builtins-loud-stub-capability-gaps` overlaps
   unit 1.

Not re-reviewed after these fixes.

Previous checks of the route-A draft (kept as history; their fixes carried over where still meant):

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

Re-check 2026-11-25 (a second fresh reviewer over the fix commit `71919b2b0`) found 2 major, 4 minor and
4 nit problems; all verified and fixed:

- major — the zlib links mixed `f4f9c7ded` and `da3ae64cb`. They are re-pinned to `da3ae64cb`, whose
  units are 2 engine, 3 `lib/zlib.js` (`zlib-diff` = 0), 4 under load, and the line is rewritten.
- major — the `m1` rows «zlibBuffer shape» and «async Transform success» also carry the Transform
  order. They are now a fourth joint group (units 1 + 6).
- minor — stale numbers in two drafts; the shared `_construct` part was missing from the 4/5 drafts;
  «through fd» in unit 4's title pre-decided its ADR; unit 2's draft lacked its goal scope.
- nit — the per-column extra lines; the `m8` comment (a non-function hook option is ignored, not
  validated); `lib/zlib.js:565-566`; the README order.

Added after it, from the zlib goal via the manager, not re-reviewed:

- `[Symbol.asyncDispose]` → unit 2 (`m2`: Node has it on all five classes, rifty on none).
- The 46-scenario `zlib-diff` (`ed8c785f1`). Each gap row is assigned to a unit in map §Links.
- `m7` rows for `finished` after a write and after an error.

External review of PR #450, round 2 (at `1df9e5f9a`, relayed by the manager): 2 blocker, 9 should,
nits. Route B was confirmed: the 28 input files equal live v24.16.0's `natives`, and every column
reproduced. All items were fixed:

- **B1** — the budget was taken against a stale base. It is re-measured on main `692babe13`
  (`results/route-b-product-build-main.txt`): generic 312 037, toolchain 355 626. With the zlib
  engine and its handle the reviewer measured 351 690 / 394 735, both over the cap.
- **B2** — the bench is regenerated (41 / 22 ms).
- **Should items:**
  - 8 split into 8a/8b/8c with a merge order;
  - the 8→3 edge was false, so unit 3 is guest API only;
  - unit 7's classes are reachable: the fact is recorded, and the globals fork is the user's;
  - Chromium route B ran on the SDK (12/12);
  - the fd I/O premise was measured and was quadratic in Workbench → 4b/4c, P, and 9r/9w split (the
    manager's «ок»);
  - identifier renaming is measured (`results/route-b-minify.txt`);
  - es-floor rows are in 8c;
  - S5 consumer rows were measured and moved into 8b/8c;
  - the zlib-constants coupling goes to 8a;
  - the license manifest goes to 8a;
  - ADR-0154's superseded parts are listed;
  - nits fixed.
- Not re-reviewed after these fixes.

External review of PR #450, round 3 (at `4e0b2b4ba`, relayed by the manager): 4 blocker, 6 should,
nits. All are verified and fixed:

- **Blockers.**
  - B1: 9r's `c-unzip-stored` changes from a silently empty directory to a loud `TypeError`; this is
    now declared, not called «as today».
  - B2: OPFS range I/O goes through the authoritative cache plus a range-aware write-through, not the
    disk.
  - B3: 8a's acceptance follows `results/ownership.txt`, with later units' rows pinned RED;
    `zlib-diff` moved out of 8a into zlib unit 3.
  - B4: the Workbench carrier puts the closure in `/tmp` (PR #453 helpers, 11–12 s). Route B: 5/5
    closure programs equal Node; no edge 0 ← P.
- **Should items.**
  - S1: a dependent `AbortSignal.any` binding was proposed for the abort hidden by a guest
    `stopImmediatePropagation`. **Corrected in round 4:** «`m9` equals Node» was false (a probe bug
    printed one value for every column), and the fix is recalled (below).
  - S2: Storage fault rows were added to 4c.
  - S3/S4: a per-host fd table (`results/fd-hosts.txt`); `perf/fs-rpc-chunk-perf` absorbed in halves.
  - S5: window rows measured and pinned (`w1-fs-windows`).
  - S6: every reference is derivable from the tree (README provenance table; logs in `results/`).
- **Mechanism.** The graph is derived from the row-ownership table (`ownership.mjs`), not from prose.

Not re-reviewed after these fixes.

External review of PR #450, round 4 (at `e96e93a0d`, relayed by the manager): 6 blocker, 10 should,
nits. The manager changed the mode (Decisions): only units 0–4b are made ready; the rest stay draft
and carry the findings verbatim in «Open findings (review round 4)». Fixed in the tree:

- B1: `m9` had a probe bug (the `map` row printed `5` on every column and never consumed the
  promise). Rewritten, plus `m10` (order and leftover listeners); regenerated on variant A.
- B6: gitignored `*.log` files renamed to `.log.txt`; 351 690 / 394 735 are labelled «review
  measurement of 25.11».
- Ownership table: labelled auxiliary (in-process + isolate; not SDK, not Workbench carrier/matrices);
  isolate rules by name recorded as a known limit; the `out.splice` bug removed; the timer rule added
  (`m5` 16 MiB timers row, Workbench `chromium-d` ticks), so 9w ← 4 and Workbench read ← 4 return.
- B5: windows are «pinned on their window's outcome (the window column); changes against today are
  listed and declared» — the six rows are in map §Regression risk.
- 4b: fault rows, one ADR for positional read+write in 4b, SDK fd read in `results/chromium-fd/sdk.jsonl`.
- Units 1–4: acceptance as concrete rows plus parity cases; unit 3 promises guest API only.
- The abort binding: reverted to variant A (Node's `abort_listener.js` whole, 28 modules = 23 + 5);
  variants A–D go to `runtime-js/stream-core-abort-listeners-host-event-target` (draft).
- Nits: closure programs 5/5; `chromium-d` 1-of-3 medians labelled; minify skips named; `opfs-sync.ts`
  lines; 9w after 9r is order, not a code dependency.

External review of PR #450, round 5 (limited, at `ec9033a62`, relayed by the manager): false
statements and ready-unit contracts. Fixed: unit 1 drops two `m4` rows that are 9r's and shares unit
2's normalisation point (edge 1 ← 2); unit 2 takes Node's parsing of base64/hex input outside the
alphabet; unit 0 pins whole outcomes with PR #453's masks, takes its own Chromium baseline, skips
`c-transform-big` on Workbench until 4b/4c, names lanes, a time limit and case independence; units 4
and 4b fault rows follow the SAB sync-RPC model; 4b counts bytes leaving `FsSync` and lists every
implementation; AL has no default candidate, the whole variants table goes to the user; commit and
column labels corrected.

## Decisions

- 2026-11-25 — manager, under the user's delegation («проектируешь ты сам»); the user is informed,
  confirmation pending. Route B: the stream core is Node v24.16.0's `lib/stream.js`,
  `lib/stream/promises.js` and `lib/internal/streams/*.js`, and fs streams are
  `lib/internal/fs/streams.js`, all unedited (ADR-0575). Ground: the probe's route B equals Node on
  every row of the carrier and of `m1`–`m3`, `m6`, `m7` and the hook matrix, in-process; every other
  difference traces to a binding.
- 2026-11-25 — manager: fs streams are subclasses of the core `Readable`/`Writable`, and the
  hand-written EventEmitter classes are retired. Under route B this is Node's own `streams.js`.
  Basis:
  - Node's `ReadStream`/`WriteStream` are subclasses driven by `_construct`, `_read`/`_write` and
    `_destroy` (`lib/internal/fs/streams.js:230,250,300,401,421,526`);
  - ADR-0020 decided «exposes a Node `Readable` honoring backpressure», and that was not done;
  - PR #434 needed three review rounds on the EventEmitter classes.
- 2026-11-25 — manager: the binding gaps the probe found are fixed as their own units, before the unit
  that needs them. They are parity fixes that hold without the core. I9–I10 are new obligations
  after the user's «ок» (the manager's extension; user informed, confirmation pending). Review S7's
  durability holds today (18/18), so it is a guard, not an invariant.
- 2026-11-25 — the user, in the manager thread cf2ae711: «про потоки тут ок» to the manager's «Нужно от тебя: «ок» на состав и порядок и на уровень works, как у остальных целей». What that message put before the user: four parts in order — (1) `_destroy`/`_construct` hooks in the core, (2) `fs.ReadStream` as a `Readable` subclass, (3) `fs.WriteStream` as a `Writable` subclass in the shape graceful-fs expects, (4) `Transform` backpressure; outside the goal `http.ServerResponse`, `net.Socket`, `process.stdin` as the next goal's candidates; PRs #434 and #437 stay parked until the goal absorbs them; tier works. The later growth to the present units (the manager's extensions above) was reported to the user in the same thread on 2026-11-25 as «возрази, если не согласен»; no objection recorded.
- tier: works — the user's choice (line above). Faults outside Node's own
  behaviour, so not covered by parity, are listed in map §Faults outside parity.
- 2026-11-25 — manager, round 2:
  - 4b (fd read by range) and 4c (fd write by range) are separate units;
  - the publication cost per mutation (`perf/workbench-guest-write-cost-grows-with-project`) is a unit
    of this goal;
  - fs streams split into 9r (read; ← 8, 4, 4b) and 9w (write; ← 8, 4, 4c, 5, the publication cost);
  - the core lands as 8a/8b/8c;
  - the isolate `AbortController` globals are a fork for the user, carried with the Web API goal's
    question 1.

  Ground: Workbench fd I/O moves the whole file per call (`results/chromium-fd/`), and the read side
  (exceljs `readFile`, `for await`, late listener, isolate read) needs none of the write work.
- 2026-11-25 — manager, round 3: the unit graph is derived from a generated row-ownership table, so a
  unit's acceptance is «my rows green, later owners' rows pinned on today's outcome». The carrier's
  Workbench closure goes to the guest's `/tmp`. The S1 abort fix is the core binding's (8a) —
  recalled in round 4.
- 2026-11-25 — manager, round 4:
  - the goal merges with `status: draft`, waiting for the user's answers (budget, «ок» on route B,
    `AbortController` globals);
  - ready now: 0 (carrier), 1, 2, 3, 4, 4b — none depends on route B or the budget;
  - draft: 4c, 5, P, 7, 8a, 8b, 8c, 9r, 9w and the new abort-listeners unit, each carrying its
    round-4 findings verbatim;
  - acceptance formula: a unit's rows go green; later owners' rows stay pinned on their window's
    outcome, and changes against today are listed and declared;
  - abort listeners on a host `EventTarget`: the derived-signal fix is recalled; the probe runs
    variant A; variants A–D are the draft unit's to decide, D joins the user's globals question.
- 2026-11-25 — manager, round 5: last pass before merge. AL has no default candidate: (A) hangs where
  today throws, and a hang is not declarable; the variants table (today / A / B / C / D) is the
  user's question with the globals.
- rejected route: route A, rifty's hand-written streams fixed per member in 8 units. It could meet the
  invariants in principle; it is rejected on delivery risk and §Simplicity, not on an invariant. Its
  unit graph had three hidden dependencies after one review, the same class that broke the zlib goal
  twice and PR #434 three times (ADR-0575 §Alternatives).
- rejected route: complete the EventEmitter fs classes (PR #434's route) — violates I4/I5. They stay
  outside `instanceof Readable`/`Writable`, `stream.isReadable`, `Readable.from` and every
  `Readable.prototype` member.
