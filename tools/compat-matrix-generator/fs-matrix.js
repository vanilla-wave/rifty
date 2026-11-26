// `docs/public/compat/fs.md` static inventory (split from `cli.js`, file-size ratchet).
export const fsMatrix = {
  file: 'fs.md',
  title: 'Compatibility matrix — `node:fs`',
  intro:
    'Public claim surface for the runtime-local `node:fs` subset over rifty VFS. Rows cite existing conformance and node-parity coverage.',
  rows: [
    [
      '`readFileSync` / `writeFileSync`',
      '✅',
      "utf8 strings; any TypedArray/DataView (incl. offset and SharedArrayBuffer views) writes its raw bytes, copied: the file never shares memory with a program buffer, written or read (`fs/write-read-buffer-ownership`, `fs/write-array-buffer-view-kinds`); a view's memory and length as Node reads them (`fs/write-view-bytes-intrinsics`). The copy is one memcpy: on the no-COI SDK, whose store copies too, `writeFileSync` of 16 MiB takes 4.8 ms (was 3.3); Workbench, in-process and isolate within noise",
    ],
    [
      'write `data` that is neither a string nor an ArrayBufferView',
      '⚠️',
      "An `ArrayBuffer`/`SharedArrayBuffer` is Node's `ERR_INVALID_ARG_TYPE` on the sync and `fs.promises` entries (`fs/write-array-buffer-refused`; callback `writeFile` hands it to the callback, Node throws). A number writes an empty file; `null`/`undefined` leave a file whose `statSync`/`readFileSync` throw a code-less `TypeError`; an Array or other object writes its elements' bytes; a `Proxy` over a view throws a code-less `TypeError` (Node: `ERR_INVALID_ARG_TYPE`, callback forms synchronously); `writeSync`/`write` refuse them without a code — `backlog/runtime-js/fs-write-data-argument-types`. A program that patched `%TypedArray%.prototype` members or replaced global `Uint8Array`/`DataView`/`ArrayBuffer` writes as Node in-process and in the isolate (`fs/write-view-bytes-patched-intrinsics`); on Workbench and the SDK the store transport fails — `backlog/runtime-js/post-guest-paths-use-replaceable-intrinsics`",
    ],
    ['`mkdirSync({ recursive })`', '✅', 'Creates parent directories'],
    [
      '`mode` of `writeFile*` / `appendFile*` / `mkdir*` / `open*` / `createWriteStream`, `mkdtemp*`',
      '⚠️',
      'Ignored: the entry is created and reports 0o100666/0o40777 whatever `mode` asks (Node: `mode & ~umask`, e.g. 0o600; `mkdtemp` 0o700 & ~umask); no `chmod` family — backlog `runtime-js/fs-mode-arguments-ignored`',
    ],
    [
      '`readdirSync` / `Dirent[]`',
      '✅',
      'Sorted names; `withFileTypes`; `{ recursive: true }` BFS walk + `Dirent.parentPath` (no removed-in-v24 `path` alias)',
    ],
    [
      '`existsSync` / `statSync`',
      '⚠️',
      'Numeric `Stats` shape/entry identity and `throwIfNoEntry: false` parity; rename ctime transitions remain incomplete (`runtime-js/fs-stats-node-fields`), atime-value fidelity separately tracked.',
    ],
    ['`rmSync({ recursive })`', '✅', 'Tree removal'],
    [
      '`copyFileSync` / `renameSync` / `cpSync`',
      '✅',
      '`COPYFILE_EXCL`, recursive copy, mtime-preserving rename; `cp` `{ filter, force, errorOnExist, preserveTimestamps }`; `dereference` loud-throws (no-symlink, ADR-0050)',
    ],
    [
      '`openAsBlob(path[, { type }])`',
      '✅',
      'Reads VFS bytes into a resolved Blob (default type `""`)',
    ],
    [
      '`lutimesSync` / `futimesSync` / `futimes`',
      '✅',
      'lutimes ≡ utimes (no-symlink); futimes resolves fd→path, `EBADF` (syscall `futime`) on a bad fd',
    ],
    [
      '`utimesSync` / `lutimesSync` / `futimesSync` sub-millisecond times',
      '⚠️',
      'Cut to whole milliseconds (Node keeps them: 100 ns measured on APFS) — `backlog/runtime-js/utimes-sub-millisecond-truncated`',
    ],
    ['Encoding reads', '✅', 'utf8, utf16le, latin1/ascii, hex parity cases'],
    ['Path resolution with `process.cwd()`', '✅', 'Relative fs paths anchor at runtime cwd'],
    ['Callback `readFile` / `writeFile`', '✅', 'Node-style error-first callbacks'],
    [
      'Async completion turn (callbacks, `fs.promises`)',
      '⚠️',
      "As Node's threadpool round trip: every call takes an operation turn, then an I/O completion turn, so a chain of fs calls yields to timers and the immediates queued beside a call run first; a callback form fixes its options, path and positions at the call and throws a non-function callback there (`makeCallback`); the process end (`exit()`, a fatal error) runs submitted operations, no callback (Node joins its pool); `Dir` reads one batch of `bufferSize` per request, the rest on `process.nextTick`; cost: one more host turn per call than main's microtask chain (PR #468 cost table), a one-turn path where rifty knows the turn is not poll tried and dropped (`backlog/runtime-js/loop-phase-of-current-turn`). Declared: one round trip per call, so a multi-round-trip `writeFile` differs where Node opens first — bytes mutated in a `setImmediate` (Node `9,9,9`, rifty `1,2,3`), `writeFile` + `exit()` in one tick (Node `\"\"`, rifty the data): `backlog/runtime-js/fs-async-op-io-rounds`; `fs.read(0)` (stdin) keeps its own path, its callback outside the turn: `backlog/runtime-js/fs-read-stdin-turn`; the order of a completion against timers and immediates is Node's on the in-process host; Workbench/SDK run a due 0 ms timer before an immediate queued in an fs callback, the isolate either way by race (a `promises.readFile` callback's immediate-before-timer, Node's and main's on Workbench/SDK, is now the timer first), and every call takes two turns, so where Node races (the pool done or not by the next poll: a call from a timer, an immediate, the main module) rifty gives the late order; from a timer in-process also `I,cb,T`, which Node never gave: `backlog/runtime-js/loop-phase-of-current-turn`. Parity `fs/callback-turn-order`, `fs/callback-phase-order`, `fs/async-arguments-at-call`, `fs/dir-read-turns`",
    ],
    [
      'Buffer mutated while an async write is pending',
      '⚠️',
      "A mutation after the write completed never reaches the file; one in the caller's synchronous turn or a microtask after `promises.writeFile`/`appendFile`, callback `writeFile`/`appendFile`, or a `WriteStream` write before `open`, lands, as in Node (`fs/async-write-buffer-moment`, `fs/callback-turn-order`). Not Node: an open `WriteStream` takes the bytes at the call — `backlog/runtime-js/fs-write-stream-node-source`; one in a `setImmediate` after a multi-round-trip write — `backlog/runtime-js/fs-async-op-io-rounds`. After `fs.write(fd)` a mutation in the caller's turn, a microtask or a `nextTick` races in Node's threadpool (macOS mostly 9,9,9; Linux CI 1,2,3), not pinned",
    ],
    [
      'Callback `fs.appendFile` / `fs.rm`',
      '⚠️',
      'Over their `fs.promises` forms, in the I/O turn shape above; `rm` checks its options at the call. Declared: a `data` that is not a string or view (`appendFile(p, 123, cb)`) is not refused (Node `ERR_INVALID_ARG_TYPE`): `backlog/runtime-js/fs-write-data-argument-types`; an fd instead of the path (`appendFile(fd, data, cb)`, also `writeFile(fd, …)`, `appendFileSync(fd, …)`) throws a non-Node `TypeError` (Node writes through the fd): `backlog/runtime-js/fs-write-file-family-fd-target`. Parity `fs/append-file-rm-callbacks`',
    ],
    [
      '`fs.promises` file ops',
      '✅',
      '`readFile`, `writeFile`, `appendFile`, `readdir`, `copyFile`, `rename`, `rm`, `access`',
    ],
    [
      'fd table',
      '✅',
      '`open`/`close`/`read`/`write`/`fstat`/`ftruncate`; sequential and positional IO; `read`/`readSync` move only their range on every host, `bigint` positions (ADR-0576, `fs/read-positional`)',
    ],
    [
      'fd reads after `unlink` / rename',
      '⚠️',
      'No open-file handle: a read through an fd after its file is unlinked or renamed away is `ENOENT`, after a rename-over it sees the new file (Node keeps reading the inode; ADR-0576).',
    ],
    [
      '`fs` on stdio descriptors 0–2',
      '⚠️',
      'COI: `read`/`readSync`/`readFileSync(0)`, `fstatSync(0)` (FIFO/character mode), `closeSync(0)` and `write`/`writeSync(1\\|2)` use raw descriptors; writes bypass replaced `process.stdout.write`. Pipe positions throw `ESPIPE`. Kernel pull stdin (ADR-0542); `tests/browser-unit/fs-stdio-fds.spec.ts`, `tests/browser-unit/file-stdout.spec.ts`.',
    ],
    [
      'No-COI synchronous stdin',
      '❌',
      "`readSync`/`readFileSync(0)` throw `NotImplementedError('fs.readSync.stdin')`: no-COI children receive push-MessagePort stdin, without a pull pipe. Async `fs.read(0)` and `process.stdin` work.",
    ],
    ['`truncate` / zero fill', '✅', 'Sync and promises paths'],
    ['`mkdtemp` / `opendir`', '✅', 'Sync and promises; async directory iteration'],
    [
      '`Dir#entries()`',
      '❌',
      "Node's alias of `dir[Symbol.asyncIterator]` reads `undefined`; `for await (const e of dir)` works — backlog `runtime-js/builtin-alias-members`",
    ],
    [
      '`createReadStream` / `createWriteStream`',
      '⚠️',
      "Async `Vfs.openReadable` first, cwd-resolved paths, chunked reads, write flags (`w`/`a`/`x`/`r+` subset), read-stream abort `signal` (Node event order incl. pre-abort), TypedArray/DataView chunks, string-options overload (`createReadStream(p, 'utf8')` emits strings; `createWriteStream(p, 'base64')` decodes string writes, per-write encoding overrides), destroy() on Node's write-dispatch boundary (in-flight bytes land + 'error'; pre-dispatch discards silently), pipe and `end` parity tests. Gap: `ReadStream.pipe` ignores options and always calls `dest.end()` (`{ end: false }` still ends; `pipe(process.stdout)` throws `dest.end is not a function`) — backlog `runtime-js/fs-readstream-pipe-node-options`; `ReadStream`/`WriteStream` have no `close()` and `ReadStream` is not async-iterable (`TypeError`; exceljs `xlsx.readFile`) — backlog `runtime-js/fs-stream-close-method-missing`; `fs.WriteStream`/`fs.ReadStream` are ES classes, so `fs$WriteStream.apply(this, args)` (graceful-fs `createWriteStream`/`createReadStream`, fstream) throws `Class constructor FileWriteStream cannot be invoked without 'new'` — backlog `runtime-js/fs-stream-class-call-shape`",
    ],
    [
      'Stream unsupported options',
      '❌',
      '`fd`, custom `fs`, write-stream `start`, write-stream `signal`, `autoClose:false`, and non-`r` read-stream flags throw `NotImplementedError` — no silent accept-and-ignore; invalid options/encoding args are Node-shaped `ERR_INVALID_ARG_TYPE`/`ERR_INVALID_ARG_VALUE`',
    ],
    [
      '`fs.watch`',
      '⚠️',
      'Conformance covered as cooperative VFS watch subset, not OS-native watcher semantics; `null` options accepted, invalid encoding value rejected before target existence (Node order)',
    ],
    [
      '`fs.watchFile` / `fs.unwatchFile`',
      '✅',
      'Poll-based; listener receives the same `Stats` class `statSync` returns (missing target = one zeroed call, Node ENOENT contract); uint32 `interval` validation (`ERR_OUT_OF_RANGE`, 0 valid)',
    ],
    [
      '`fs.watch` buffer/exotic filename encodings',
      '❌',
      "`encoding:'buffer'` and non-UTF-8 filename encodings throw `NotImplementedError` only where Node would succeed (missing target stays `ENOENT`); UTF-8 string filenames are the claimed subset",
    ],
    [
      '`{ bigint: true }` stats (`statSync`/`lstatSync`/`fstatSync`/promises/`watchFile`)',
      '❌',
      "Throws `NotImplementedError('fs.<surface>.bigint')` AFTER Node-visible errors (missing target stays `ENOENT`, bad fd stays `EBADF`); number-shaped `Stats` are never returned for a BigIntStats request",
    ],
    [
      '`statfsSync`',
      '❌',
      "Present, every call throws: own enumerable member with Node's descriptor, so `import { statfsSync } from 'node:fs'` links (vitest 4.1.11 `cli-api`). A call throws `NotImplementedError('fs.statfsSync')` — no browser source for host filesystem statistics, never a fabricated value; `typeof` feature detection sees a function (ADR-0443). `statfs` / `promises.statfs` stay link-time misses. Parity: `modules/builtin-loud-members-link`",
    ],
    [
      'A NUL in a path; `utimes` edge times',
      '✅',
      "A NUL throws Node's `ERR_INVALID_ARG_VALUE` (`existsSync` answers `false`); `utimes` as Node 24.16.0: an invalid `Date` keeps the time, a negative number is now, a NaN/Infinity number is `ERR_INVALID_ARG_TYPE` — no non-finite time is stored. Parity: `fs/path-nul-and-utimes-edge-times`",
    ],
    [
      '`utimes` with a time past 2^63 ns',
      '⚠️',
      "Node's darwin answer on every host: saturates at ±2^63 ns, its sign as libuv's (a string below −2^63 s wraps to the top). Node on Linux refuses with `EINVAL`, rifty stores the time. Parity compares it exactly on darwin hosts only: `fs/path-nul-and-utimes-edge-times`",
    ],
    [
      '`symlink`/`symlinkSync`/`link`/`linkSync`, `promises.symlink`/`link`',
      '❌',
      "Present, every call throws `NotImplementedError('fs.<name>')`: the VFS has no links (ADR-0050), so a program names the gap instead of `TypeError: … is not a function` (ADR-0443 claim: model-written programs in the isolate sandbox, ADR-0568). `readlink` answers `EINVAL` as for any non-link",
    ],
    [
      'Durable `fsync` / inode-like open-unlink semantics',
      '❌',
      'Tracked as VFS fd durability residual',
    ],
    [
      'Full `FileHandle` object API',
      '❌',
      'Tracked separately; high-frequency fd wall covered first',
    ],
  ],
  tests: [
    '`tests/conformance/builtins/fs.test.ts`',
    '`tests/conformance/builtins/fs-realpath-readdir.test.ts`',
    '`tests/conformance/builtins/fs-streams.test.ts`',
    '`tests/conformance/builtins/shared-vfs.test.ts`',
    '`tests/conformance/builtins/fs-watch.test.ts`',
    '`tools/node-parity-runner/cases/fs/*.case.ts`',
  ],
  limitations: [
    '`O_SYNC`, `O_DSYNC`, reflink constants and unsupported numeric flag bits are intentionally absent or rejected.',
    'VFS-level durability beyond OPFS write-through remains a separate lower-layer design.',
  ],
};
