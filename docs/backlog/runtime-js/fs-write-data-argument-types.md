---
area: runtime-js
status: draft
title: fs write data that is neither a string nor an ArrayBufferView behaves as Node on every write entry
created: 2026-11-26
why: rifty writes numbers, null, arrays and objects as empty or wrong files, or throws code-less TypeErrors, where Node throws ERR_INVALID_ARG_TYPE (callback forms synchronously); fs.promises.writeFile/appendFile lack Node's iterable data
blocked_by: [runtime-js/fs-callbacks-io-turn]
sources: [docs/backlog/runtime-js/reference/fs-write-data-argument-types/probe.cjs, PR-469]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

Found by PR #469 (buffer ownership in `fs`), which settled only its own part: an `ArrayBuffer` /
`SharedArrayBuffer` as `data` is Node's `ERR_INVALID_ARG_TYPE` on the sync and promise entries
(parity `fs/write-array-buffer-refused`), and any other object is copied (its array-like elements)
so the store never keeps a guest object. Everything else is as on main `c2250727d`.

Probe `reference/fs-write-data-argument-types/probe.cjs` (10 values × 9 entries, fresh dir), Node
v24.16.0 macOS arm64 and rifty in-process (`inproc.mts`) at main and at PR #469; full outputs beside
it. Summary (Node → rifty at PR #469):

| data | sync entries (`writeFileSync`, `appendFileSync`, `r+`) | `writeSync` / `write(fd)` | callback `writeFile` | `promises.writeFile`/`appendFile` |
|---|---|---|---|---|
| `123` | throw `ERR_INVALID_ARG_TYPE` `"data"`, no file → ok, empty file (`r+`: `RangeError: offset is out of bounds`) | throw `"buffer"` → code-less `TypeError: data must be a string or Uint8Array` (`write`: to the callback) | sync throw → ok, empty file | reject → resolves, empty file |
| `null`, `undefined` | throw → `writeFileSync` ok with `stat.size` `undefined`; append/`r+` code-less `TypeError` (`reading 'length'`) | as `123` | sync throw → ok, `size` `undefined` | reject → writeFile resolves (`size` `undefined`), appendFile code-less reject |
| `[]`, `[1,2,3]`, `{}`, `{ toString }`, `new String('s')` | throw → ok, the elements' bytes (`[1,2,3]` → 1,2,3; `{}` → empty; `new String('s')` → one 0 byte) | as `123` | sync throw → ok, same bytes | `[]` ok empty, `new String('s')` ok 1 byte (= Node: iterable data); `[1,2,3]` Node rejects `The first argument must be … Array-like Object. Received type number (1)` with a 0-byte file → rifty writes 1,2,3; objects: reject → resolve |
| `ArrayBuffer`, `SharedArrayBuffer` | throw (= Node since #469) | as `123` | sync throw → the error in the callback | reject (= Node since #469) |

`fs.appendFile(cb)` is missing (`backlog/runtime-js/fs-callback-append-file-rm-missing`). On main the
store kept the object itself (`writeFileSync(p, arr); arr[0] = 9` changed the file; `stat.size` 0
while `readFileSync` gave 1,2,3); PR #469 removed that.

Contract of the unit, three parts:
- (a) `ERR_INVALID_ARG_TYPE` with Node's argument name (`"data"` for the whole-file entries,
  `"buffer"` for `writeSync`/`write`) and `Received …` text on every write entry, nothing created;
- (b) callback forms throw synchronously (validation outside the operation, after
  `fs-callbacks-io-turn`'s `ioTurn(op)` lands);
- (c) iterable / async-iterable / stream `data` in `fs.promises.writeFile`/`appendFile` — a Node
  capability rifty lacks (today `[]`/`new String` equal Node by accident).

Depends on PR #468 (`fs-callbacks-io-turn`) and PR #469. Compat: `fs.md` ⚠️ row.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
