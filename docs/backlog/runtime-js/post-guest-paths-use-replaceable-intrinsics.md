---
area: runtime-js
status: draft
title: Runtime lifecycle work after guest code uses guest-replaceable intrinsics
created: 2026-11-18
why: The drain, keepalive and exit paths call `Map.prototype.get`, `Function.prototype.bind`, `Promise.prototype.constructor` and `process.emit` through the live globals, so guest code can change or hang its own run's outcome.
sources: [docs/public/compat/isolate-host.md]
code: [packages/io/src/builtin-registry.ts, packages/io/src/event-emitter.ts, packages/runtime-js/src/builtins/fs.ts, packages/vfs/src/path.ts, packages/runtime-js/src/builtins/fs-path.ts, packages/runtime-js/src/builtins/os.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/timers.ts, packages/runtime-js/src/builtins/process-lifecycle-events.ts]
---

## Context

Sandbox (ADR-0568): a member of the lifecycle class, compat ⚠️ (row "A run's lifecycle and exit status", measured in `reference/isolate-host-sandbox-lifecycle-class.md`). Owner: runtime-js. Trigger: primordials for the runtime's post-guest paths, or a guest found breaking its own status this way.

Sandbox capture path (PR #424 cross-review round 2): the end state is captured in the guest's
realm after the run's status is out, through the codec's `DataView` writes and the FS walk, so a
guest that replaced those intrinsics runs its own code there and can leave any tree the codec
accepts (`setUint16` turning `a` into `b`: `/workspbce`, exit 0, no `stateRefused`) or hang the
run (`timeout`, rolled back); its output there is dropped. That path is the goal unit
`distribution/isolate-host-sandbox-capture-outside-guest-realm`.

Measured in the isolate host (ADR-0557) @ 2cbb37c50, each against `node -e`:
`Map.prototype.get = () => { throw new Error('boom') }; console.log(1)` → the
run never drains (`termination: 'timeout'`), Node exits 0;
`Function.prototype.bind` poisoned → exit 1, Node 0;
`Object.defineProperty(Promise.prototype, 'constructor', { get() { throw … } }); console.log(1)`
→ exit 1, Node 0; `process.emit` throwing → exit 1, Node 7. Also measured @ b9ff5be73:
`Number.isInteger = () => false`, `Reflect.get = () => undefined` and
`Object.assign = () => { throw … }` each turn a clean run into exit 1 (Node 0),
and a `Reflect.get` that forges the lifecycle slot makes a throwing run exit 0.
@ 1d3fc3c43: `Promise.prototype.constructor = 0; Promise.prototype.then = (f) => f(); setTimeout(() => process.exit(2), 20)`
→ exit 1 (`TypeError: The .constructor property is not an object`), Node 2;
`Reflect.get = () => undefined; console.log(1)` → exit 1 with the runtime's
`Error: process.exit(0)` stack in stderr, Node 0 with empty stderr.
@ 937595c70 (v24.16.0): `Map.prototype.get = () => { throw new Error('boom') }; console.log(1)`
→ exit 1, `Error: boom … at process.emit (rifty-isolate-guest.js:…)`, Node 0
(the `undefined`-returning variant hung in the host's own timer table, since
captured); `Function.prototype.bind = function () { throw new Error('b') }; console.log(1)`
→ exit 1 at `keepaliveState`, Node 0; `setTimeout((a) => { process.stdout.write(String(a) + '\n') }, 5, 'arg'); Array.prototype[Symbol.iterator] = function* () {}`
→ prints `undefined`, Node `arg` (the runtime timer wrapper spreads its
arguments). The isolate host's own tail keeps only the captures that hold
measured cases (ADR-0557 §6); these are the runtime's paths,
shared with the browser realms. Parts of
runtime-js already capture primordials (`reflectApplyPrimordial` in
`module-loader`, `process.ts`); the lifecycle modules do not. A guest hanging
its own run is bounded by the deadline (I4); what is not accepted is a wrong
status where Node has a right one (manager decision 2026-11-18, ADR-0557 §Not the user's words: an open,
declared fidelity class until this lands).

Same class, every host (2026-11-24, PR #436 external review; `runCode`,
Node v24.16.0): `os.availableParallelism()`/`os.cpus()` read the live
`navigator.hardwareConcurrency` (`builtins/os.ts`), which guest code can
replace (`globalThis.navigator`, or a getter redefined on
`Navigator.prototype`). A throwing getter makes `os.availableParallelism()`
throw; a `-1` getter gives `-1` and `os.cpus().length` 0 (Node `12 12`, its
`os` reads the binding); `5e6` ends the run `termination: 'memory'`. On the
browser hosts the same read hits the browser's `WorkerNavigator`.

Decode path (PR #462 review n3, 2026-11-26): `string_decoder` captures its own intrinsics
(PR #462: view getters, `Reflect.apply`, the encoding table, `toLowerCase` in `normalizeEncoding`),
but the strings come from `@riftydev/io`'s codec through live ones (on `main` too): a guest's
`TextDecoder.prototype.decode = …` changes every utf8 decode (`Buffer#toString`, `string_decoder`,
`setEncoding`); utf16le/latin1/ascii/base64 build with `String.fromCharCode.apply`, `Math.min`,
`new Array`; hex with `Number.prototype.toString`/`padStart`; base64 with `btoa`/`String.prototype.replace`.
In the COI Workbench the realm's `TextDecoder.prototype.decode` is rifty's shared-memory wrapper
(`ipc/worker-realm-compat.ts`) calling `orig.call`: with `Function.prototype.call` replaced, the
utf8 rows of parity `string_decoder/encodings-split` «patched Function.prototype.call» print `P`
there (in-process, SDK, isolate = Node). `ERR_INVALID_ARG_TYPE` (`internal/node-received.ts`) builds
with `Object.assign`, `Object.is`, `JSON.stringify`.

Store transport on the browser hosts (PR #469, measured 2026-11-26 with
`tools/node-parity-runner/cases/fs/write-view-bytes-patched-intrinsics.case.ts` as a `node <file>`
program; in-process and isolate equal Node): COI Workbench — a guest that patched
`%TypedArray%.prototype.subarray` or `byteLength`, or replaced global `Uint8Array`/`DataView`/`ArrayBuffer`,
makes the next write fail inside the sync-rpc transport (`sync-rpc call 'fs.writeChunk' failed:
decodeReply: unknown frame discriminator 0x5`, `offset is out of bounds`, `guest Uint8Array called`);
no-COI SDK — the run passes but OPFS write-through fails afterwards (`SandboxPersistenceError: OPFS
persistence failed (7 unhealed): … guest Uint8Array called; … guest DataView called`). Node writes the
bytes. Compat: `fs.md` row on write data.

Modules Node's stream core binds to (PR #471, stream core 8a differential, 2026-11-26; the core
and its bindings capture theirs at load and equal Node on the other rows): a guest replaces an
intrinsic after load, then runs a pipeline, `Readable.map/reduce`, an `fs.ReadStream` and
`finished` (`tests/integration/node-streams-differential/programs/p1-intrinsics-replaced.cjs`,
in-process vs the same core on Node's bindings, Node v24.16.0):
- `Array.prototype.slice` throwing: `@riftydev/io` `EventEmitter.emit` snapshots listeners with a
  live `slice()` (`event-emitter.ts:150`): the run dies at the first multi-listener emit, exit 1;
  Node completes.
- `Promise.prototype.then` throwing, or `globalThis.Promise` replaced: `fs.open` chains through the
  live `Promise.resolve().then` (`builtins/fs.ts:1241`), so `fs.ReadStream` cannot open
  (`threw replaced then called` / `Promise.resolve is not a function`); Node reads the file.
  Unit 4 (`runtime-js/fs-callbacks-io-turn`, PR #468) rewrites this path.
- `String.prototype.slice/includes/startsWith/endsWith/split` throwing: the vfs path layer
  (`vfs/src/path.ts` `normalizePath`/`isAbsolute`, `builtins/fs-path.ts` `pathToString`/`resolvePath`)
  reads them live, so `fs.createReadStream` throws where Node reads; `Number.isInteger` likewise in
  `fs.ts` `parseOpenFlags`.
- `String.prototype.startsWith` also in io's builtin registry (`loadBuiltin`/`readBuiltinUncached`
  `specifier.startsWith('node:')`), which the stream core's `process` binding reads on every
  `nextTick` (PR #471: a new registry entry point changed the Workbench chunking, so not done there).
- `Map.prototype.get/set` throwing: io's `EventEmitter` (`on`, `emitNewListener`) reads them live,
  the pipeline throws; `Map.prototype.delete`: `removeListener` throws inside the core's unpipe and
  the run dies (exit 1). Node completes each.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)

Isolate guest `TextDecoder` engine (ADR-0577, 2026-11-25, PR #459 critic): @exodus/bytes, which
decodes utf-16le/be and gb18030 there (Node: C++ ICU), reads live intrinsics on every call:
`String.fromCharCode = () => 'X'` → `new TextDecoder('utf-16le').decode(Uint8Array.of(0x41, 0))`
is `'X'` (Node `'A'`); a replaced `%TypedArray%.prototype.subarray` or `length` getter changes or
empties the result; `Object.defineProperty` replaced before the first such decoder makes its
constructor throw the guest's error. Node's own `encoding.js` and the utf-8 codec run on intrinsics
captured at load.
Its label too (PR #459 review S2): it normalizes the label it is given with the live
`String.prototype.trim`/`toLowerCase`, so `String.prototype.trim = () => 'utf-16le'` then
`new TextDecoder('utf-16be').decode(Uint8Array.of(0, 0x41))` gives `'䄀'` (Node `'A'`); pinned in
`packages/isolate-host/tests/text-decoder.test.ts` («intrinsics a guest replaces»). The guest's own
single-byte path reads `%TypedArray%.from` captured at load (same test, equal to Node).

