---
area: distribution
status: ready
title: In the isolate guest node:zlib, node:child_process and node:worker_threads load with Node's shape and only their engine, process or worker use throws a named gap
created: 2026-11-24
why: Node always loads these modules; the guest throws at load, so a program that loads one and never compresses, spawns or starts a worker (`require('exceljs')`, through archiver and unzipper) works in Node and fails in the isolate.
user_story: As an agent backend running document libraries in an isolate sandbox, I want exceljs's modules that load `node:zlib` to load as in Node, but today `crc32-stream/lib/deflate-crc32-stream.js:11` (`require('zlib')`) throws `NotImplementedError('isolate-host.zlib')` at load and the run exits 1, although exceljs writes xlsx through JSZip.
sources: [ADR-0557, ADR-0568, ADR-0159, docs/backlog/distribution/isolate-host-egress-modules-load.md, docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/backlog/runtime-js/zlib-web-compression-subset.md]
code: [packages/isolate-guest/src/guest/entry.ts, packages/runtime-js/src/builtins/zlib-constants.ts]
---

## Context

`HOST_CEILING_MODULES` (`packages/isolate-guest/src/guest/entry.ts`) registers `zlib`,
`child_process`, `worker_threads` as factories that throw `NotImplementedError('isolate-host.<module>')`.
Probe 2026-11-24 (README row 1): exceljs 4.4.0 `excel.js:13` → `lib/exceljs.nodejs.js:6` →
`stream/xlsx/workbook-writer.js:2` → archiver → zip-stream → compress-commons →
`crc32-stream/lib/deflate-crc32-stream.js:11`, also `:7` → `workbook-reader.js:5` →
`unzipper/lib/parse.js:2`. Second half of the class `isolate-host-egress-modules-load` closed for
`http`/`https`/`net`: same mechanism (`egress-gaps.ts`), same rules.

