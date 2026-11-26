---
area: runtime-js
status: draft
title: fs.read and fs.readSync reject bad offset, length and buffer bounds with other errors, at another moment, than Node
created: 2026-11-25
why: A program that catches `ERR_OUT_OF_RANGE`/`ERR_INVALID_ARG_TYPE` from `fs.read*`, or relies on Node's synchronous throw, sees code-less `RangeError`s, a callback error, `EBADF` or `ESPIPE` instead; a string offset is read where Node throws, a fractional length throws where Node truncates
sources: [docs/backlog/runtime-js/reference/fs-read-argument-errors/parity-diff.txt, docs/backlog/runtime-js/reference/fs-read-argument-errors/probe.cjs, PR-457]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/fs-read-arguments.ts, packages/runtime-js/src/builtins/fs-stdio.ts]
---

## Context

Found in the review of PR #457 (unit 4b, ADR-0576). The probe ran on the PR head `120e56ea0`; the
checks behind rows 1–3 and 5–7 (`checkedSliceBounds`, `assertNonNegativeInteger`, `readStdin`, the
`Promise` around `readSync` in `read`) are unchanged from `main`. The PR fixed only the position
argument (Node's `validatePosition`, bigint) and the order "offset → position → zero length
returns 0" in `readSync`.

The probe (`probe.cjs`, run as a parity case against Node v24.16.0; output in `parity-diff.txt`)
shows these differences:

1. `readSync`: a bad `offset`/`length` throws a code-less `RangeError` with rifty's own message
   (`offset must be a non-negative integer`, `offset + length exceeds buffer length`). Node throws
   `ERR_OUT_OF_RANGE` with its message (`The value of "length" is out of range. It must be <= 4`).
2. `readSync`: a string offset `'1'` is taken as an options object (its `length` 1 becomes the read
   length; the length and position arguments are ignored). Node throws `ERR_INVALID_ARG_TYPE`.
3. `readSync`: a length of `1.5`: Node reads 1 byte (`length |= 0`); rifty throws.
4. With two invalid arguments, `fs.read(fd, b, -1, 0, 'x', cb)` names `position`; Node names `offset`
   first. `readSync` already names `offset`.
5. `fs.read` with a length past the buffer: Node throws `ERR_OUT_OF_RANGE` synchronously; rifty calls
   back with an error (the probe prints only `e.code`, `undefined`; by the code it is
   `checkedSliceBounds`' code-less `RangeError`, thrown inside the `Promise` around `readSync`).
6. stdin, async:
   - `fs.read(0, b, 0, 0, 1, cb)` gives `ESPIPE`; Node gives `cb(null, 0)`;
   - a zero length with an offset past the buffer calls back with an error (by the code,
     `checkedSliceBounds` in `readStdin`, `fs-stdio.ts`); Node gives `cb(null, 0)`.
7. `readSync` on a write-only or closed fd, with a length past the buffer, gives `EBADF`. Node gives
   `ERR_OUT_OF_RANGE`: it checks the buffer bounds before the fd.

Not decided: whether these are fixed as one validation pass (`fs-read-arguments.ts`, Node's
`validateOffsetLengthRead`/`validateInteger`) or row by row.
