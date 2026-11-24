---
area: distribution
status: ready
title: In the isolate guest fs.createReadStream reads an existing file as Node
created: 2026-11-24
why: rifty's own fs read stream reads through `Vfs.openReadable`, which builds a web `ReadableStream` — a ceiling global in the isolate guest — so every `fs.createReadStream` read emits `NotImplementedError('isolate-host.ReadableStream')` where Node reads the file; the guest never named web streams.
user_story: As an agent editing the previous turn's workbook in an isolate sandbox, I want `wb.xlsx.read(fs.createReadStream(path))` to read it, but today the read stream errors before any data
sources: [docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/isolate-host.md, docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md]
code: [packages/isolate-guest/src/guest/entry.ts, packages/vfs/src/memory.ts, packages/runtime-js/src/builtins/fs-streams.ts, packages/isolate-guest/src/guest/web-shim.ts]
---

## Context

Probe 2026-11-24 (`isolate-library-probe/gen/diag-fsread.cjs`, isolate-host sandbox vs Node
v24.16.0): `fs.createReadStream('t.txt')` with a `'data'` listener → Node `abc`; the guest emits
`'error'` `NotImplementedError: Not implemented: isolate-host.ReadableStream` with frames
`new ReadableStream < MemoryVfs.openReadable < FileReadStream.start`; with no `'error'` listener
the run ends exit 1. The guest entry runs `installMemoryFs()` (`entry.ts:46`), so `asyncVfs()` is
set and `FileReadStream` reads via `Vfs.openReadable` (`fs-streams.ts:442`); `MemoryVfs.openReadable`
(`memory.ts:64`, `:74`) returns a web stream; `ReadableStream` is in the guest's
`CEILING_GLOBALS` (`web-shim.ts:348`). Same mechanism class as
`runtime-js/isolate-require-esm-syntax-gaps` (a runtime path on a host global the isolate
withholds). Browser hosts have the global.

Real path: exceljs 4.4.0 `wb.xlsx.read(fs.createReadStream(f))`, `wb.csv.read(fs.createReadStream(f))`
and `wb.xlsx.readFile(f)` (whose catch then hits `runtime-js/fs-stream-close-method-missing`,
masking this error) — the agent's "edit the previous workbook" turn. Consumer-side route:
`wb.xlsx.load(fs.readFileSync(f))`.

`asyncVfs()` has one reader in the guest bundle, `fs-streams.ts:442` (others: `shell` git,
`workbench` — not bundled). With no async surface `FileReadStream` serves from
`syncMirror().readFileBytesSync` — the path the parity runner runs (`run-in-rifty.ts:1643`
`setSyncMirror(fsMirror)`), green vs Node on `fs/createreadstream-byte-range`,
`read-stream-abort-destroy`, `stream-string-options-encoding`, `streams-flags-relative-cwd`.
`MemoryBackend.readFile` returns the stored bytes, no copy, on both paths.

Node v24.16.0 vs rifty @ fbb4468a4 (scratch probe: both rifty paths in-process; isolate via
`runCode` with the guest on the sync mirror only): every row of Parity cases 1–5 equal on both
paths and in the isolate; the differences (Out of scope), the isolate equal to the sync path:

| scenario (`'abcdefghij'`, hwm 4 unless named) | Node | sync path (isolate, parity runner) | async path (browser hosts) |
|---|---|---|---|
| `writeFileSync` 16 bytes in 1st `'data'` | `abcd EFGH IJKL MNOP` | `abcd efgh ij` | `abcd efgh ij` |
| `appendFileSync('XYZ')` in 1st `'data'` | `abcd efgh ijXY Z` | `abcd efgh ij` | `abcd efgh ij` |
| `writeFileSync('ab')` in 1st `'data'` | `abcd` end | `abcd efgh ij` | `abcd efgh ij` |
| `unlinkSync` in `'open'` | `abcd efgh ij` | `error:ENOENT:read` close | `abcd efgh ij` |
| `writeFileSync('OPEN-REWRITE')` in `'open'` | `OPEN -REW RITE` | `OPEN -REW RITE` | `abcd efgh ij` |
| listeners after 1 / 2 / 3 / 4 microtask steps | all | `efgh ij end close` / `ij end close` / `end close` / nothing | 25 bytes hwm 10: 1 step all, 3 steps first chunk lost |
| one chunk (default hwm), listeners after 1 / 2 steps | all | `end close` / nothing | — |
| listeners after `setTimeout(0)` / `setImmediate` | all | nothing | — |
| `nextTick` + microtask queued at create | `micro tick open data end` | `open data tick micro end` | microtasks before `'open'` (in-process; its `nextTick` is the host's) |

## Challenge

challenge: 2026-11-24 — 5 problems (no premise critic: existing-baseline repair — Node reads
the file, rifty throws a ceiling of its own making; fresh final-check reviewer on the write-up
before the move to main, all resolved in place)

1. Row "`nextTick` …" is event timing, not data loss — named separately below and in the ceiling text.
2. The isolate column was attributed to a commit where it throws — now "with the guest on the
   sync mirror only".
3. Verdict recorded here.
4. The over-limit outcome of a stream read was unstated — Acceptance 6.
5. The template ADR is proposed in open PR #429 only; the swap test runs at the runtime level;
   finding kept solution-free.

## User scenario

exceljs 4.4.0 in an isolate-host sandbox (probe route `require('exceljs/lib/doc/workbook')`,
`isolate-library-probe/gen/diag-outputs.cjs`): `await new Workbook().xlsx.read(fs.createReadStream('w.xlsx'))`
of the workbook `xlsx.writeFile` wrote. Today: `NotImplementedError: … isolate-host.ReadableStream`;
Node: resolves, `getWorksheet('S').getCell('A1').value === 'a'`.

## Acceptance

1. Isolate corpus row `fs-read-stream` (Parity cases 1–5) green vs `node -e` in `runCode` and the
   README embedder, no `ceiling:`; the same `fs/read-stream` case green in `pnpm test:parity`
   (sync-mirror path) → scenario
2. `probe.mjs diag-outputs` in the isolate sandbox: the `exceljs xlsx.read(fs.createReadStream)`
   line equals real node's → scenario
3. Nothing else in the guest needs the async VFS: vitest project `isolate-host` (both packages'
   tests: `fs.promises`, callbacks, write streams, snapshot/restore, sandbox host file ops) green
   → scenario
4. `syncMirror()` stays the guest's FS substitution point (the sync-only overlay proposed in
   open PR #429): a runtime-level test swaps the mirror between two executions and a read
   stream, `readFileSync`, `fs.promises.readFile` and a write stream of the second see only
   the second mirror → scenario
5. Declared, each a corpus `ceiling:` row that a fix turns red: the read-while-changed class
   (`fs-read-stream-changed`), the late consumer and the timing at create
   (`fs-read-stream-late-consumer`), the next stop `close()` (`fs-read-stream-close`); compat
   isolate-host.md and fs.md ⚠️ name the scenarios with the numbers above, the `ENOENT` where
   Node reads verbatim; no compat row or record of the `ReadableStream` gap left → scenario
6. Cost in the isolate-host README §Cost: minimal `memoryLimitMb` of a stream read vs
   `readFileSync` of the same 16 / 64 MiB file, the outcome over the limit (a stream needs no
   more than the write; `readFileSync` under its need: `RangeError: Array buffer allocation
   failed`, exit 1), and the warm `runCode` p50 before/after → ADR-0563

## Parity cases

Node v24.16.0, self-seeding `fs/read-stream` (rows sequential, one file each; `B<n>:` = Buffer
length and latin1 text), equal to the scratch probe output → scenario:

1. `highWaterMark` slicing: 25 bytes, hwm 10 → `open:number|ready|data B10|B10|B5|end|close`;
   default hwm → one 25-byte chunk → scenario
2. range: `{start:3,end:12,hwm:4}` → `defg hijk lm`; `{start:20,hwm:4}` → `uvwx y`;
   `{end:5,hwm:4}` → `abcd ef`; `{start:7,end:7}` → `h`; `{start:100}` → `open|ready|end|close`;
   `{start:22,end:1000}` → `wxy` → scenario
3. `encoding`: utf8 over `aé€😀z` hwm 2 → `"a" "é" "€" "😀" "z"`; hex hwm 7; base64 hwm 4 (carry
   across chunks, `eQ==` tail); `'latin1'` as the options string → scenario
4. empty file (default hwm and hwm 1) → `open|ready|end|close`; missing file and missing parent
   → `error:ENOENT:open|close`; directory → `open|ready|error:EISDIR:read|close` → scenario
5. deleted during read: `unlinkSync` in the 1st `'data'` → `existsSync` false, the rest
   `efgh ij` delivered; `writeFileSync('NEW')` synchronously after create → `NEW`;
   `unlinkSync` synchronously after create → `error:ENOENT:open|close` → scenario

## Out of scope

- A file changed while it is read (Context rows 1–5): rifty's read stream reads bytes taken at
  one moment (sync path: after `'open'`; async path: before it), Node reads the open file
  description live — `runtime-js/fs-read-stream-reads-snapshot-not-open-file`.
- A consumer attached after an asynchronous step, and the timing at create (rows 6–9): rifty's
  stream flows without one and opens and reads in the microtasks of its creation; Node waits for
  its consumer and opens after an I/O turn — `runtime-js/fs-read-stream-flows-without-consumer`.
- `fs.ReadStream#close` (exceljs `xlsx.readFile` stops there after reading:
  `TypeError: stream.close is not a function`): `runtime-js/fs-stream-close-method-missing`
  (open PR #434).
- exceljs `csv.read(fs.createReadStream)`: cell `null` where Node reads `b`, the same with
  `Readable.from([buffer])` while the fs stream's bytes equal Node's (scratch probe) — the CSV
  parser stream's hooks, `runtime-js/stream-subclass-hooks-ignored`.
- Web `ReadableStream` in the guest (ADR-0557 §5 ceiling; ROADMAP M14 B) — unchanged.

## Decisions

- Carrier: the guest installs only the sync mirror (`setSyncMirror(new MemoryFsSync())`); the
  stream takes the parity-proven sync fallback. Rejected: rifty-internal web streams in the
  guest, `MemoryVfs` streaming without web streams — new machinery for a path the guest does
  not need (§Simplicity).
- The sync fallback is not changed: moving its read before `'open'` would trade Context row 4
  for row 5 within the same class; the class is declared instead.
- Swap test at the runtime level (`tests/conformance`): the guest bundle exposes no mirror
  swap; the runtime modules are what the overlay relies on.
- Manager 2026-11-24: the unit moved from the `close()` branch (PR #434) onto `main`; the
  library acceptance is `xlsx.read(stream)`, `xlsx.readFile` waits for `close()`. Earlier unit
  record `isolate-guest-fs-createreadstream-readablestream` (that branch) folded in here.