Manager decision 2026-11-24 (not the user's words, reversible): after this unit no Node builtin
throws at load in the isolate; shape as Node 24 (exports, member kinds, prototype chains;
`class X extends zlib.DeflateRaw` declares as in Node); a member that does not need the missing
capability is real; one that does is a named gap `isolate-host.<module>.<member>` at call or
construction; compression and decompression stay loud (no engine; engine choice is the user's,
not made); `zlib.crc32` stays loud here (a shared-module change, candidate); browser hosts
untouched (their `child_process`/`worker_threads` are real).

Oracle: Node v24.16.0 (`node -e`), member classification by Node's export list and
`Function.prototype.toString` of each member:

| module | real (Node behaviour, no engine/process/worker) | loud (`isolate-host.<module>.<member>`) |
|---|---|---|
| zlib | `constants` (null prototype, read-only keys, extensible), `codes` (frozen), the 107 legacy top-level constants (every non-`BROTLI_` key, read-only, not enumerable) | `crc32`; the 11 async one-shots (`asyncBufferWrapper`) and 11 `*Sync` (`syncBufferWrapper`); the 11 `create*` (`value`); construction or call of `Deflate`, `Inflate`, `Gzip`, `Gunzip`, `DeflateRaw`, `InflateRaw`, `Unzip`, `BrotliCompress`, `BrotliDecompress` (ES5), `ZstdCompress`, `ZstdDecompress` (`class`), and of Node's unexported bases `Zlib`, `ZlibBase`, `Brotli`, `Zstd` |
| child_process | — (every member starts or adopts a process) | `_forkChild`, `exec`, `execFile` (and their `util.promisify.custom` forms), `execFileSync`, `execSync`, `fork`, `spawn`, `spawnSync`; construction or call of `ChildProcess` (Node's constructor creates a `Process` handle) |
| worker_threads | `isMainThread` `true`, `isInternalThread` `false`, `threadId` `0`, `threadName` `''`, `parentPort` `null`, `workerData` `null`, `resourceLimits` `{}`, `SHARE_ENV` (`Symbol.for('nodejs.worker_threads.SHARE_ENV')`), `setEnvironmentData`/`getEnvironmentData` (Node's `SafeMap`, `undefined` deletes); `receiveMessageOnPort`/`moveMessagePortToContext` (no port can exist here: every call is Node's `ERR_INVALID_ARG_TYPE` "The \"port\" argument must be a MessagePort instance"); `locks`'s `LockManager` constructor (Node's `TypeError: ERR_ILLEGAL_CONSTRUCTOR is not a constructor`); `MessagePort`/`MessageChannel`/`BroadcastChannel` are the guest's globals (`=== globalThis.X` as in Node; constructing them is their existing gap) | `Worker` (construction); `markAsUncloneable`, `markAsUntransferable`, `isMarkedAsUntransferable`; `postMessageToThread`, `locks.request`, `locks.query` (async: the gap is the rejection) |

## Challenge

challenge: 2026-11-24 — 6 problems (fresh reviewer, final written-result check): record written before the check → this line; `receiveMessageOnPort`/`moveMessagePortToContext`/`LockManager` loud though Node's result is deliverable → real; `postMessageToThread` and `locks.request`/`query` loud by my own call → returned to the manager as forks (`## Decisions`); `require('exceljs')` past `node:zlib` untested and the user story over-promising → test added, story narrowed; "no host call" unproven → `egress.test.ts`/`guest-seam.test.ts` named; `ChildProcess` loud construction undeclared → declared.

## User scenario

exceljs 4.4.0's installed closure in the state of `createSandbox({ snapshot })`; `sandbox.exec(gen)`
of a file that `require`s `exceljs/lib/stream/xlsx/workbook-writer` (archiver → crc32-stream's
`class DeflateCRC32Stream extends zlib.DeflateRaw`). Today: exit 1, stderr `NotImplementedError: Not
implemented: isolate-host.zlib`. Node over the same files: exit 0. A streaming write
(`WorkbookWriter#commit`) deflates: Node writes the file; the guest has no engine.

## Acceptance

1. `require('node:zlib'|'node:child_process'|'node:worker_threads')` in the guest returns a module whose shape equals live `node -e`: own names in order, descriptor kinds and flags, `typeof`, function `name`/`length`/`prototype`/`class`/`async`, symbol statics (`util.promisify.custom`), full prototype chains of every class and of Node's unexported zlib bases, the data tables' prototypes, flags, extensibility and values, `locks`'s prototype members, identities with the guest's port globals and `Symbol.for`. Proof: `packages/isolate-host/tests/ceiling-modules.test.ts`, fixture `fixtures/ceiling/shape.cjs` → ADR-0557
2. Every real member of the table equals Node on parity case 2 (same test file) → ADR-0557
3. Every loud member throws `NotImplementedError` with feature `isolate-host.<module>.<member>` when called or constructed, also through `class extends` (with `super(o)`, crc32-stream's form) and `util.inherits` + `.call(this)`; the async ones return a promise rejecting with it; `require`, `import()`, every property read, a spread and every subclass declaration throw nothing. No process, no worker, no new host call: `ceiling-zlib.ts`/`ceiling-threads.ts` import no bridge, `egress.test.ts` and `guest-seam.test.ts` unchanged and green → ADR-0557
4. exceljs 4.4.0's installed closure in a sandbox: `require('exceljs/lib/stream/xlsx/workbook-writer')` + crc32-stream load with Node's output; `require('exceljs')` no longer names `isolate-host.zlib` (its next stops: `## Decisions`); a streaming write exits 1 with `isolate-host.zlib.DeflateRaw` where Node writes. Proof: `packages/isolate-host/tests/library-exceljs.test.ts` → scenario
5. `import()` of the three from a CommonJS file: namespace keys and `default` identity equal Node's; `node -e`'s lazy `zlib`/`child_process`/`worker_threads` globals return the same modules as `require` → ADR-0557
6. `docs/public/compat/isolate-host.md` rows state loads-✅ / use-❌ with the loud list; the dated ADR-0557 §6 correction of 2026-11-24 covers the three modules → ADR-0557
7. Warm `runCode('console.log(1)')` p50 and the guest bundle bytes measured before and after, reported in the PR; modules built on first `require` → ADR-0563
8. `zlib.constants` has Node's shape on every host (the guest reuses the shared table): parity case `tools/node-parity-runner/cases/zlib/constants-shape.case.ts` → ADR-0159

## Reference contract

- Oracle: Node v24.16.0 (`process.execPath` of the test run), `lib/zlib.js`, `lib/child_process.js`, `lib/internal/worker.js`, `lib/worker_threads.js`, `lib/internal/locks.js` as printed by `Function.prototype.toString`.
- Mechanism: `egress-gaps.ts` (`loudFunction`, `loudMethod`, `loudClass`, plus `es6` for Node's `class` declarations and `loudAsync` for `async` members); data from `@riftydev/runtime-js`'s `zlib-constants.ts` (one copy, Node's order and descriptors).

## Parity cases

1. Shape dump (Acceptance 1) of the three modules: `runCode` output = `node -e` output, exact, under the declared deviations of `## Out of scope` → ADR-0557
2. Real members (`fixtures/ceiling/behaviour.cjs`): environment data with string, object, `NaN`, `-0`/`+0` keys, a `null` value, `undefined` deleting, no arguments; strict-mode writes/deletes/additions on `constants`, `codes`, a legacy constant and a `create*` member (error `name` and V8 message); `in`; a module member write; `util.promisify(exec|execFile) === [promisify.custom]`; `receiveMessageOnPort` of `undefined`/`{}`/`1`/`Object.create(MessagePort.prototype)`, `moveMessagePortToContext`, `new LockManager()` (error `name`/`code`/message/own keys); `locks`'s tag and keys; `Object.create(X.prototype) instanceof` the Node base → ADR-0557
3. `import()` namespace keys + `default` of the three from a CJS file; `node -e` globals `=== require(...)` → ADR-0557
4. `zlib.constants` shape: prototype, frozen/extensible, key order, flags, a strict write, the legacy key order → ADR-0159
5. exceljs streaming writer load: stdout equals `node writer-load.cjs` over the same files → scenario

## Out of scope

- Everything in the loud column above: `NotImplementedError('isolate-host.<module>.<member>')`, compat ❌. Compression and decompression wait for the user's engine choice (`runtime-js/zlib-web-compression-subset`); `zlib.crc32` for `runtime-js/zlib-crc32`.
- Construction of `ChildProcess` (Node's starts nothing; `## Decisions`): compat ❌.
- Own prototype members of the loud-constructed classes (`ZlibBase.prototype.flush`/`_transform`/…, `Zlib.prototype.params`, `ChildProcess.prototype.kill`/…, `Worker.prototype.postMessage`/…): absent, the chain is Node's — compat ⚠️ (as `isolate-host-egress-modules-load`).
- Node's argument validation before a loud member's throw (`zlib.gzip('x')` without a callback: Node `ERR_INVALID_ARG_TYPE`, guest the named gap), compat ⚠️.
- rifty's `Readable` extends `EventEmitter` without Node's legacy `Stream` between them, on every host: the zlib classes' chains (and `net.Socket`'s) skip `Stream.prototype` — `runtime-js/stream-classes-skip-legacy-stream`, compat ⚠️.
- `worker_threads.locks !== navigator.locks`: the guest's `navigator` has no `locks` (`distribution/isolate-host-navigator-locks-absent`).
- The next stops of `require('exceljs')` past `node:zlib` (measured, `## Decisions`): `runtime-js/cjs-global-function-assignment`, `runtime-js/isolate-require-esm-syntax-gaps`, `runtime-js/process-umask-missing`.
- Browser hosts' `zlib`, `child_process`, `worker_threads`: unchanged (except `zlib.constants`, Acceptance 8); their zlib class shape — `runtime-js/zlib-class-call-shape`.

## Decisions

- Classification proofs: every `child_process` function starts or adopts a process (`_forkChild` an IPC pipe) → loud; `markAs*`/`isMarkedAsUntransferable` loud: Node marks with V8 private symbols and detach keys (`ab.transfer()` then throws) and marks its Buffer pool (`isMarkedAsUntransferable(Buffer.from('x').buffer)` is `true`), none reproducible here; the port members real: Node's native check rejects every non-port and no port exists in the guest.
- Narrows the manager's "no capability needed → real" rule, as `isolate-host-egress-modules-load` did for its messages: `new ChildProcess()` is loud though Node's constructor starts nothing (it builds a `Process` handle: `_handle` set, `pid` undefined); its real behaviour is Node's spawn/kill/exit machinery. Compat ❌, named gap.
- Fork returned to the manager (taken loud meanwhile): `postMessageToThread`'s result is deliverable without a worker — Node v24.16.0 rejects `ERR_WORKER_MESSAGING_SAME_THREAD` for id 0, `ERR_OUT_OF_RANGE`/`ERR_INVALID_ARG_TYPE` for a bad `timeout`, `ERR_WORKER_MESSAGING_TIMEOUT` for `timeout` 0, else `ERR_WORKER_MESSAGING_FAILED` — but Node settles the last two through `Atomics.waitAsync`'s notification, a timing the guest would approximate.
- Fork returned to the manager (taken loud meanwhile): `locks.request`/`query` need no host capability (Node's Web Locks work in one process), but a Web Locks implementation (modes, `ifAvailable`, `steal`, `signal`, `query` snapshots) is outside this mechanism; the guest's `navigator.locks` is absent too (`distribution/isolate-host-navigator-locks-absent`).
- `worker_threads.locks` is a data value (as Node's), a `LockManager`-shaped object: an accessor that throws would break `{ ...require('worker_threads') }` and TS `__importStar`.
- `MessagePort`/`MessageChannel`/`BroadcastChannel`: the guest's own globals, taken once before guest code (identity as in Node, construction their existing ceiling).
- `zlib.constants`: the shared table now has Node's order, null prototype and read-only keys (`zlib-constants.ts`): the guest's shape needs it and there is one copy; browser hosts get the same Node shape (parity case 4).
- `loudClass` gains `es6` (Node's `class` declarations: `ZstdCompress`, `Zstd`, `Worker`, `LockManager`) and `egress-gaps.ts` `loudAsync`; no second mechanism. The file keeps its name (renaming it under #435's review costs a conflict for no behaviour).
- The `Readable → Stream` chain skip is declared, not fixed here: it is `@riftydev/io`'s stream hierarchy on every host (`legacy-stream.ts` "we collapse"), outside this mechanism; returned to the manager as a fork.
- Acceptance 4 uses exceljs's streaming writer path, not `require('exceljs')`: past `node:zlib` its main entry stops at three other units' gaps, measured 2026-11-24 on this branch (+ `origin/t3/process-umask` merged locally, not pushed, + ad-hoc patches of a copied `node_modules` to pass each stop, diagnostic only): (1) `module-loader.cjs-global-function-assignment` at `es-abstract@1.24.2/2025/IsDetachedBuffer.js:22` (`new global[availableTypedArrays[0]](arrayBuffer)`; also `typed-array-length@1.0.8/index.js:41`, `typed-array-byte-offset@1.0.5/index.js:40` on the path), loaded `es-abstract/2025/GetValueFromBuffer.js:13` ← `typedarray.prototype.slice` ← `traverse/index.js:2` ← `chainsaw/index.js:1` ← `binary/index.js:1` ← `unzipper/lib/parse.js:4` ← `exceljs/lib/stream/xlsx/workbook-reader.js:5`; (2) `TypeError: URLConstructor is not a constructor` for `require` of a `module-sync` ESM entry: `generator-function@2.0.1` (`require.mjs`) from `is-generator-function/index.js:12`, `async-function@1.0.0` from `is-async-function/index.js:13`; (3) `process.umask` at `fstream/lib/writer.js:8` ← `unzipper/lib/extract.js:4`. With all three passed, the probe's canonical `gen/xlsx.cjs` writes an xlsx equal to Node's (`vsNode.equal: true`, 14 parts).
- Acceptance 4's sandbox state is one snapshot (`package-closure.ts` `inSandbox`): exceljs's closure is 5 951 files, one `writeFile` per file outran the test timeout.
