---
area: runtime-js
status: ready
title: process.umask reports the mask the FS creates files under and refuses a mask the FS cannot apply
created: 2026-11-24
why: Node has `process.umask()`; rifty omits it, so packages that read it at load (fstream) fail `TypeError: process.umask is not a function` instead of a value or a named gap.
sources: [docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/process.md, docs/backlog/runtime-js/fs-default-file-modes.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/fs-stats.ts, tools/node-parity-runner/cases/process, packages/isolate-host/tests/corpus.ts]
---

## Context

Probe 2026-11-24 (`isolate-library-probe/gen/diag.cjs`, isolate-host sandbox vs Node v24.16.0):
`require('fstream')` → Node ok, rifty `TypeError: process.umask is not a function` at
`fstream/lib/writer.js:8` (`process.platform === 'win32' ? 0 : process.umask()`, module top level).
fstream comes from unzipper, which exceljs 4.4.0's main entry loads
(`lib/exceljs.nodejs.js:7` → `stream/xlsx/workbook-reader.js:5`) — today behind the declared
`node:zlib` ❌ on the same chain, so it is the next stop once zlib exists. compat process.md names
`umask` as an ESM link-time miss (row "`node:process` named imports") and a ❌ row for the call.

Node invariant under any umask: a new file stats `mode & 0o777 === 0o666 & ~process.umask()`,
a new directory `0o777 & ~process.umask()`. rifty's VFS has no modes: `fs.Stats` reports
0o100666/0o40777 for every file/directory (`fs-stats.ts`), `open`/`mkdir` ignore `mode`, no
`chmod` exists — so the mask rifty's FS creates under is 0.

Node v24.16.0 (`lib/internal/process/per_thread.js` `wrappedUmask` → `parseFileMode` →
`validateUint32`), live 2026-11-24: own data member (writable, enumerable, configurable),
`length` 1, `name` `wrappedUmask`; `umask()`/`umask(undefined)` read; `umask(m)` sets, returns
the previous mask; an octal string `/^[0-7]+$/` parses base 8; errors below (Parity cases 3).

## Challenge

challenge: 2026-11-24 — clear (existing-baseline repair, no premise critic, README §Challenge; read-vs-loud fork decided by the manager of thread cf2ae711, Decisions)

## User scenario

An isolate-host sandbox program `require('fstream')` (1.0.12, unzipper's dependency under
exceljs 4.4.0) loads as under Node; today it throws `TypeError: process.umask is not a function`
at `fstream/lib/writer.js:8`.

## Acceptance

1. `process.umask()` returns the mask the FS creates under: parity vs live Node checks the
   invariant (new file `0o666 & ~umask`, new dir `0o777 & ~umask`), not the number → scenario
2. `process.umask(current)` (number or octal string) returns the previous mask, as Node; any other
   valid mask throws `NotImplementedError('process.umask(mask)')`, umask unchanged → scenario
3. Invalid arguments throw Node's error class, code and message → scenario
4. `import { umask } from 'node:process'` links and works unbound; member descriptor as Node →
   scenario
5. The same member in the isolate guest: isolate corpus rows (live `node -e` oracle) for 1–3 (no ESM in the guest, compat
   isolate-host.md "ES modules");
   `require('fstream')` in an isolate-host sandbox loads (probe `diag.cjs` line
   `require('fstream'): ok`) → scenario

## Parity cases

1. `process/umask-invariant`: new file via `writeFileSync`, `openSync('w')`, dir via `mkdirSync`
   (plain and `recursive`): `(mode & 0o777) === (0o666|0o777) & ~umask()` → true; `umask()` ===
   `umask(undefined)`; result an integer in `[0, 0o777]` → scenario
2. `process/umask-same-value`: `umask(umask())` and `umask(umask().toString(8))` return the prior
   value; `umask()` unchanged after → scenario
3. `process/umask-invalid-args`: `null` → `TypeError ERR_INVALID_ARG_TYPE` `…must be of type
   number. Received undefined`; `true`/`{}`/`[]`/`10n`/symbol/function → `ERR_INVALID_ARG_TYPE`
   with Node's `Received …` tail; `1.5`/`NaN`/`Infinity` → `RangeError ERR_OUT_OF_RANGE` `It must
   be an integer`; `-1`/`2**32` → `ERR_OUT_OF_RANGE` `It must be >= 0 && <= 4294967295`;
   `'77777777777'` → same with `Received 8_589_934_591`; `'8'`/`'0o22'`/`''`/`' 22'`/`'0x12'`/
   `'abc'` → `TypeError ERR_INVALID_ARG_VALUE` `The argument 'mask' must be a 32-bit unsigned
   integer or an octal string. Received '<s>'`; umask unchanged after each → scenario
4. `process/umask-esm-named`: `import { umask } from 'node:process'` links; `umask === process.umask`,
   unbound call equals `process.umask()`; descriptor `[writable, enumerable, configurable]` =
   `[true, true, true]`, `length` 1 → scenario
5. isolate corpus rows `process-umask-invariant` (1 + 2), `process-umask-invalid-args` (3): the
   same probes through `runCode` vs `node -e` → scenario

## Out of scope

- A mask different from the current one: `NotImplementedError('process.umask(mask)')` + compat
  process.md ❌ part of the row (the VFS applies no mode; ADR-0050 family).
- Reporting Node's default-umask modes 0o100644/0o40755 with umask 0o022:
  `runtime-js/fs-default-file-modes` (one edit moves both).
- `mode` arguments of `open`/`mkdir`/`writeFile` and absent `chmod`/`fchmod`/`lchmod`
  (`runtime-js/node-builtins-loud-stub-capability-gaps`, compat isolate-host.md "FS snapshot … modes").
- fstream's/unzipper's later stops after load (findings filed separately).

## Decisions

- Read = real value agreeing with the FS (0 today), not a loud throw: fstream reads it at load and
  Node delivers a value under every umask — manager decision, thread cf2ae711, reversible.
- Write of the same value returns it (no-op in Node too); any other value is loud, never accepted
  silently while the FS ignores it — manager decision.
- "Same value" = parsed mask `=== 0` exactly: high bits (`0o1000`) Linux drops, macOS keeps
  (live darwin Node: `umask(0o1000)` then `umask()` → `0o1000`); `process.platform` is `rifty`,
  so neither OS's folding applies → throw (own decision).
- One constant `VFS_UMASK` in `fs-stats.ts` feeds both the default modes and `process.umask` so
  the two cannot drift (own decision).
- Member name `wrappedUmask`, `length` 1, as Node (own decision; the general `.name` drift stays
  `runtime-js/builtin-function-names`).
