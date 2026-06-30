# Changelog

## [Unreleased]

### Added

- **`node:stream` exposes the modern statics** `isReadable`/`isWritable`/
  `isErrored`/`isDisturbed`, `getDefaultHighWaterMark`/`setDefaultHighWaterMark`,
  and `addAbortSignal` (re-exported from `@riftydev/io`, which owns them) — so
  `require('node:stream').isReadable(x)` etc. resolve.

- **`node:stream/web` module registered** in the builtin registry beside
  `stream`/`stream/promises`/`stream/consumers`. Re-exports the host (Chromium)
  WHATWG globals — Node's own implementation IS the WHATWG API — so each named
  export (`ReadableStream`/`WritableStream`/`TransformStream`/readers/controllers/
  `TextEncoderStream`/`TextDecoderStream`) is `=== globalThis.<Name>`. A
  genuinely-absent host member is a loud `NotImplementedError('stream/web.<Name>')`
  at access, never an `undefined`-export lie. Parity-proven (module keys +
  identities) vs real Node.

- **Auto-discovered tsconfig path aliases** (ADR-0170). `ModuleLoaderOptions`
  gains `autoDiscoverTsconfigPaths`; when enabled and no explicit `paths` map is
  supplied, the resolver uses TypeScript's real config parser over the VFS to
  locate nearest `tsconfig.json`, follow `extends`, honor JSONC/baseUrl/paths,
  feed the existing alias resolver, and use `baseUrl` as the bare-specifier
  fallback when no `paths` pattern matches. Alias/baseUrl probes use TypeScript's
  extension/index priority (`.ts` before `.js` when both siblings exist), and a
  malformed `compilerOptions.paths` shape throws `TSCONFIG_PARSE_ERROR` instead
  of leaking JS `TypeError`s. Default remains Node-faithful; explicit `paths`
  still wins.

- **Package-tooling loader blockers closed for Prettier/ESLint-class CLIs.** The module
  resolver now accepts absolute `file://` specifiers (including percent-decoding
  and query/hash stripping for VFS reads), CJS sources route real `import()`
  expressions through the VFS loader with keepalive, and runtime-built lexical
  `Function` constructors route constructed `import()` bodies through the same
  loader with the constructing module id baked in while preserving native
  `name`/`length`/prototype observables (ADR-0171). Helper bindings are
  source-unique across CJS/ESM/constructed-function transforms; constructed
  functions that combine routed `import()` with nested `Function` or `with`/`eval` dynamic scope now
  throw `module-loader.function-constructor-dynamic-scope` instead of letting
  dynamic scope shadow the loader helper or falling through to host import, and `.constructor`-derived host
  Function constructors that compile import-bearing source throw
  `module-loader.function-constructor-derived-host` instead of host-routing.
  Derived async / generator constructors remain an explicit ceiling, not a fake route. `runNodeEntry`
  now has a Prettier-shaped guard:
  `.bin/prettier` → CJS bin → `new Function('specifier','return import(specifier)')`
  → ESM core → `node:fs` write. Also expands `node:module` with
  `constants.compileCacheStatus`, non-throwing `enableCompileCache()` (honest
  `FAILED`, never fake `ENABLED`), `flushCompileCache`, `getCompileCacheDir`,
  and `isBuiltin`.
- **Package-tooling Node API support for Prettier/ESLint/typed ESLint.**
  `node:util` now includes `styleText`, `stripVTControlCharacters`, and
  `isDeepStrictEqual` (strict Map/Set/typed-array aware comparison) so ESLint's
  real `stylish` formatter and `typescript-eslint` project service run instead
  of tripping on missing helpers. `node:fs` callback/promise `stat`/`lstat`
  support options with a loud `bigint` ceiling, `node:readline` now has a
  line-oriented `createInterface({ input, output })` / `question()` subset, and
  cursor helpers (`cursorTo`, `moveCursor`, `clearLine`, `clearScreenDown`) emit
  ANSI sequences with callback completion. TTY keypress/raw-mode and
  `readline/promises` remain loud ceilings.
- **Public `node:os` / `node:path` / `node:perf_hooks` / `node:fs` builtin subpaths** (`./builtins/{os,path,perf_hooks,fs}`, ADR-0166 task 1.9). The same faithful shims that already back the `require('os')` module registry, now also importable directly. The playground aliases the BARE `os`/`path`/`perf_hooks`/`fs` specifiers to these so a Vite bundle containing a heavy node-targeting dependency (the `typescript` engine in the ts-language-service worker) resolves them to REAL rifty shims instead of Vite's empty browser stub (`os.platform is not a function` at the dep's module-eval). No first-party source imports these bare specifiers; it uses `node:*` + the module registry.

### Changed

- **Node 24 is the supported + parity-target version (ADR-0164).** `engines.node` `>=22`→`>=24`; every CI / Netlify pin `22`→`24`; `process.versions.node` impersonation `22.0.0`→`24.0.0` (v8 `12.0.0`→`13.6.0`), tracking the target. The parity gate runs against the CI Node, so it now measures rifty against **Node 24** — the version feature work already targeted — closing the dev(24)/CI(22) split. Fixes the `fs.Dirent.path` parity case that was red on Node 22 (the deprecated alias exists in 22, removed in 24; rifty omits it, correct for 24).

### Fixed

- **PR #76 review gaps recorded explicitly.** Added backlog contracts and
  `TODO(backlog:)` seams for tsconfig `baseUrl` bare-specifier behavior under
  modern `moduleResolution` modes and for lazy-loading TypeScript behind
  `autoDiscoverTsconfigPaths`.

- **Vite 8 review follow-ups (PR #55).** (a) `node:wasi` `WASI` gains parity tests locking Node 24's `finalizeBindings` latch order (verified vs `lib/wasi.js`): `started` latches after memory validation but BEFORE the `_start` shape check, so a missing-memory `start()` is retryable while a missing-`_start` failure latches (its retry throws `ERR_WASI_ALREADY_STARTED`). (b) `new WASI({ version: 'unstable' })` is a loud `NotImplementedError` (rifty serves the preview1 namespace only; the snapshot0 ABI differs) instead of silently flattening to preview1 — tracked `backlog/runtime-wasi/wasi-unstable-version-support` + compat-noted. (c) `util.styleText` rejects an unknown format with Node's `validateOneOf` message shape — `The argument 'format' must be one of: '…', … . Received <inspect(value)>` (was `must be a known style`; code already `ERR_INVALID_ARG_VALUE`; the allowed-list content is rifty's own style set). (d) `worker_threads.Worker` — a post-exit `terminate()` resolves with `undefined` (Node: the worker handle is gone), not the caller's argument.
- **TS/JSX module-loader honesty tightened.** `.jsx` inside a `type:"module"`
  package now classifies as ESM and runs through the async JSX transform hook,
  matching the `.ts`/`.tsx` path. Synchronous `require()` of `.jsx` now throws the
  same directed `NotImplementedError` as `.ts`/`.tsx` instead of leaking an opaque
  CJS compile `SyntaxError`. Auto-discovered tsconfig path parsing is now scoped
  to bare specifiers, so a malformed `tsconfig.json` cannot break ordinary
  relative `./dep.js` resolution.

- **TS transform and ESM AST caches validate source freshness.** A changed `.ts`
  file at the same module id now re-runs both the esbuild strip hook and the AST
  ESM transform even if a caller only invalidated the executed module record.
  This closes the stale-transform/stale-AST cache backlog items without dropping
  the fast path for byte-identical reloads.

- **Module-loader hard-ceil/parity tightening for package tooling.** Routed
  dynamic `import()` now rejects `Symbol` specifiers like real Node instead of
  resolving the string `"Symbol(...)"`. CJS/ESM `eval("import(...)")` text now
  hits the directed dynamic-scope ceiling instead of falling through to host
  import, and object-destructuring defaults such as
  `const { F = Function.prototype.constructor } = {}` feed the existing
  derived-host guard instead of escaping it. Dynamically composed derived
  constructor/eval bodies remain in the explicit exhaustive-metaprogramming backlog
  instead of causing import-time false positives for Vite-shaped evaluators.
- **Timer/immediate callback failures surface loudly.** `setImmediate` no longer
  catches and logs callback exceptions inside the MessageChannel dispatch path;
  failures propagate like Node instead of being swallowed as console noise.
- **Node-24 argument validation on the new `assert` / `fs` surfaces** (PR #62 review hardening; parity RED-then-GREEN). `assert.throws`/`doesNotThrow` reject a non-function `fn`, and `assert.rejects`/`doesNotReject` a first arg that is neither a function nor a thenable, with `ERR_INVALID_ARG_TYPE` (was: silently call / `await` a non-callable → mis-reported "Missing expected rejection"). `fs.utimesSync`/`lutimesSync`/`futimesSync` validate the time args via Node's `toUnixTimestamp` rules — a numeric string coerces, but `NaN`/`Infinity`/a non-numeric string throw `ERR_INVALID_ARG_TYPE` (was: a silent `NaN` handed to the VFS clock). `fs.cpSync` `errorOnExist` drops the non-Node `[ERR_FS_CP_EEXIST]:` message prefix (the code already matched). The pre-existing `cp` file→dir / dir→file type-mismatch codes are tracked in `backlog/runtime-js/fs-cp-type-mismatch-error-codes`.
- **Silent Node divergences — failing-parity-first fixes** (closes backlog/runtime-js/silent-node-divergences). Four `node:` builtins returned WRONG values with no throw (worse than a loud gap); each pinned by a RED-then-GREEN parity case vs Node v24. (1) `util.inspect(value, options)` — the 2nd positional is now an OPTIONS object, not the internal depth counter, so `util.inspect(obj, { depth: null })` renders unlimited (was misread as `depth = NaN`) and `{ depth: 0 }` collapses containers to Node's `[Object]`/`[Array]`/`[Map]`/`[Set]` placeholders; strings inside structures use SINGLE quotes with Node's dynamic `"`/`` ` `` fallback (was `JSON.stringify` double-quotes). Default nesting depth + colors/getters/sorted remain `util-surface-completions`. (2) `querystring.parse` decodes a literal `+` → space (express/formidable) — structural, parse-only (`+`→`%20` BEFORE the decoder so a custom `decodeURIComponent` sees `%20` like Node; `%2B` survives; `querystring.unescape` still leaves `+`). (3) `util.format('%c', arg)` consumes its arg and emits nothing (was keeping the literal `%c` AND leaking the arg). (4) `import.meta.resolve` does real loader resolution (see `docs/public/compat/modules.md`): any `node:` specifier returned verbatim (Node doesn't validate the builtin at resolve time), files → `file://<abs>`, a bare/relative miss throws the resolver's `MODULE_NOT_FOUND` — replaced the inline `new URL(s, baseUrl).href` stub that returned a wrong `file://` URL for bare/`node:` specifiers. `repl/inspect.ts` also gained Node's `<Buffer …>` hex rendering driven by the live `buffer.INSPECT_MAX_BYTES`.
- **`worker_threads` Vite 8 follow-ups (review).** (a) Kernel-path `workerData: -0`
  is now LOUD-rejected (`NotImplementedError`) instead of silently shipping `0`
  over the JSON wire — `JSON.stringify(-0)==='0'` would drop the sign Node's
  structuredClone keeps; the over-rejected structuredClone surface (Date/Map/Set/
  TypedArray/BigInt/NaN/Infinity/-0, all loud, none silent) is now tracked at
  `backlog/runtime-js/worker-threads-kernel-workerdata-structured-clone`. (b) The
  kernel path's `serve:true` (keeps a message-driven Worker alive — Node parity +
  Rolldown's pool) means a run-to-completion Worker does not auto-emit `'exit'`
  like Node; marked explicit at the spawn site and tracked at
  `backlog/runtime-js/worker-threads-kernel-run-to-completion-exit` (the same-realm
  path already auto-exits). (c) `worker-realm-compat.ts` header corrected — the
  realm shims install via `installNodeRuntime` (the host's registered pre-entry
  hook; the kernel ships no default) gated to Node workers, not a mythical
  "default preEntryInstaller" for "every" realm.

- **Real-Node `MODULE_NOT_FOUND` shape for a missing CJS entry / `require()`** (closes backlog/runtime-js/node-entry-miss-node-shape). The resolver throws Node's faithful `Cannot find module '<spec>'` message (with a `Require stack:` block when non-empty) + `err.requireStack` for a missing ENTRY (incl. `.mjs`, which Node runs through the CJS loader) and a nested `require()` — parity-proven head-to-head vs real Node v24. `runNodeEntry` surfaces these to the child stderr as Node's CJS printed form (`Error: Cannot find module … { code, requireStack }`, no rifty `ModuleLoadError` name / frames), so `node ./nope.js` matches Node. Honest deltas: ALL stack frames are dropped (Node-internal frames have no in-browser equivalent; the user call-site frame isn't synthesized either), the `Node.js vX` trailer is omitted, `requireStack` uses the inline inspect form (long paths don't wrap), and deeper ancestors collapse to the immediate requirer. A nested ESM `import()` miss is Node's DIFFERENT `ERR_MODULE_NOT_FOUND` — it is left as an honest, non-masquerading rifty `ModuleLoadError` (NOT fake-shaped as CJS): `backlog/runtime-js/esm-import-miss-err-module-not-found`. See `docs/public/compat/process.md`.

- **Vite 8 / Rolldown WASI pthread boot — runtime-side fixes** (all needed for
  `@rolldown/binding-wasm32-wasi`'s emnapi worker to load + run in a kernel
  worker realm):
  - **Node `global` realm alias.** The kernel pre-entry hook installs
    `global === globalThis` (Node parity) via `installWorkerRealmCompat`, folded
    into `installNodeRuntime`'s Node-worker branch. CJS packages built for Node
    reference bare `global` — `@emnapi/*` died with `global is not defined`.
  - **`createRequire` wiring for node entries.** `runNodeEntry` now publishes a
    `createRequire` impl backed by its module loader, so a Node entry run in a
    worker_threads pthread realm (Rolldown's `wasi-worker.mjs`) can call
    `createRequire(import.meta.url)` instead of throwing "no loader registered".
  - **IPC backlog flush is a macrotask, not a microtask.** Worker IPC messages
    buffered before a `'message'` listener now flush on the next event-loop turn
    (Node parity) — a microtask delivered the `{__emnapi__:load}` frame mid-eval,
    before `wasi-worker.mjs` set `globalThis.onmessage` (TypeError).
  - **Writable `self` + shared-memory-tolerant `TextDecoder`** in the worker
    realm: emnapi assigns `globalThis.self` (a getter-only `WorkerGlobalScope`
    accessor) and `TextDecoder.decode`s strings straight out of shared wasm
    memory, which older Chromium rejects ("must not be shared") — the shim copies
    a shared-backed view first. These realm-compat shims (plus the `global` alias)
    live in `ipc/worker-realm-compat.ts` (`installWorkerRealmCompat`) and are
    folded into `installNodeRuntime`'s Node-worker branch (ADR-0157), so every
    Node worker realm (incl. Rolldown's emnapi pthread children) is shaped; a WASI
    guest (raw WASI, not Node CJS) skips them.
    The `TextDecoder` patch stays UNCONDITIONAL: the copy is a cheap no-op where
    the realm accepts shared views, whereas a feature-detect probe (a tiny shared
    decode) is not representative of emnapi's real decode and false-negatives,
    skipping the patch the guest needs (m7 regression).

- **`worker_threads` + `node:wasi` Node-parity fixes.**
  - `worker_threads`: `threadId` numbers the main thread `0` and Workers `1, 2, …`
    (was main `1` / first worker `2`); a `'online'` event fires before `'exit'`
    on both the kernel and same-realm paths; `worker.terminate()` with no argument
    resolves with exit code `1` (Node's forced-termination code), while internal
    callers keep their explicit code (`0` for a natural same-realm completion).
    The kernel-path `'error'` event for a worker-runtime uncaught throw is the one
    remaining gap — explicit `backlog: runtime-js/worker-threads-kernel-error-event`
    (needs real cross-realm Error propagation; faking it from the exit code would
    lie). Same-realm path already emits `'error'`.
  - `node:wasi.WASI`: `start()`/`initialize()` are single-entry (a second call
    throws `ERR_WASI_ALREADY_STARTED`) and require an exported
    `WebAssembly.Memory` (`ERR_INVALID_ARG_TYPE`), matching Node. The lower-level
    `@riftydev/runtime-wasi` `Wasi` runner stays lenient (it backs `runWasi` and
    the gate's memory-less `proc_exit` probe).

### Added

- **`node:crypto` async/one-shot randoms over the shipped sync cores** (closes backlog/runtime-js/crypto-random-and-oneshot). Adds the callback overload `randomBytes(size, cb)` + async `randomFill(buf[, offset, size], cb)` (deferred `cb(null, buf)`), `randomInt([min, ]max[, cb])` with **unbiased rejection sampling** (48-bit draw, biased-tail rejection — no modulo bias near power-of-two-adjacent ranges; async form is `cb(undefined, n)`), and one-shot `crypto.hash(algorithm, data[, outputEncoding])` (default `hex` string, `'buffer'` output mode, string + any ArrayBufferView input — a raw `ArrayBuffer`/number/null is rejected with `ERR_INVALID_ARG_TYPE`, matching Node). Faithful size/bounds contract vs real Node v24: `randomBytes` floors non-integer sizes and throws `ERR_OUT_OF_RANGE` outside `[0, 2^31-1]` (incl. `NaN`, since it is a number — not a type error); `randomInt` throws `ERR_OUT_OF_RANGE`/`ERR_INVALID_ARG_TYPE` and validates SYNCHRONOUSLY even in the callback form. `randomFill`/`randomFillSync` likewise floor a non-integer offset/size and throw `ERR_OUT_OF_RANGE` for a negative/`NaN`/out-of-window offset or size (incl. `offset + size > length`) or `ERR_INVALID_ARG_TYPE` for a buffer that is neither an `ArrayBufferView` nor a raw `ArrayBuffer` (Node accepts both for `randomFill`, and fills them in place) — synchronously, even in the async form. `hash` honours the `latin1`/`binary` output-encoding alias. The shared fill core now CHUNKS under the 65536-byte Web Crypto `getRandomValues` cap, so big `randomBytes`/`randomFill` sizes Node allows no longer throw `QuotaExceededError`. Unsupported hash algos stay a loud `NotImplementedError` (honest gap). 5 parity cases + a deterministic rejection-sampling unit proof.
- **`node:fs` / `node:path` pure-JS completions** (closes backlog/runtime-js/fs-path-pure-js-completions). `fs.readdirSync`/`promises.readdir` `{ recursive: true }` — Node-identical breadth-first full-tree walk — coupled with `fs.Dirent.parentPath` (echoes the dir arg joined with the subdir; no removed-in-v24 `path` alias). `fs.cp`/`cpSync` edge options `{ filter, force, errorOnExist, preserveTimestamps }` (reimplemented over VFS sync primitives when an edge opt is present; plain copies keep the fast VFS path); `dereference` loud-throws `NotImplementedError` (N/A under no-symlink, ADR-0050). `fs.openAsBlob(path[, { type }])` (default type `""`; a missing file rejects with Node's generic `ERR_INVALID_ARG_VALUE`, not raw `ENOENT`). `fs.lutimesSync`/`promises.lutimes` (≡ utimes, no-symlink). `fs.futimesSync`/`fs.futimes` (fd→path, `EBADF` syscall `futime` on a bad fd). `path.toNamespacedPath`/`posix`/`win32` POSIX identity no-op. All parity-pinned vs Node v24. The glob family (`fs.glob`/`globSync`/`promises.glob` + `path.matchesGlob`) is split to backlog/runtime-js/fs-glob-matchesglob-minimatch (full minimatch — a subset would loud-throw on the common `{js,ts}` brace).
- **`node:assert` / `node:console` / `node:os` completions** (closes backlog/runtime-js/assert-console-os-completions). assert: `match`/`doesNotMatch` (RegExp, `ERR_INVALID_ARG_TYPE` on a non-RegExp pattern), `ifError` (throws non-null wrapped, preserving the original error's stack frames), `rejects`/`doesNotReject` (async, reuse `matchesExpected`), the `throws`/`rejects` Error-INSTANCE + validation-OBJECT expected forms (`matchesExpected` now deep-key-subset compares an object / matches an Error's name+message+own props; a RegExp value tests the field), and `partialDeepStrictEqual` (recursive subset — objects by present keys, arrays as an in-order subsequence, Map/Set by membership, leaves strict). All on both `assert` and `assert/strict`, parity-pinned vs Node v24 (by code, not message prose). `console.dirxml` aliases `log` (non-DOM). os constants (host-divergent → unit-pinned): `os.machine()` = `'wasm'` (mirrors `arch()`, ADR-0026), `os.devNull` = `'/dev/null'`, `os.version()` consistent with `release()`/`type()`.
- **Web `global` alias + `node:buffer` module-level surface** (closes backlog/runtime-js/web-globals-and-buffer-exports). `globalThis.global = globalThis` (v12) installed beside Buffer/process/timers in the worker boot — the highest-reach single unblock for CJS `global.X` / `typeof global !== 'undefined'` in process-polyfills/webpack-shimmed/jest-style libs (was a `ReferenceError`). `node:buffer` now exports beyond `{ Buffer }`: browser-native `Blob`/`File`/`atob`/`btoa`, `SlowBuffer` (= `allocUnsafeSlow`), `isUtf8`/`isAscii` (reject a DataView with `ERR_INVALID_ARG_TYPE` like Node), and a LIVE `INSPECT_MAX_BYTES` getter/setter driving the new `util.inspect(buf)` `<Buffer …>` truncation (own enumerable props appended, Node parity). `resolveObjectURL` loud-throws `NotImplementedError` (no introspectable cross-realm blob registry — Fidelity, not a silent `undefined`). Buffer prototype/static additions (variable-width int accessors, `toJSON`, `copyBytesFrom`) ship from `@riftydev/io` — see its changelog. The v22-experimental global `scheduler` is deliberately NOT installed: Node v24 exposes none (only `require('node:timers/promises').scheduler`), so adding it would diverge.
- **`node:zlib` web-compression-backed async subset (ADR-0159).** Real async one-shot `gzip`/`gunzip`/`deflate`/`inflate`/`deflateRaw`/`inflateRaw` over the host `CompressionStream`/`DecompressionStream` (`'gzip'`/`'deflate'`/`'deflate-raw'` → RFC-1952/1950/1951), wire-compatible with real Node both directions (rifty output reads in Node's native zlib and vice versa — conformance-pinned, not a self round-trip). `(buf[, opts], cb)` shape with `(err, Buffer)` so `util.promisify` works; string/Buffer/TypedArray/ArrayBuffer input. Full real `constants`/`codes` table + legacy top-level constant aliases (non-enumerable, Node shape). Replaces the all-throwing `node:zlib` stub in `null-net-stubs.ts`. Loud ceilings (compat ❌): `*Sync` (async-only API), brotli + zstd (no Web API), `crc32`, the Transform-stream surface (`createGzip`/`Gzip`… — gated behind a future ADR), `unzip` auto-detect; `windowBits` + `dictionary` + truthy-`info` throw — `CompressionStream` emits a fixed max window, so silently honoring a smaller `windowBits` would emit window-15 bytes a strict zlib consumer rejects (`Z_DATA_ERROR`); a preset dictionary changes the wire bytes; truthy `info` changes the return shape — while size-only knobs (`level`/`strategy`/…) are inert no-ops (`info:false`, the default, too), and `maxOutputLength` is honored (early-abort `ERR_BUFFER_TOO_LARGE` decompression-bomb guard). `zlib.codes` is frozen to match Node. New `docs/public/compat/zlib.md`; 38 conformance + 6 parity cases.
- **`awaitDrain` re-exported from the package root** — the serve-capable `node <file>` child bootstrap (ADR-0155) awaits event-loop drain via the public API.

- **ESM module parity guards:** `import.meta.url` and `package.json#imports` (`#name` exact,
  wildcard, and conditional maps) now have node-parity cases. Both features were already wired in
  the loader; the stale backlog/compat records are closed.

- **Event-loop keepalive (libuv-style refcount over timers/immediates/pending dynamic imports) + `unhandledrejection` loud-fail:** run-to-completion children now drain async work scheduled after top-level (Node-parity) and fail loudly on a rejection or a never-draining loop (generous cap, documented divergence) instead of silently exiting 0. The pending-import ref is held on BOTH paths — the public `loader.import` AND the routed user-code `import()` (`esm.ts dynamicImport`, reached via the `__import` rewrite) — so a detached `import('./x').then(run)` whose load spans a macrotask reaches `run` before the realm reaps (the prettier-class scenario). The keepalive counts a deliberately NARROW handle set, not all libuv handles — see ADR-0152 + `docs/public/compat/process.md` for the shape. (The detached-`fetch`/network and `fs.watch` gaps noted here at first light are now closed — `fs.watch` is counted with working `FSWatcher.ref()/.unref()`, and the global `fetch` is counted per the fetch-keepalive entry below + ADR-0158.)

- **Detached `fetch()` keepalive (ADR-0158):** the child realm's global `fetch` is now keepalive-counted — `keepaliveRef()` on dispatch, held until the response BODY is consumed (any Body-mixin consumer or the `body` stream closing/cancelling), released on reject or when there is no body. A detached `fetch(u).then(r=>r.text()).then(write)` after top-level now completes before a run-to-completion realm drains, instead of being dropped silently. Held until the body (not headers) because Node keeps the socket refed until the body is read. The counted boundary is the global `fetch` — the realm's sole real network egress: `http.request`-to-external routes through it (covered), loopback `http.request` is in-process (no socket), `https`/`net.connect` are loud-throws. `installFetchKeepalive` ships in the child-realm bootstrap next to the timer/keepalive installs. compat `process.md` Detached `fetch()` ❌→✅.
- **Vite 8 support surface (ADR-0162):** added `node:wasi` backed by the new
  `@riftydev/runtime-wasi` dependency, `util.styleText`, and a real
  `worker_threads.Worker` kernel path for ESM worker
  scripts used by Rolldown's WASI pthread pool. The kernel-backed path now wires
  worker-side `parentPort`/`workerData`, inherits the parent `process.cwd()`,
  rejects non-JSON-safe `workerData` with `NotImplementedError` instead of
  silently reshaping it, and buffers parent messages posted before the script
  installs handlers, matching Node's early `postMessage` behavior instead of
  dropping `emnapi` load frames. The `node:wasi.WASI` wrapper validates
  `options.version` like Node; the lower-level runtime-wasi `Wasi` runner keeps
  its existing convenience constructor.

### Fixed

- **`clearTimeout`/`clearInterval` honor the numeric primitive id (Node parity).** A timer handle
  exposes a `[Symbol.toPrimitive]` id; Node's `clear*` accept that coerced number. The handles are
  now tracked in a `primitiveId → handle` registry so `clearInterval(Number(handle))` resolves the
  live handle — previously it missed the `instanceof` branch, forwarding the id to the host clear as
  an unrelated integer (no-op clear + leaked keepalive ref + possible cross-clear of a host timer).
  One-shot timeouts deregister on fire, intervals on clear. Parity case `timers/clear-by-primitive-id`.

- **`node:timers/promises` `setInterval` honors `{ ref: false }`.** The between-iterations timer was
  armed without forwarding `ref`, so an explicitly-unrefed async-iterator interval still held a
  run-to-completion child alive; the option now threads through to the keepalive handle (Node parity).

- **`fs.watch`/`fs.watchFile` `FSWatcher.ref()`/`.unref()` are no longer no-op stubs.** They delegate
  to the poll `setInterval`'s keepalive handle, so an unrefed active watcher no longer pins the realm
  to the drain cap (Node parity).

- **`fs.createReadStream` byte range `end` is INCLUSIVE (Node parity).** `{ start, end }` now reads
  `end - start + 1` bytes — the Node-inclusive `end` is converted to the half-open `[start, end)`
  `Vfs.openReadable` / sync-slice window at the `createReadStream` boundary (`+1`). Previously the last
  byte was dropped. Parity case `fs/createreadstream-byte-range`; conformance corrected to the Node value.

- **Timer handles honor `.unref()` / `.ref()` / `.hasRef()` in the keepalive model.**
  `setTimeout`/`setInterval` now return Node-shape handles whose ref state drives the child-realm
  active-handle count; `node:timers` exports the same wrappers as the installed globals, closing the
  namespace asymmetry. An unrefed timer no longer holds a run-to-completion child alive to the drain
  cap, and `.ref()` opts it back in.

- **`SyncRpcFsSync.readFileBytesSync` ENOENT shape matches `VfsError` (closes backlog runtime-js/child-remote-fs-fidelity).** Hand-rolled `Error{code:'ENOENT'}` replaced with `new VfsError('ENOENT', path)` — same `name`/`code`/`instanceof` as every other VFS backend. `statSync` over the sync-RPC loopback is now round-trip-tested (the `fs.stat` owner handler was gratuitously `async`, leaving `statSync` as the one unexercised remote method).

- **`SyncRpcFsSync.readFileBytesSync` no longer silently truncates (review #2, ADR-0150).**
  A 0-length chunk before the stat'd size (owner store shrank mid-read) now THROWS instead of
  returning the partial buffer as a successful read — honouring ADR-0150's "never
  silent-truncate". Regression test added (`sync-rpc-fs.test.ts`).

### Removed

- **Generic worker-backed `child_process.spawn('node', …)` / `fork()` throws
  `NotImplementedError` instead of spawning an empty-mirror child (review #1, ADR-0150).** The
  generic path never wired `RIFTY_REMOTE_FS`, so a worker it spawned read its OWN empty mirror,
  not the parent/owner store (only the owner `.bin` executor wires it). Reachable solely from a
  realm with the kernel + node-entry worker URLs (owner/page); the supervised-child realm keeps
  the working same-realm fallback. The dead `child_process-worker.ts`
  (`spawnWorkerChild`/`spawnViaWorker`) is removed. Proper remote-FS wiring →
  `backlog: runtime-js/generic-spawn-worker-remote-fs`.

### Changed

- **Unified spec-seeded mutable `NodeProcess` + gated rich pre-entry install (ADR-0157).** The
  kernel pre-entry shim (`WorkerNodeProcessShim`) and the REPL `RiftyProcess` are now ONE
  `NodeProcess extends EventEmitter` (`builtins/process.ts`): spec-seeded (pid/ppid/argv/env/cwd +
  stdio MessagePorts + ADR-0045 fork-IPC) AND mutable (chdir/nextTick/hrtime/uptime/exitCode). The
  pre-entry installer (`ipc/install-process.ts`) builds it once and, gated to Node workers
  (`isNode = spec.env.__RIFTY_WASI_WASM_URL === undefined`), also runs `patchPromiseForNextTick()`
  + installs `globalThis.Buffer` — so kernel-spawned Node CLIs gain `nextTick`/`hrtime`/`Buffer` they
  previously lacked, while a WASI realm leaves `Promise.prototype.then` native and gets no `Buffer`.
  `installProcessGlobals()` is now idempotent (skips when `globalThis.process` is already a
  `NodeProcess`), which — together with removing the in-entry swap so the pre-entry spec process is
  canonical — MITIGATES `backlog: runtime-js/worker-entry-process-globals-side-effect` (chunk-graph
  isolation still tracked there). Public subpath exports
  (`./install-process`, `./builtins/process`) and their helpers (`riftyProcess`, `setProcessCwd`,
  `getProcessCwd`, `writeProcessStdin`) are preserved as delegates over the unified class.
- **`node:vm` dual-engine cutover (ADR-0142, supersedes ADR-0138).** `node:vm` sandbox APIs
  (`runInNewContext`/`runInContext`/`Script.*`) now run in a REAL QuickJS-WASM realm by
  DEFAULT; the host-realm `with(proxy)+eval(AST-rewrite)` engine is a LOUD opt-in (`vmEngine`
  host option / `__RIFTY_VM_ENGINE`, one-time stderr warning + `vm.engine.rewrite-active`
  telemetry). `runInThisContext` stays host-realm `(0,eval)` (it IS the worker realm —
  Node-correct). The real realm closes the ADR-0138 direct-`eval` leak by construction and
  gives Node-correct cross-realm identity + real global-object semantics (a behavior change vs
  the old rewrite, which is the V8-correct floor). Cost: new deps
  (`@jitl/quickjs-wasmfile-release-sync` + `quickjs-emscripten-core`, ~503 KB env-config
  `.wasm`) + ~6× eval + per-property membrane crossing. Four ES2023≠V8 residuals documented in
  `docs/public/compat/modules.md`. The per-task entries below (T5–T19) are the implementation
  log; ADR-0142 is the decision record. This consolidates and ratifies that work.

- **`node:vm` CUTOVER — QuickJS real realm is now the DEFAULT engine (T17, ADR-0142).**
  `resolveVmEngineName()` defaults to `'quickjs'`; the hardened-rewrite engine is now a
  LOUD opt-in (`__RIFTY_VM_ENGINE='rewrite'` / `vmEngine` host option → one-time stderr
  warning + `vm.engine.rewrite-active` telemetry). BEHAVIOR CHANGE: sandbox semantics are
  now Node-correct where the rewrite engine was Node-WRONG — (1) **cross-realm identity**:
  a guest throw/value crosses the membrane as a cross-realm mirror, so `instanceof`/
  `constructor ===` against a HOST constructor is now FALSE (matching real Node; `.name`/
  `.constructor.name` stay faithful); (2) **realm isolation**: a fresh context no longer
  inherits host globals (rewrite's `with(proxy)` leaked them); (3) **direct eval** stays in
  the guest realm (no host leak); (4) real global-object attribute/lexical/strict semantics.
  Shared dispatcher guard: `runInContext`/`Script.runInContext` now reject a
  non-contextified object with a Node-faithful `TypeError` (both engines). Membrane sweep
  now reflects a guest `delete` of a seeded sandbox key back to the sandbox object (Node's
  live contextified object). Known residual (T19): contextified-sandbox key ENUMERATION
  order differs from V8 (QuickJS creation order vs V8's setter order — `Object.keys` order
  of a sandbox is V8-internal, not spec). The rewrite engine stays a shippable opt-in,
  guarded by the `rewrite-optin-*` parity cases.

- **`node:vm` review follow-ups (doc + test hardening, no behavior change).** Fixed two stale
  `membrane.ts` doc-comments (host-fn marshalling + the function-wrapper arg path are IMPLEMENTED,
  not "loud boundary"/"primitives only"); documented the inbound (host→guest) seed retention + the
  two membrane reconciliation caveats on the public compat surface; clarified that engine selection
  is process-global (not per-context); strengthened the GC-gated disposal-stress assertions to
  require FULL reclaim (`toBe(0)` + unconditional dispose). Tracked two defined-but-unwired vm seams
  (wasm-URL env-config, explicit `disposeContext`) and the remaining vm test-pinning gaps in
  `docs/backlog/runtime-js/vm-unwired-seams` + `vm-test-pinning`.

### Fixed

- **`node:constants` / `fs.constants` — faithful static data, syscall-boundary gap (ADR-0153).**
  `node:constants` is no longer an empty placeholder: it is a frozen flattened union of `fs` +
  `os.{signals,errno,priority,dlopen,UV_UDP_REUSEADDR}` + `crypto.constants` that returns the REAL
  Node Linux-ABI number for a known key and `undefined` for an absent one — exactly Node's shape
  (single-source spread, so the surfaces never drift). `fs.constants` gained the full Node Linux
  set: the `O_*` flags (`O_SYNC`, `O_DSYNC`, `O_DIRECT`, `O_NOATIME`, `O_NOFOLLOW`, `O_NONBLOCK`,
  `O_NOCTTY`), POSIX mode bits (`S_IF*`, `S_IR*`/`S_IW*`/`S_IX*`), `COPYFILE_FICLONE*`, `UV_FS_*`,
  `UV_DIRENT_*`. Reading a constant never throws (mode-bit math, bitmasks, logging,
  `JSON.stringify`, feature-detection behave like Node); the honest unimplemented-BEHAVIOR gap
  moved to the syscall — see the `fs.open`/`copyFile` entry below.
- **`fs.openSync`/`copyFileSync` surface unsupported flags loudly at the syscall (ADR-0153).**
  `openSync` throws `NotImplementedError('fs.openSync.O_SYNC')` when `O_SYNC`/`O_DSYNC` durability
  is requested (OPFS flush is async/batched); inert-on-a-regular-VFS-file flags (`O_NONBLOCK`,
  `O_NOFOLLOW`, `O_NOCTTY`, `O_DIRECT`, `O_NOATIME`) open successfully as no-ops, matching Node;
  a bit mapping to no real flag is still `EINVAL`. `copyFileSync` accepts `COPYFILE_FICLONE`
  (best-effort → plain copy, like Node on a non-reflink fs) and throws
  `NotImplementedError('fs.copyFileSync.COPYFILE_FICLONE_FORCE')` for the forced variant.
- **`node:vm` (quickjs) inbound prototype-method fidelity (T19).** A host array/object seeded
  into a context now carries its PROTOTYPE METHODS in the guest (`items.map`/`join`,
  `obj.hasOwnProperty`) while staying `instanceof Array`/`Object` FALSE and `Array.isArray` TRUE —
  matching real Node. The membrane previously severed the seed's proto to `null`, which kept the
  `instanceof`-FALSE half but STRIPPED every inherited method (calling one threw
  `not a function`); replaced with a cross-realm FLAT proto carrying the kind's full method chain
  (`GENERIC_REBRAND_BOOTSTRAP`, the inbound mirror of the exotic rebrand). Surfaced by a realistic
  template-engine parity case; pinned by `vm/quickjs-inbound-methods` + conformance.
- **`node:vm` non-object context-arg error message fidelity (T19).** `describeNonObject` now
  byte-matches Node's `ERR_INVALID_ARG_TYPE` per type: `undefined`/`null` render BARE (was
  `type undefined (undefined)`), a bigint keeps its `n` suffix (`0n`, was `0`), `-0` stays `-0`,
  strings are quote-selected + truncated >28 to 25 + `...`. Pinned by `vm/quickjs-context-arg-errors`
  + conformance.

### Added

- **`node:vm` realistic parity corpus + ES2023-vs-V8 divergence list (T19).** Four real-world-usage
  parity cases on the default quickjs engine (config/plugin loader, template-engine closure,
  structured-result compute, two-runs-share-state), byte-matched vs real Node, plus the
  inbound-methods + context-arg-errors regression cases. The HONEST ES2023≠V8 divergence list
  (`function undefined(){}` error type; explicit `var x = undefined` not propagated; sandbox key
  enumeration order; `delete` of a context var) is documented in `docs/public/compat/modules.md`
  with the `rewrite` opt-in as the V8-correct workaround — feeds the T20 ADR.
- **`node:vm` disposal/lifetime STRESS tests (T18).** New
  `src/builtins/vm/quickjs-disposal-stress.test.ts` validates the `ContextLifetime`
  FinalizationRegistry + refcount net under churn — the guarantee that a leaked guest
  handle never aborts the WASM runtime (`Assertion failed: list_empty(&rt->gc_obj_list)`)
  and that growth is bounded. Five scenarios, split DETERMINISTIC (default `test:run`, via
  the `releaseWrapper`/`markPending` seam) vs GC-GATED (`--expose-gc` only, else skipped):
  (1) long-lived context, 5000 runs — primitive completions leave 0 live wrappers; fresh-
  object completions released each run stay ≤1; (2) 500 contexts churned — deterministic
  GC-ordering simulation disposes each exactly once (no abort/double-dispose), GC-gated
  500/500 abandoned contexts collected; (3) adversarial release/markPending ordering (the
  core no-ordering-guarantee invariant) — disposes only on the last release in either
  order, plus churn-while-pending; (4) hot host-fn loop (carried T9) — confirmed
  GC-bounded (peak 1000 → post-gc 0), documented why eager arg-wrapper release is unsafe
  (cannot distinguish a discarded arg from a stored callback → use-after-free); (5)
  delete-reflection churn (carried T17) — 2000 reseed/sweep cycles leave `#preRunSandboxKeys`
  and sandbox keys bounded, deep write-back holds inbound identity. No leak/abort found —
  the net holds; no hardening required.

- **Public telemetry data types (T16).** `TelemetryEntry`, `TelemetryKind`, `TelemetrySnapshot`
  are now type-only exports of `src/index.ts` (also re-exported from `@riftydev/rifty` next to
  the runtime event surface), so an SDK consumer can type the `diagnostic` RuntimeEvent/
  WorkerMessage payload without a forbidden deep import. Sink mutation fns (recordX/snapshot/
  reset) stay internal. The dev-only playground divergence PANEL is deferred —
  `docs/backlog/playground/divergence-telemetry-panel.md` (guest runs the kernel/shell path,
  not `RuntimeController`, so a panel needs telemetry bridged through the kernel first).

- **`node:vm` divergence telemetry wiring + `vmEngine` host option + loud opt-in (T15,
  ADR-0142).** Five wirings: (1) the QuickJS preload (`ensureVmEngineReady`) joins the
  worker `boot` promise so a synchronous `vm.*` sandbox call in an early eval always
  finds the engine ready (preload failure → `[rifty]` stderr line + continue on the
  rewrite engine). (2) The worker error boundary calls `captureNotImplemented(err)` —
  matched by `error.name === 'NotImplementedError'` (NOT instanceof; io + vfs each
  define the class), recording `error.feature` in the telemetry sink. (3) A sandbox RUN
  resolving to the opt-in rewrite engine records `vm.engine.rewrite-active` and emits ONE
  loud `[rifty]` warning per process/worker via `process.stderr.write` (real fd 2 in
  Node, the worker stderr bridge in the worker) — the parity runner diffs STDOUT and only
  intercepts `console.*`, so the warning never pollutes parity stdout. (4) New
  `RuntimeOptions.vmEngine?: 'quickjs' | 'rewrite'` (host) → `vm-config` HostMessage sent
  on worker `ready` → worker applies `setVmEngineOverride` (programmatic path; the
  `__RIFTY_VM_ENGINE` env fallback is unchanged). Default behavior unchanged when absent.
  (5) New `diagnostic` WorkerMessage carrying a `TelemetrySnapshot`, posted after each
  eval only when the snapshot CHANGED; the host surfaces it as a `diagnostic`
  RuntimeEvent for the playground panel (T16). `captureNotImplemented` is exported from
  the telemetry sink (pure, name-matched, no-op for non-NotImplemented values).

- **Divergence / NotImplemented telemetry sink (T14).** Leaf module
  `src/telemetry/divergence-sink.ts` — dependency-free, session-scoped, dev-only
  in-process hit counter. `recordNotImplemented(feature)` / `recordDivergence(feature)`
  increment per-feature counts; `snapshotTelemetry()` returns `TelemetryEntry[]` sorted
  by count desc (ties stable by insertion order); `resetTelemetry()` clears. Both
  recorders accept `{ warnOnce: true }`, returning `true` only the first time per
  feature (warned-set, also cleared by reset) so a caller can emit a one-time loud
  warning. No network, no persistence (T16 playground may persist; sink stays pure).
  T15 wires boundary capture (`error.name === 'NotImplementedError'`) + a `diagnostic`
  WorkerMessage + the rewrite-engine opt-in warning.

- **`node:vm` QuickJS engine — real global-object fidelity (T13, ADR-0142).** The
  QuickJS real realm reproduces a real vm global object's attribute/lexical/strict
  semantics that the rewrite engine (a `with(proxy)+eval` over a plain property bag)
  could not — mostly BY CONSTRUCTION (real intrinsics, strict mode, lexical scope,
  real global). Verified byte-for-byte vs real Node (parity `vm/quickjs-global-object`)
  + locked in conformance: redeclared intrinsics (`var undefined/NaN/Infinity`, bare
  `NaN = 1`) are silent no-ops; `var`/`function` bindings are non-configurable so
  `delete d`/`delete f` are no-ops returning `false`; `let undefined` is a
  redeclaration `SyntaxError`; a written `globalThis` and a context var named `eval`
  read back; a `"use strict"` undeclared write throws `ReferenceError`; top-level
  `let`/`const`/`class` persist across `runInContext` calls (re-declaration next run
  is a `SyntaxError`) via the reused per-context `QuickJSContext`. The membrane sweep
  was fixed so a declaration-only `var z;` no longer leaks to the contextified
  sandbox object (it is an enumerable own prop of the vm GLOBAL only — matching V8
  contextify, which copies a global to the sandbox only when an assignment fired): a
  swept key whose value is `undefined` AND whose global binding is non-configurable is
  recognised as a declaration-only `var`/`function` and skipped, while assigned
  values, `this.x =`/bare writes (configurable), and a later assignment to a declared
  var still propagate. Residuals (documented, not faked): an explicit `var x =
  undefined` initializer is post-run indistinguishable from `var x;` so it is also
  skipped; and `function undefined(){}` raises QuickJS's spec-literal runtime
  `TypeError` ("cannot define variable") vs V8's early `SyntaxError` — the one genuine
  ES2023-vs-V8 divergence (T19 triage; the conformance test pins both).

- **`node:vm` QuickJS engine — descriptor fidelity + frozen + prototype/has
  coherence (T12, ADR-0142).** The OUT object wrapper now reports the GUEST
  object's REAL descriptors and a coherent prototype/`has` view, and writes
  host→guest mutations through where Node allows (parity `vm/quickjs-descriptors`,
  diffed byte-for-byte against real Node). `getOwnPropertyDescriptor` reconstructs
  the real writable/enumerable/configurable flags (or marshalled get/set for an
  accessor) via an UNREACHABLE guest reflect closure (no `ctx.getOwnPropertyDescriptor`
  in the API — the no-forgery discipline, like the id registry). A frozen guest
  object → `Object.isFrozen(wrapper)` TRUE, sealed → `isSealed` TRUE, writes rejected
  (loose no-op / strict TypeError); Proxy invariants are satisfied by mirroring a
  non-configurable prop as a matching non-config own prop on the target and sealing
  the target non-extensible (with an aligned proto) when the guest is non-extensible,
  while the empty target otherwise stays extensible. `getPrototypeOf` now returns the
  WRAPPED GUEST prototype (cross-realm chain of guest-wrappers terminating at the
  guest Object.prototype whose proto is null) and `has` does a guest-side `key in
  guest` over that chain — so `'toString' in obj` is TRUE and `obj.toString()` works
  while `obj instanceof Object` / `obj.constructor === Object` /
  `Object.getPrototypeOf(obj) === host Object.prototype` stay FALSE (T6 carry-over:
  the prior null-proto + own-keys-only `has` was self-contradictory). `set`/
  `deleteProperty`/`defineProperty`/`preventExtensions` WRITE THROUGH to the guest
  (host mutating a returned guest object writes to the guest; the guest sees it
  live), replacing the prior loud T9 boundaries. The OUT function wrapper now
  marshals the `this` receiver, so a returned guest METHOD called as `obj.method()`
  / `fn.call(obj)` runs with the right guest `this` (needed for proto-chain methods
  like `obj.hasOwnProperty('x')`). New retained handle: the reflect closure
  (infra-tracked, disposed at teardown — GC test green under `--expose-gc`).
- **`node:vm` QuickJS engine — cross-realm Error marshalling + direct-eval
  isolation (T11, ADR-0142).** A guest throw now crosses the membrane as a host
  THROWABLE matching Node's cross-realm shape (parity `vm/quickjs-errors`):
  `instanceof Error`/`TypeError` FALSE but `.constructor.name`/`.name`/`.message`/
  `.stack`/`toString()` faithful, and the value is genuinely catchable/rethrowable.
  OUT builds a REAL host Error backing (the `.stack` slot) with the guest's own
  `name`/`message`/`stack` under a per-ctor-name flat null-based proto carrying the
  host `Error.prototype` methods + a synthetic `constructor` (right `.name`) — same
  technique as the exotic mirrors, identity-cached + GC-tracked. The engine inspects
  the `{error}` handle directly (NOT `unwrapResult`, which threw the wrong shape and
  disposed the handle), marshals, disposes once, then throws. A non-Error throw
  (`throw 42`) marshals as the raw primitive. IN: a host fn that throws raises the
  error INTO the guest as a real guest exception of the matching ctor (so guest
  `try/catch` sees the right `e.constructor.name`/`e.message`). **Direct `eval`**
  inside the guest stays in the guest realm (parity `vm/quickjs-direct-eval`,
  `typeof globalThis.leaked === 'undefined'`) — falsifies the ADR-0138 premise that
  direct eval leaks to the host (T20 supersedes ADR-0138 with ADR-0142).
- **`node:vm` QuickJS engine — exotic mirroring (Date/RegExp/TypedArray) + fn
  name/length + symbols (T10, ADR-0142).** Exotics now cross the membrane both ways
  matching Node's cross-realm behavior (parity `vm/quickjs-exotic`): `instanceof
  <ctor>` FALSE but correct brand (`Object.prototype.toString`), working methods
  (`getTime`/`toISOString`/`test`/`source`/`flags`), and faithful data
  (indexing/`.length`/`Array.from`/`ArrayBuffer.isView`/JSON). OUT mirrors back the
  guest exotic with a REAL host Date/RegExp/TypedArray (the internal slot carries
  the brand + methods) under a per-kind null-based FLAT proto carrying the
  prototype-CHAIN methods (TypedArrays need the chain — brand + `Symbol.iterator`
  live on `%TypedArray%.prototype`); IN builds a REAL guest exotic (via cached
  factory fns — the API has no `callConstructor`) then rebrands it with a guest-side
  flat proto (the mirror of the OUT technique). Both directions are identity-cached
  and round-trip to the same reference. **Symbols** marshal both ways (parity
  `vm/quickjs-symbols`): well-known (`Symbol.iterator`) + registry (`Symbol.for`)
  symbols are SHARED across realms (`===`); unique symbols are cross-realm (fresh,
  same `.description`, identity-cached). Symbol-keyed own props are surfaced by the
  object wrapper (`Object.getOwnPropertySymbols` + `obj[sym]` + well-known iteration
  via `[...obj]`). **Function fidelity**: a returned guest fn now reports the GUEST
  fn's `name`/`length` (parity `vm/quickjs-fn-name-length`). Residual: an OUT exotic
  mirror's `.constructor` is `undefined` (Node returns the guest ctor; faithfully
  mirroring it would pin a wrapper-backed handle for the context's life, defeating
  GC-driven teardown). The since-implemented symbol loud boundary is removed; the
  leak-safe-construction regression now triggers via a throwing element getter.
- **`node:vm` QuickJS engine — bidirectional callable membrane + handle lifetime
  (T9, ADR-0142).** Host functions seeded into a context are now callable from
  guest code: `marshalHostToGuest` of a host fn builds a `ctx.newFunction` whose
  impl marshals the guest arg handles OUT (`wrapGuestToHost` — a guest array arg
  is seen in the host with the guest prototype, so `x instanceof hostArray` is
  FALSE, #16), calls the host fn, and marshals the host result back IN. Variadic
  host fns work (`log(...a)`). Identity is symmetric: the same host fn → the same
  guest fn (and round-trips back to the host fn via the registry id); the same
  guest fn → the same host wrapper. A GUEST callback passed to a host fn is HELD
  by the host and callable AFTER the synchronous run (`keep(cb); stored()`): the
  outbound function wrapper DUPS+RETAINS the guest handle, and the QuickJSContext
  is never torn down by a normal run (Node has no vm-context teardown), so a later
  `callFunction` lands on a live handle.
- **`node:vm` QuickJS engine — handle lifetime via FinalizationRegistry +
  refcount (T9).** A new `ContextLifetime` controller bounds handle growth and
  makes teardown abort-safe (QUICKJS_API.md: `ctx.dispose()` ABORTS if any guest
  handle is alive). Every cross-realm WRAPPER (object/array/function Proxy) backs
  a retained guest handle registered in a FinalizationRegistry — GC'ing the
  wrapper disposes its handle and evicts the identity-cache entry, so growth is
  BOUNDED. The wrapper identity cache now holds WeakRefs (a strong Map would pin
  every wrapper and defeat finalization). Infrastructure handles (the id-registry
  closure, inbound seeds, inbound host-fn handles) live for the context's life and
  are disposed only at teardown. The QuickJSContext is disposed ONLY when it is
  pending-dispose AND no wrapper-backed handle is live (a refcount, NOT
  finalizer ordering — FinalizationRegistry gives no ordering guarantee), so
  `ctx.dispose()` never sees a live handle. Normal runs never dispose the context;
  the `ContextObject` is registered in a FinalizationRegistry that marks the
  controller pending on GC, and `disposeContext` likewise marks pending (deferring
  the real `ctx.dispose()` until wrappers are GC'd) instead of an eager
  dispose-while-alive abort.

- **`node:vm` QuickJS engine — guest→host write-back / reconciliation (T8,
  ADR-0142, Option A).** Guest writes are now reconciled to the host
  contextObject. vm runs are SYNCHRONOUS (the host can't observe the sandbox
  mid-run), so a post-run sweep + per-run reseed is observationally equivalent to
  a live contextObject for sync code — chosen over a live inbound Proxy (Option B:
  a retained host trap fn per seeded object, disposal grief deferred to T9). The
  engine brackets every run with `membrane.reseedContext` (host→guest BEFORE —
  picks up between-run host mutations; host objects reuse the cached seed but its
  props are REFRESHED from current host state) and `membrane.sweepContext`
  (guest→host AFTER). The sweep walks the guest global's OWN ENUMERABLE keys
  (`Object.keys(global)` — the 61 intrinsics are non-enumerable, so this is
  exactly seeded keys + guest `var`/bare-assignment globals) and, per key, either
  RECURSES into a still-host-origin seed (deep write-back into the SAME host
  object: `shared.count = 42`, `module.exports = {…}`) or writes the
  marshalled-out value (new global `newGlobal = 99`; reassigned global). The OUT
  identity cache makes a swept-back slot the SAME wrapper as a value the run also
  returned, so `this.shared = {tag:1}; this.shared` gives `ret === sb.shared`
  (#21); a written guest object read from the host is membrane-wrapped, so
  `sb.module.exports instanceof Object` is FALSE (cross-realm), matching Node.
  An OUT wrapper round-tripping back IN (a value a prior run returned, stored by
  the host, seen by a later run) now recovers its ORIGINAL guest handle via a new
  `#outWrapperGuest` reverse map (object/array/function) instead of being copied
  in and then rejected on the next sweep's write-through. Sweep-after +
  reseed-before keeps host & guest consistent (the host already reflects prior
  guest writes by the next reseed, so reseed-from-host never clobbers them).
  Parity: `cases/vm/quickjs-writeback.case.ts` (nested write #18, identity #21,
  new global), `cases/vm/quickjs-shared-mutation.case.ts` (Node-captured: deep
  mutation of a pre-existing shared host object visible to host with same ref;
  between-run host mutation visible to the next run). Documented residual (not in
  the 27 probes): structurally REMOVING a key from a *host object* (not the
  top-level context) between runs is not reflected (overwrite/add only); a guest
  CALLBACK that mutates the sandbox AFTER the sync run is seen only at the NEXT
  reconciliation (or never) — both flagged for T9. Disposal unchanged: sweep/
  reseed use only transient handles (Scope / explicit dispose); no `ctx.dispose`
  on the run path; retained wrapper/seed handles still leak until T9.

### Fixed

- **`node:vm` QuickJS membrane — leak-safe wrapper construction (T9 review,
  ADR-0142).** `#wrapArray` DUP'd the guest handle, then EAGERLY marshalled every
  element into the host target, and only THEN tracked the wrapper. A guest array
  holding a value that throws mid-marshal (e.g. a `Symbol` → the loud T10
  boundary) left the dup'd handle UNTRACKED: the lifetime refcount stayed 0, so a
  later `markPending`/`ctx.dispose()` (ContextObject GC) ran with that handle
  still alive → WASM `Aborted(list_empty(&rt->gc_obj_list))`, killing the whole
  runtime. Confirmed for `[Symbol('x')]` and nested `[[Symbol('x')]]`. Now all
  three wrappers (array/object/function) route their dup+track through the shared
  `#retainForWrapper` (was dead code), and `#wrapArray` tracks the wrapper BEFORE
  the throwable element loop and releases it (disposing the handle) if marshalling
  throws — so a throw never leaves an untracked live handle and disposal is clean.
  Regression: `quickjs-lifetime.test.ts` (throwing OUT-marshal of `[Symbol]` /
  `[[Symbol]]` → no leaked handle, `markPending` disposes without abort).
- **`node:vm` QuickJS engine — sweep on throw (T8 review, ADR-0142).** A run that
  THREW skipped the write-back sweep (it sat after `unwrapResult`, which throws on
  a guest error), so pre-throw host writes were lost — and the next run's
  reseed-from-host then clobbered any deep pre-throw mutation entirely. But Node's
  contextObject is LIVE: writes made BEFORE a throw ARE observable to the host
  (verified probe — `this.a=1; throw` → `sb.a===1`; `o.n=99; throw` →
  `sb.o.n===99`). `sweepContext` now runs in a `finally` so it reconciles on BOTH
  the success and throw paths; the QuickJSContext stays alive after `unwrapResult`
  throws (only the error handle is freed — no double-dispose) and the sweep walks
  `ctx.global` needing no completion handle. The raw guest error still propagates
  (faithful error marshalling is T11). Removed the false comment claiming "Node
  likewise does not reconcile a sandbox after a thrown run" / "no observable host
  write on throw" (it documented a real divergence as conformance) and its
  unfinished fragment. Parity: `cases/vm/quickjs-throw-writeback.case.ts`
  (Node-captured: pre-throw new globals + deep mutation visible to host, next run
  reads the reconciled state).
- **`node:vm` QuickJS membrane — unforgeable host-origin tracking (T7 review,
  ADR-0142).** The host→guest round-trip identity (#14) previously tagged each
  inbound seed with a guest-visible, guest-WRITABLE marker symbol
  (`Symbol.for('rifty.vm.hostOrigin')`) carrying a predictable sequential id, and
  the OUT path read that property to recover the original host object. Guest code
  could FORGE the marker (`f[Symbol.for('rifty.vm.hostOrigin')] = 0`) and
  exfiltrate a real host reference it was never given — breaking cross-realm
  isolation (Node never lets guest code obtain such a reference). The marker was
  also an observable guest own-symbol (`Object.getOwnPropertySymbols(hostObj)`
  length 1 vs Node's 0), contradicting the prior "(verified)" no-leak claim.
  FIX: removed the guest tag entirely; host-origin is now keyed on the seed's id
  from an UNREACHABLE-closure registry — `#idOf` evals `(() => { const m = new
  WeakMap(); let n = 0; return o => {…}; })()` and RETAINS the returned function
  handle HOST-SIDE only (never `setProp`-ed onto the guest global), so guest code
  has no reference to the WeakMap and cannot pre-seed/read ids. `wrapGuestToHost`
  computes `idOf(handle)` and returns the original iff it is a known host-origin
  id — NO guest property read. The outbound wrapper identity cache shares the same
  hardened registry (previously the reachable `globalThis[Symbol.for(
  'rifty.vm.idOf')]` form — also forgery-capable — now the closure form). Parity:
  `cases/vm/quickjs-sandbox-isolation.case.ts` (forgery `false`, own-symbols `0`,
  legit round-trip `true`).

### Added

- **`fs.*` sync-RPC surface for supervised child processes (P6a of ADR-0150).**
  `installRuntimeJsFsHandlers(dispatcher, getVfs)` serves a child's `node:fs` +
  module-loader reads/writes against the parent's `syncMirror()` over the SAB ring
  (binary read replies, base64 write requests, both chunked under the 1 MiB ring);
  `SyncRpcFsSync` is the child-side `FsSync` over `KernelSyncApi.call`;
  `installRemoteSyncFs(call)` swaps the child realm's GLOBAL mirror so BOTH the
  loader and `node:fs` route to the owner store (owner = SSoT). `installConsole` /
  `ConsoleSink` are now public (a spawned CLI wires its `console.*` to its stdout).

- **Run a VFS Node entry through the module loader (ADR-0137).** New
  `runNodeEntry` primitive (`builtins/node-entry.ts`) + `node-entry-url.ts` host
  seam (`setNodeEntryWorkerUrl`/`getNodeEntryWorkerUrl`, mirrors the kernel's
  `setKernelWorkerUrl`). The playground node-entry bootstrap calls it to run a
  shell-resolved `.bin` launcher (resolve target → import via loader) or a plain
  `node <script>`. `child_process.spawn('node', [script])` (worker path) now
  spawns this bootstrap instead of a raw `kind:'source'` worker, so a spawned
  script with a shebang / relative import runs via the loader.
- **`node:vm` QuickJS engine — host→guest membrane: live contextObject read path
  (T7, ADR-0142).** `Membrane.seedContext` seeds each own enumerable key of the
  live contextObject INTO the guest realm before any run; the engine seeds at
  context creation. Primitives by value; host objects/arrays via the extended
  `marshalHostToGuest` as a host-origin guest SNAPSHOT — a real guest
  array/object (recursively marshalled) with its prototype severed
  (`Object.setPrototypeOf(v,null)`), the MIRROR of the outbound null-proto trick:
  `Array.isArray` TRUE (real guest brand) but `instanceof Array`/`Object` FALSE
  (cross-realm). Round-trip identity (#14): host origin is tracked by the seed's
  UNFORGEABLE registry id → host `Map<id, originalHostObject>` (see the Fixed
  entry above — NO guest-visible marker); `wrapGuestToHost` returns the ORIGINAL
  host reference for a known host-origin id. Inbound
  identity cached host-side (`WeakMap<hostObject, guestSeed>`). SNAPSHOT only —
  guest writes to a shared object aren't seen by the host yet; host-side re-sync +
  guest→host write-back is T8, guest-callable host functions T9, inbound symbols
  T10 (loud boundaries). Disposal: inbound seeds RETAINED (back live globals),
  per-call dups disposed; never `ctx.dispose()` on the run path. Parity:
  `cases/vm/quickjs-sandbox-read.case.ts`.
- **`node:vm` QuickJS engine — guest→host membrane for OBJECT/ARRAY/FUNCTION
  completion values + identity cache (T6, ADR-0142).** New `Membrane`
  (`vm/membrane.ts`), one per `QuickJSContext`. Cross-realm-faithful host
  wrappers (Node oracle): ARRAY → `Proxy(realHostArray,{getPrototypeOf:()=>null})`
  (`Array.isArray` TRUE, `instanceof Array` FALSE, recursively-marshalled
  elements); OBJECT → `Proxy({}, traps)` routing reads (incl. `constructor`) to
  the guest handle so `constructor !== host Object` and `instanceof Object` FALSE,
  `Object.keys`/JSON via ownKeys+getOwnPropertyDescriptor; FUNCTION → callable
  `Proxy(thunk,{getPrototypeOf:()=>null})` (`typeof 'function'`, callable,
  `instanceof Function` FALSE) marshalling primitive args in / result out.
  Identity cache: an UNREACHABLE-closure guest `WeakMap` id registry (retained
  host-side, never exposed on the guest global — see the Fixed entry) → host
  `Map<id, wrapper>`, so the same guest object yields the same host wrapper
  (handles aren't stable keys). Disposal bounded for T6: per-run completion
  handles disposed; wrapper-retained guest handles persist (wrapper lifetime is
  T9). Engine now routes object/function/array through the membrane instead of
  throwing. Parity: `cases/vm/quickjs-returns-objects.case.ts`,
  `cases/vm/quickjs-returns-identity.case.ts`.
- **`node:vm` QuickJS engine — primitive completion values (T5, ADR-0142).**
  New `quickjsEngine: VmEngine` (`vm/quickjs-engine.ts`): one persistent
  `QuickJSContext` per `vm.Context` (WeakMap, reused across runs for later
  cross-run persistence), `evalCode` + `unwrapResult`, marshalling guest
  completion values that are PRIMITIVES (number/string/boolean/bigint/null/
  undefined) back to the host; object/function throw a loud Task-6 boundary.
  Every per-run handle is disposed (a leak aborts the WASM runtime); constants
  never are. `selectEngine()` now returns it when `__RIFTY_VM_ENGINE === 'quickjs'`
  (default stays `rewrite`). Parity: `cases/vm/quickjs-returns.case.ts`. The
  parity runner + vm conformance now preload via `ensureVmEngineReady()`.

### Changed

- **`node:vm` split behind a `VmEngine` interface (no behavior change).** `vm.ts`
  became a `vm/` module: `types.ts` (shared types + `VmEngine`), `rewrite-engine.ts`
  (the AST-rewrite sandbox, now `rewriteEngine: VmEngine`, Script memoisation moved
  to a per-`CompiledScript` WeakMap), `engine-config.ts` (selector — default stays
  `rewrite`; `__RIFTY_VM_ENGINE` override), `index.ts` (public dispatcher).
  `runInThisContext` stays host-realm. Prep for the QuickJS engine (ADR-0142 / T17).

### Fixed

- **Spawned-child `process` exposes Node identity fields (P6a of ADR-0150).** The
  kernel pre-entry `WorkerNodeProcessShim` lacked `versions`/`version`/`platform`/
  `arch`/`argv0`/`execPath`/`title` (only the owner-grade `RiftyProcess` had them),
  so a real CLI in a spawned child threw on `process.versions.*` (yargs →
  `isElectronApp`). A shared frozen `NODE_PROCESS_IDENTITY` now feeds both — owner
  and child report identically.

- **`createReadStream` uses the async `Vfs.openReadable` surface first again
  (ADR-0020 phase 2).** The temporary P5 sync-content-cache preference is removed:
  Memory/shared VFS streams now flow through `openReadable`, and the owner
  `SyncMirrorVfs` adapter supplies a real chunked `ReadableStream` over the
  sync mirror bytes instead of throwing. OPFS stream safety is fixed in
  `@riftydev/vfs` by replacing the stalling `File.stream()` path with chunked
  `File.slice(...).arrayBuffer()` pulls.

- **Fork-IPC shim buffers messages until the first listener (ADR-0045 / ADR-0146
  P2).** `WorkerNodeProcessShim` emitted `'message'` on every inbound
  `ipc:message` frame even with zero `'message'` listeners → the frame dropped. A
  worker that registers `process.on('message')` only after a slow async module
  load (the shell owner's heavy bootstrap) lost every frame the parent posted in
  the gap — `pty:open` never reached the owner, so the thin terminal hung with no
  output (`vfs-write` masked it with a BroadcastChannel fallback; the pty channel
  had none). Now buffered and flushed in order on the first listener, mirroring
  the stdin reader in the same module. Regression: `install-process-ipc.test.ts`.

- **Module loader strips a leading `#!` shebang (CJS + ESM) — Node parity.**
  Node's `Module._compile` / ESM loader drop a leading shebang line before
  compiling; rifty's loader did not (CJS `new Function` threw; the ESM executor
  re-wrapped it). Now stripped at source read (`module-loader/resolver.ts`),
  keeping line numbers. Required to run `node_modules/.bin` launcher shims and
  any shebang'd entry. Parity: `cases/modules/{cjs,esm}-shebang.case.ts`.

- **REPL/console inspector rendered bigints without the trailing `n`.** `inspect`
  printed `3n` as `3` (and `{ a: 3n }` as `{ a: 3 }`) — `String(3n)` drops the
  suffix Node keeps at every depth. Surfaced by the QuickJS vm parity case
  (`vm.runInNewContext('1n + 2n')` → `3n`). Regression: `repl/inspect.test.ts`.
- **PR #30 review fixes (`node:vm` statement-position var + intrinsic shadow).**
  Two divergences inside the just-closed `vm-sandbox-residual-gaps` work:
  - A top-level `var` used as the UNBRACED body of `if`/`else`/`do-while` threw
    `SyntaxError` — the completion-neutralising `{ let T = (…); }` block closed at
    the last declarator's end, leaving the source `;` dangling (`if(false) var x=1;
    else 2;` → block + stray `;` orphaned the `else`). The wrapper now closes at the
    declaration's end, consuming the `;`.
  - A declaration-only `var <writable-intrinsic>;` (e.g. `var Map; new Map()`)
    shadowed the real intrinsic to `undefined` — the registered no-init name
    resolved ahead of `INTRINSIC_GLOBALS` in the context proxy `get`. Intrinsics now
    resolve before a bare (own-property-less) var binding; an assigned `var Map = …`
    still shadows via its own property. Parity:
    `cases/vm/statement-position-var.case.ts`.
- **PR #21 review fixes (fs/os/fs-RPC contract).**
  - `fs.readSync`/`writeSync`/`read`/`write` treat position `-1` as "current
    position" like Node (was: `RangeError`). Parity:
    `cases/fs/fd-read-write-position.case.ts`.
  - `fs.read(fd, cb)` / `fs.read(fd, options, cb)` short forms work (buffer
    defaults to a fresh 16 KiB allocation); previously the callback was never
    invoked.
  - `readFile`/`writeFile`/`appendFile` honor the `flag` option through the
    open-flags engine (`wx` → `EEXIST`, `a` appends, `a+` creates, …) — was
    silently ignored. Parity: `cases/fs/open-flags-copyfile-excl.case.ts`.
  - fs errors now carry Node-shaped `errno` (negative Linux ABI) and message
    prose (`ENOENT: no such file or directory, open '/x'`).
  - `os.constants.priority` filled with Node's static PRIORITY_* values (was a
    silent `{}` stub pinned green by a conformance test); full signal/errno
    tables now pinned by `tests/conformance/builtins/os.test.ts`, and the
    parity case prints the darwin/linux-invariant subset BY VALUE.
  - `RuntimeFs` calls against a torn-down runtime reject with typed
    `WorkerTerminated`/`RUNTIME_NOT_RUNNING` (was a bare `Error`); worker-side
    FS RPC rejects non-utf8 encodings and unknown ops loudly instead of
    decoding-as-utf8 / falling through to a write. TSDoc documents root-anchored
    path resolution. Real-Worker round-trip covered by
    `tests/e2e/sandbox-fs-rpc.spec.ts`.

### Added

- **QuickJS vm-engine loader (`builtins/vm/quickjs-loader.ts`).**
  `getQuickjsWasmUrl()` resolves the QuickJS `.wasm` URL via tiered env-config
  (bootstrap global → Vite build env → Node env → `/quickjs.wasm`) per D-004 /
  ADR-0005 — never hardcoded elsewhere. `ensureVmEngineReady()` is a one-time
  idempotent async preload of the release-sync WASM module returning a single
  shared `QuickJSWASMModule`; `getQuickJsModuleSync()` then serves it
  synchronously to the membrane (throws with guidance if not yet preloaded),
  and `isVmEngineReady()` reports readiness. Mirrors the WASI worker-boot
  preload pattern.
- **`./builtins/console` subpath export** — the Node-compatible `Console`
  class over writable streams, so embedders (playground node-server bootstrap)
  can route a guest program's console into kernel stdio.
- **Minimal `node:vm` subset.** `require('node:vm')` now exposes
  `Script`, `createContext`, `isContext`, `runInThisContext`,
  `runInContext`, `runInNewContext`, and `compileFunction` for config loaders
  and template engines. Contexts are mutable property bags, not security
  isolation; unsupported execution controls such as `timeout` and
  `contextExtensions` throw `NotImplementedError`.
- **Worker-backed public FS RPC (ADR-0131).** `RuntimeController.fs` now exposes
  awaited `readFile()` / `writeFile()` backed by runtime Worker messages. Writes
  create parent dirs, invalidate the module loader, and await active VFS
  `flush?.()` before resolving. Legacy `runtime.writeFile(path, content): void`
  remains source-compatible.
- **M11 fd-based `node:fs`/`node:os` surface.** Runtime-local fd table adds
  `open`/`close`/`read`/`write`/`fstat`/`ftruncate` plus `truncate`,
  `mkdtemp`, `opendir`/`Dir`, `COPYFILE_EXCL`, supported `O_*` constants, and
  scoped `os.constants.signals`/positive `errno` ABI integers. `ftruncate`
  preserves fd position, `Dir.read`/`Dir.close` support callback overloads and
  closed-dir errors, unsupported numeric open flag bits throw `EINVAL`, and
  `O_SYNC`/`O_DSYNC`/reflink constants stay absent.

### Fixed

- **Bundled resolver now explicitly registers runtime-js builtins before
  `node:` detection.** Production builds could tree-shake the
  `builtins/index.ts` registration side effects and then fail real Vite imports
  with `Built-in 'node:path' is not implemented`. `createResolver()` now calls
  the idempotent registration guard before builtin resolution. Guard:
  `src/module-loader/resolver-bundling.test.ts`.
- **`node:vm` context assignment rewrites now cover nested blocks and loops.**
  Missing global writes such as `if (...) y = 1` or `for (...) y = 2` inside
  `runInNewContext()` now land on the context object like Node instead of
  leaking to the host `globalThis`.
- **`node:vm` context rewrites preserve shadowed globals and top-level `var`
  hoisting.** Missing-global assignments now target a generated helper binding,
  so user parameters named `globalThis` cannot steal sandbox writes; top-level
  `var` names are visible as `undefined` during evaluation before their
  initializers run.
- **Transformed TypeScript stack frames remap to source lines (ADR-0136).** The
  ESM loader now extracts inline source maps from `transformSource` output and
  installs a scoped stack renderer while guest modules execute, so caught
  `err.stack` reads inside `.ts` guests report the original TypeScript line.
  The public `TransformSourceHook` remains `Promise<string>`.
- **`node:vm` write-leak class closed for sibling syntax forms.** Top-level
  `var` initializers are now AST-walked instead of spliced raw (a function body
  inside `var a = function () { x = 1 }` wrote to the host realm), and
  compound/logical assignment (`+=`, `??=`), `++`/`--`, destructuring
  assignment targets, bare/`var` for-in/of loop targets, and `delete` on
  unbound names all land on the context. `switch` cases get a lexical scope;
  `for (var k in o)` no longer rewrites into a SyntaxError. Reads of unbound
  names stay loud (`ReferenceError`) / fall through to host globals by design.
  The remaining `eval` divergence is recorded in ADR-0138 (superseded by ADR-0142).
- **`node:vm` residual sandbox gaps closed.** Top-level function declarations are
  hoisted (callable before their text, incl. mutual recursion; a later `f = …`
  reassignment is visible), declaration statements keep Node's EMPTY completion
  value (`9; var z;` ⇒ 9, `var q = 5;` ⇒ undefined, `5; function f(){}` ⇒ 5),
  statement-position destructuring `var` patterns (`var { a, b = 2, ...r } = o`,
  `for (var { a } of xs)`) land on the context instead of throwing
  `NotImplementedError('vm.context.var-pattern')`, and a declared `var` stays a
  known global of the context — readable as `undefined` after the run and in later
  runs — instead of leaking to the host realm afterwards. `vm.Script` memoises its
  AST rewrite (parse + rewrite once, reuse across runs). Direct `eval(...)` remains
  a permanent divergence (ADR-0138, superseded by ADR-0142). Closes the
  `runtime-js/vm-sandbox-residual-gaps` backlog item; parity
  `cases/vm/sandbox-residual-gaps.case.ts`.
- **Source-map decoding: 1-field VLQ segments advance the running generated
  column** (esbuild emits them for unmapped text; columns after them were
  shifted left), and a malformed inline source map now degrades to unmapped
  stacks instead of failing the module load.
- **`path.resolve` anchors relative paths at `process.cwd()`** (Node parity;
  fs already did) — `express.static('public')` under a non-root cwd resolved
  to `/public` and 404'd.
- **`require('fs')` exposes `createReadStream`/`createWriteStream` and the
  `ReadStream`/`WriteStream` classes.** They were named ESM exports missing
  from the default module object; serve-static/send broke, and `destroy()`'s
  `stream instanceof fs.ReadStream` probe threw.

- **`process.stdin.setEncoding('utf8')` now decodes multibyte characters across
  chunk boundaries.** The REPL host bridge and kernel `install-process` shim now
  keep a streaming `TextDecoder` per stdin stream instead of decoding each
  `Uint8Array` independently, so split UTF-8 sequences (for example `€` as
  `[e2 82]` + `[ac]`) match Node's `StringDecoder` behavior. This covers the
  ADR-0122 `RuntimeController.writeStdin()` / `HostMessage { type: 'stdin' }`
  surface and is pinned by unit tests plus a `process.stdin` parity case.

### Performance

- **execSync SAB handler installs on first `child_process` require, not at startup (#26 PART B).** `builtins/child_process.ts` ran `installRuntimeJsExecSyncHandler(getKernelDispatcher(), …)` at module-top, so the barrel import (`builtins/index.ts` imports the module statically) did `getKernelDispatcher()` + a `register` + a `makeRecursiveRunner()` alloc at cold start even for programs that never spawn. The install moves into an exported `ensureExecSyncHandlerInstalled()` invoked by the `registerBuiltin('child_process', …)` factory, so it runs on the FIRST `require('node:child_process')` (loadBuiltin caches the factory result → runs once; re-register reinstalls on the current dispatcher, `register` being idempotent — same "install when the module comes up" timing). Observable-identical: execSync (`child_process-sync.ts`, the only dispatch site) is reachable ONLY via this module's exports, so first-require install always precedes any reachable `execSync()`; the Wave-4 v2 binary-frame path is byte-unchanged. The hot core (path/util/events/buffer/process/stream/fs/os/crypto) stays eager-static. PART A (cold lazy-load / names-only split deferring module-body eval for cold builtins) is NOT pursued — infeasible under the synchronous `require()`/`loadBuiltin` contract (a sync require must return synchronously; an `import()`-based lazy builtin would make it async). Behavior-preserving / contract-stable (ADR-0081 rule 5; CHANGELOG-only, no ADR). Guard: `builtins/child_process-lazy-handler.test.ts` (hot-core require installs nothing; first child_process require installs + the live handler services dispatch) + the existing `ipc/handlers.test.ts` wire contract + `binary-stdout-exec` parity (require-then-execSync, byte-exact). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#26).
- **`setImmediate` queue is a `Map` with an O(1) clear + drain-one-per-macrotask (NOT a tail-snapshot batch) (#28, ADR-0085).** `builtins/timers.ts` backed the immediate queue with an array; `clearImmediate` was O(n) `findIndex`+`splice` and the drain `.shift()`'d one item per `MessageChannel` message. Now `const immediates = new Map<id,{fn,args}>()` (ids are monotonic positive integers, so Map iterates ascending = FIFO) — `clearImmediate` is O(1) `Map.delete`. The `port1.onmessage` drain runs EXACTLY ONE immediate (the lowest id) per message; one message per `setImmediate` call ⇒ one immediate per macrotask ⇒ the microtask queue drains BETWEEN consecutive immediates (Node check-phase parity — a callback's post-`await` continuation runs before the next immediate). A nested `setImmediate` posts its own (higher-id) message serviced in the NEXT check phase (no snapshot needed, no stranding). NB: an earlier greedy tail-snapshot batch (run all ids `< nextImmediateId` in one drain) was REVERTED — it skipped the inter-immediate microtask checkpoint (BLOCKER #2), and the snapshot was vestigial since one-message-per-call already separates phases. Scheduling is byte-equivalent to the old array+single-`shift`; MessageChannel (not `setTimeout(0)`) keeps `setImmediate` ahead of a `setTimeout(0)` task. `./builtins/timers` is a PUBLIC cross-package subpath export (ADR-0018), so the drain order is a contract → recorded in **ADR-0085** (rule 1, not CHANGELOG-only). Guard: parity `cases/timers/immediate-nested.case.ts` (`A,A-end,C,B-nested`) + `cases/timers/immediate-microtask-checkpoint.case.ts` (microtask checkpoint between consecutive immediates: `A-start | A-after-await | B-reads:set-by-A | C`) — both driven via `require('node:timers')` so the rifty side exercises the polyfill not a host global — plus conformance `event-loop.test.ts` (drain-one microtask checkpoint, nested-defers, clearImmediate mid-drain, large-burst FIFO with a mid-burst clear). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#28) + ADR-0085.
- **`process.nextTick` drain uses a head cursor instead of `shift()`-per-item (#27).** `drainNextTicks()` looped `nextTickQueue.shift()` until empty — O(n^2) for a burst of n ticks (each `shift` re-indexes the whole array). It now advances a module-level `drainHead` cursor across the array (`nextTickQueue[drainHead++]`) and, only after a full drain, resets `nextTickQueue.length = 0` + `drainHead = 0` — O(n). The loop still re-reads `.length` every iteration so a `nextTick` enqueued mid-drain (nextTick-from-within-nextTick) is processed (no snapshot), and the post-drain reset keeps `ensureDrainScheduled`'s `length === 1` re-arm intact. The `patchPromiseForNextTick` then-wrapper is untouched — `drainNextTicks()` is still called unconditionally before every then-callback (no empty-queue elision), so nextTick-before-then ordering is preserved. Behavior-preserving / contract-stable (ADR-0081 rule 5; CHANGELOG-only). Guard: `tests/conformance/builtins/event-loop.test.ts` (FIFO burst, mid-drain enqueue, then-wrapper drains-before-callback, re-arm after full drain). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#27).
- **Module resolver collapses 7 `existsSync`+`statSync` double-probes to one `statSyncOrNull` (ADR-0083, #11).** The resolver probed the VFS with the `existsSync(x) && statSync(x)` idiom at 7 sites (`fromFile` dir check, `resolveAsFileOrDir` base, the `${base}${ext}` loop, the `INDEX_FILES` loop, the directory case, `resolveInsidePackage`'s `package.json`, `findPackageScope`'s `package.json`) — two syscalls + two normalizes each. Each now makes a single `vfs.statSyncOrNull(x)?.isFile`/`?.isDirectory` call (ADR-0083, new non-throwing stat on the shared `FsSync`). Resolution outcomes are byte-identical (the null-on-miss replicates the `&&` short-circuit), so no Node-parity shift — a pure constant-factor refactor on the resolution hot path. The two bare `existsSync` sites with no paired `statSync` are left untouched. Guard: `tests/conformance/modules/resolver.test.ts` + module parity cases green. Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` + ADR-0083.
- **`fs.resolvePath` drops the redundant outer `normalizePath` on the relative branch (#6).** The relative branch was `normalizePath(joinPath(getProcessCwd(), str))`, but `joinPath` already normalizes internally and `getProcessCwd()` is always an absolute normalized path, so its result is already absolute+normalized — the outer pass was a no-op per fs syscall. Now `joinPath(getProcessCwd(), str)`. `joinPath` itself is NOT touched (no guard added inside it — 45+ callers). Verified zero diffs across cwd × relative-input matrices; behavior-preserving / contract-stable (ADR-0081 rule 5; CHANGELOG-only). Guard: node-parity `cases/fs/relative-cwd-resolution.case.ts` (relative + dot-segment resolution) + a non-root-cwd unit in `fs.test.ts`. Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#6).
- **fs text reads decode zero-copy via `@riftydev/io`'s `bytesToString` (ADR-0082).** `fs.decodeResult`'s encoded branch was `Buffer.from(bytes).toString(enc)` — a throwaway full-buffer copy per encoded `readFileSync`/`readFile` (sync + async both funnel here). Now `bytesToString(bytes, encoding)`, dropping the copy. The no-encoding branch is unchanged — still `Buffer.from(bytes)`, returning an owned, mutable Buffer (Node binary-read contract). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` + ADR-0082; parity `fs/read-encodings.case.ts` (empty / odd-len utf16le / latin1 high byte / hex) + `fs/readwrite.case.ts` green.
- **`readResolved` walks the package scope ONCE per module (#4).** `detectKind` re-ran `findPackageScope` (a second upward walk + read + `JSON.parse` of the scope `package.json`) for every `.js`/`.ts`/`.tsx`, on top of the walk `readResolved` already does for `packageRoot`. Now `readResolved` computes the scope once and passes `scope?.pkg.type` into `detectKind(filePath, scopeType)` (the `vfs` param dropped). `detectKind`'s `.json`/text/`.mjs`/`.cjs`/unknown early returns are byte-identical (they never read scope); the `.js`/`.ts`/`.tsx` ESM-vs-CJS classification uses the same scope value. Behavior-preserving / contract-stable (ADR-0081 rule 5). Guard: `tests/conformance/modules/resolver.test.ts` + module parity cases green. Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#4).
- **First-load no longer resolves each module twice (#14).** `import`/`loadById`/the ESM static-import preload + dynamic import resolved a module (full `readResolved`) then forwarded only `.id`, and `loadAsync(id)` re-resolved it (a second read + decode + scope walk). A new `loadAsyncResolved(resolved)` carries the already-resolved `ResolvedModule`; `loadAsync(id)` stays for `node:` ids and direct id callers (cjs/interop) and delegates through it. The registry `loaded`/`loading` short-circuit is replicated at the top of `loadAsyncResolved`, so dedup + cycle guards still fire; for an absolute id the `esm:true`/`esm:false` re-resolve paths are equivalent. Behavior-preserving / contract-stable (ADR-0081 rule 5). Guard: module/cycle conformance (`cjs-cycle`, `tla`) + resolver tests green. Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#14).
- **Loader resolution caches — `package.json` parses (#5, Q-2026-06-06-320), resolution memo (#15, Q-2026-06-06-321), ESM AST (#16, Q-2026-05-30-202).** Three id/input-keyed caches eliminate repeated CPU on the resolution + parse hot path: (a) a `Map<absPkgJsonPath, PackageJson>` in the resolver closure routes all 4 `package.json` parse sites (N sibling imports → 1 parse); (b) a memo keyed `esm\0fromDir\0specifier` around `resolveSpecifierToFile` skips the `node_modules` walk for a repeated specifier (`readResolved` still re-reads source fresh); (c) an id-keyed `Map<id, TransformResult>` memoizes the heaviest per-module step (acorn parse + AST walk), injected into `executeEsm` via an internal `EsmLoaderDeps.transformEsm?` hook. **Invalidation is the whole risk and is non-negotiable:** `loader.invalidate()` full-clears the resolver caches on BOTH the full and targeted-id arms (input-keyed, cannot prune by id); the resolution memo NEVER caches a not-found (guest `fs.writeFileSync`/npm-install create files without firing invalidate) nor the `PACKAGE_PATH_NOT_EXPORTED` throw; the AST cache drops in lockstep with `transformCache`/registry. Provisional cache keys/invalidation recorded in OPEN_QUESTIONS (Q-2026-06-06-320 / -321; #16 reuses Q-2026-05-30-202). Guard: `resolver-cache.test.ts` (edit→invalidate→fresh gate; full + targeted clear; not-found/not-exported never cached) + `loader-esm-ast-cache.test.ts` + parity `modules/pkg-type-module-js-classification.case.ts` + the `test:integration` real-install suite (the critical guard that npm-installed module loading still works). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#5/#15/#16).
### Added

- **ADR-0090:** `node:fs.renameSync`/`copyFileSync` now route to the native VFS
  primitives (`syncMirror().renameSync`/`copyFileSync`) and a new `cpSync` (+
  `promises.cp`) is exposed. `renameSync` is now **mtime-preserving** and
  atomic-where-possible — the prior read+write+rm path restamped mtime and copied
  subtrees. `promises.rename`/`copyFile` inherit the fix (they delegate to the
  sync fns). Parity cases `cases/fs/rename-mtime` + `cases/fs/cp-recursive` pin
  the Node-vs-rifty agreement.

### Fixed

- **`execSync` returns child stdout byte-exact (ADR-0084 #23).** The `'execSync'`
  handler (`ipc/handlers.ts`) returned `new TextDecoder().decode(result.stdout)` —
  a non-fatal decode that mangled any non-UTF-8 child byte to U+FFFD before the RPC
  framing (e.g. `[0xff,0xfe,0x00]`→`[ef bf bd ef bf bd 00]`), a real Node-parity bug
  (Node's `execSync` returns a Buffer byte-exact). It now returns `result.stdout`
  (`Uint8Array`) verbatim; the kernel carries it on a v2 binary frame, and
  `child_process-sync.ts` returns `Buffer.from(bytes)` with no re-encode (the
  declared `Uint8Array` return signature is unchanged). Two-peer atomic change with
  `@riftydev/kernel` (SyncRpc v2). Guard: byte-exact conformance
  (`tests/conformance/builtins/child_process.test.ts`, `Uint8Array.from([0xff,0xfe,0x00])`
  length 3 not 7) + the `binary-stdout-exec` hex parity case. Per ADR-0084.
- **OPFS persistence wired in the runtime Worker (ADR-0072).** `worker-entry.ts`
  now `await initBackend()` before building the module loader, so the Worker
  uses the OPFS backend (cross-origin-isolated realms) instead of always
  installing an in-memory VFS — files written via `fs.writeFileSync` now survive
  a page reload. The loader is built behind a `boot` promise (`await
  initBackend()`, falling back to memory if OPFS init throws); `{ type: 'ready' }`
  is posted only after it resolves. The `message` listener is attached
  synchronously and each `eval`/`load-fixture` awaits `boot`, so an eval the host
  posts before readiness (the REPL types without waiting for `[worker ready]`) is
  received and handled once wired, never dropped. `load-fixture` routes through
  the active `syncMirror()`;
  `handleEval` awaits `syncMirror().flush?.()` before posting the result so OPFS
  write-through is durable before the host resolves the eval (and before reload).
  Closes the A-004 OPFS round-trip e2e acceptance (`tests/e2e/m0-boot.spec.ts`).
- **`fs.statSync` honours `{ throwIfNoEntry: false }`** (Node v24 parity). A
  missing path now returns `undefined` instead of always throwing `ENOENT` when
  the option is `false`; overloaded so 1-arg callers keep the `Stats` return type.
  Real packages probe for files with this idiom — opencode's `Filesystem.stat`
  (`statSync(p, { throwIfNoEntry: false }) ?? undefined`) walled the LLM prompt
  path (shell-tool resolution `Filesystem.stat(shell)?.isFile()`) on the thrown
  ENOENT. Parity: `fs/stat-throw-if-no-entry.case.ts`.

### Added

- **Public subpaths `./ipc/exec-sync-handler` + `./builtins/child_process` for the COI execSync e2e harness.** A host realm that OWNS the kernel dispatcher (calls `spawnWorker`) must register the `'execSync'` handler on ITS dispatcher so kernel-spawned guests run `execSync` end-to-end — but the playground page never `require`s `child_process`, so the lazy first-require install (`builtins/child_process.ts`) never fires on the page realm. `./ipc/exec-sync-handler` re-exports `installRuntimeJsExecSyncHandler` (+ `ExecSyncPayload`/`ScriptResolver`/`InstallRuntimeJsExecSyncOptions`) so a host can wire it explicitly; `./builtins/child_process` exposes the real `node:child_process` surface (`execSync`/`spawn`/`exec`/`fork`) so a `kind:'url'` guest entry (no module loader) can call the genuine `execSync` client without re-implementing the SAB gate. Both surfaced via `tools/publishing/sync-publish-config.mjs` `addExports`. First consumer: `apps/playground/src/execsync-harness.ts` + `tests/e2e/execsync-sab.spec.ts` (the honest real-SAB execSync proof). New public cross-package surface → flagged for an ADR.

### Changed

- **CJS compile failures now name the module.** A syntactically-invalid CJS module
  previously threw a bare `SyntaxError` from `new Function` with no file context
  (only `at new Function (<anonymous>)`). `executeCjs` now wraps the parse failure
  in a directed `ModuleLoadError` naming the module (and a best-effort source
  snippet), mirroring the ESM path — which is how the opencode graph-load gate
  pinned a prose `.txt` asset being mis-executed as CJS.

### Fixed

- **A module that shadows the global `Object` broke the ESM export codegen.** The
  transformer emits its export/re-export machinery as inline
  `Object.defineProperty(__slots, …)` / `Object.keys(…)` calls in the module body.
  A module declaring a module-scoped `export const Object = …` (opencode's
  `config/permission.ts`) shadowed the global, so those bare `Object.*` calls
  resolved to the user's value and threw `Object.defineProperty is not a function`.
  The executor now binds the real global to a mangled name
  (`RUNTIME_OBJECT_BINDING`) at function scope — outside the user-body arrow, where
  the module's `const Object` cannot reach — and the codegen references that
  binding instead of bare `Object`. Regression:
  `tests/conformance/modules/global-shadowing.test.ts`.

- **A self-referential `export * as Self from "."` came back as an empty namespace.**
  `rebuildExports` allocated a fresh `record.exports` object on every call. A
  `export * as ns from SPEC` re-export captures the target's `exports` object
  identity at static-import preload time; for a SELF spec (`"."` resolving to the
  module itself — a common opencode idiom in `effect-drizzle-sqlite/index.ts`,
  `core/database.ts`, `migration.ts`) that capture happened before the module's
  first rebuild, so the captured reference stayed frozen as the initial empty
  object and the self-namespace lost every export (including names merged via a
  sibling `export * from "./driver"`). `rebuildExports` now mutates the namespace
  **in place** (stable identity, getters redefined, `Symbol.toStringTag` guarded),
  so the captured self-reference reflects all later exports — matching Node 24
  (`Self.Self === Self`, `Self` carries the module's full export set). Unblocks
  opencode's `EffectDrizzleSqlite.makeWithDefaults()`. Regression:
  `tests/conformance/modules/cycles-esm.test.ts` `describe('ESM self-referential
  namespace re-export')`.

- **Resolver checked a same-named directory before a file-with-extension sibling.**
  `resolveAsFileOrDir` resolved `X` as a directory (and returned early) before
  trying `X.js`/`X.ts`/…, inverting Node's `LOAD_AS_FILE`-before-`LOAD_AS_DIRECTORY`
  order. So `./migration` (opencode's `core/src/database/database.ts`) hit the
  sibling `migration/` SQL-files directory — which has no index — and reported
  `MODULE_NOT_FOUND` instead of resolving the `migration.ts` barrel. Reordered to
  exact-file → `X`+extension → directory, matching Node 24 (`require('./foo')` with
  both `foo.js` and `foo/index.js` resolves `foo.js`). Regression-pinned by
  `describe('file-before-directory precedence (Node parity)')`.

- **`util.format('%s', obj)` printed `[object Object]` instead of inspecting.**
  Node's `%s` structurally inspects non-null objects/arrays and suffixes bigints
  with `n`; rifty was `String()`-ing everything. `%s` now matches Node for
  shallow values (deeply-nested objects still differ pending an inspector depth
  option). Parity: `cases/util/format-and-inspect.case.ts`.

- **`vfsGrep` dropped every match for a `RegExp` carrying the `g`/`y` flag.**
  `String.prototype.match` returns an index-less array under those flags, so the
  scan silently returned zero results for a valid `/pattern/g`. `toRegExp` now
  strips `g`/`y` (preserving `m/s/u/d/i`); regression tests cover both flags.

### Added

- **`with { type: "file" }` file-loader import attribute (ADR-0068).** An
  `import x from "spec" with { type: "file" }` (esbuild/Bun file loader) now binds
  `x` to the asset's resolved absolute path string instead of trying to load the
  asset as a module — the specifier is excluded from the static-import preload, so
  a binary asset (a `.wasm`) is never evaluated. The transformer detects the
  attribute (acorn `node.attributes`) and emits `const x = __assetPath("spec")`, a
  helper injected into the ESM factory that resolves the specifier to its file id.
  Unblocks opencode's `import photonWasm from ".../photon_rs_bg.wasm" with { type:
  "file" }` (`image/image.ts`); photon's wasm API stays a lazy/dynamic concern off
  the boot path. Attribute-less ESM-wasm/binary *module* loading remains deferred
  (`Q-2026-06-01-306`). Conformance:
  `tests/conformance/modules/file-import-attribute.test.ts`.

- **Text-asset imports — `.txt` / `.sql` / `.md` / `.prompt` (ADR-0067).** An
  `import s from "./f.txt"` now binds the default export to the file's raw contents
  (esbuild/Bun text-loader behaviour), and `require("./f.txt")` returns the string;
  a new `'text'` `ModuleKind` classifies these extensions and `executeCjs` returns
  the source as `module.exports`. Only fires on an explicit-extension import (not
  added to extension fallback), so it is a pure additive capability over Node, not a
  parity regression. Unblocks opencode's 37 `.txt` prompt imports + `.sql`/`.md`/
  `.prompt` assets (`agent/agent.ts`). Binary (`.wasm`) assets are out of scope
  (`Q-2026-06-01-306`). Conformance:
  `tests/conformance/modules/text-asset-import.test.ts`.

- **`node:http2` — module-resolution surface (loud browser-ceiling facade).**
  `fastify/lib/server.js` does a top-level `require('node:http2')` unconditionally
  and only calls `createServer`/`createSecureServer` when configured `http2: true`,
  so the specifier must resolve for opencode's static server graph to evaluate
  (opencode boots HTTP/1). HTTP/2 multiplexes frames over a raw TCP/TLS socket,
  which the browser/WASI realm cannot provide (rifty's `node:http` runs over the
  page↔SW port registry), so this is a genuine capability ceiling:
  `createServer` / `createSecureServer` / `connect` / `getDefaultSettings` /
  `getPackedSettings` / `getUnpackedSettings` / `performServerHandshake` each throw
  `NotImplementedError` on use, like `tls` / `dgram`; `sensitiveHeaders` is the
  documented symbol. The exposed function set mirrors Node 24. Parity:
  `cases/http2/surface.case.ts` pins the requireable shape (the by-design
  invocation divergence is a ceiling contract, not a parity diff).

- **`node:timers/promises` builtin.** Promise-returning `setTimeout` /
  `setImmediate`, async-iterable `setInterval`, and `scheduler.wait`/`scheduler.yield`,
  with `AbortSignal` cancellation (an aborted wait rejects with the signal's reason
  or an `AbortError` and clears its timer). opencode imports `setTimeout as sleep`
  (`shell/shell.ts`, several plugins/commands); pino/avvio reach it transitively.
  Parity: `cases/timers/promises.case.ts` (happy-path values); conformance:
  `tests/conformance/builtins/timers-promises.test.ts` (incl. abort).

- **`node:stream/consumers` builtin.** `arrayBuffer` / `blob` / `buffer` / `text` /
  `json` drain a stream (Node `Readable`, any async iterable, or a web
  `ReadableStream` via `getReader`) into a value, accumulating chunks then coercing
  — faithful to Node's `for await` implementation. opencode reaches `buffer` (child
  stdout in `util/process.ts`) and `text` (`cli/cmd/providers.ts`, `lsp/server.ts`).
  Parity: `cases/stream/consumers.case.ts`; conformance:
  `tests/conformance/builtins/stream-consumers.test.ts`.

- **`async_hooks.AsyncLocalStorage` — synchronous-scope fidelity.** The
  `async_hooks` builtin gained `AsyncLocalStorage` (`run` / `getStore` /
  `enterWith` / `exit` / `disable`), implemented faithfully for synchronous
  execution and the synchronous prefix of an async function — exactly what
  opencode's `LocalContext.{provide,use}` (`util/local-context.ts`) relies on
  (`new AsyncLocalStorage()` previously threw "is not a constructor"). The store
  is **not** propagated across async scheduling boundaries (after an `await`/timer
  resumes, `getStore()` reflects the current stack's store, not the one captured
  at suspension) — faithful cross-`await` propagation needs native async-context
  tracking the browser/WASI realm does not expose. This is a documented partial
  fidelity, not a fake stub: synchronous use is byte-for-byte Node-correct.
  Parity: `cases/async_hooks/local-storage.case.ts` (synchronous); conformance:
  `async-hooks.test.ts` `describe('async_hooks.AsyncLocalStorage (synchronous
  scope)')`.

- **tsconfig-style path aliases via an opt-in `paths` resolver option (ADR-0066).**
  `ModuleLoaderOptions` gains `paths?: PathAliases` — a `pattern → target(s)` map of
  absolute VFS path patterns (e.g. `{ "@/*": "/workspace/src/*" }`). The resolver
  attempts aliases before the bare `node_modules` walk for non-relative/non-absolute
  specifiers, with tsc-faithful matching (exact > wildcard; longest static prefix
  then suffix; ordered candidate targets, first existing file wins) and
  paths-then-fallback (an alias miss falls through to `MODULE_NOT_FOUND` on the
  original specifier). Off by default = Node-faithful (a bare `@/foo` with no map is
  `MODULE_NOT_FOUND`). The resolver does NOT read tsconfig itself — the caller
  resolves `compilerOptions.paths` to absolute patterns. Unblocks the opencode
  GRAPH-LOAD wall `@/account/account` (opencode's `@/*`/`@tui/*`/`@test/*` aliases).
  Conformance: `tests/conformance/modules/resolver.test.ts` `describe('tsconfig path
  aliases (ADR-0066)')`.

- **`node:dgram` — module-resolution surface (loud browser-ceiling facade).**
  The opencode server graph pulls `multicast-dns` transitively
  (`server.ts → mdns.ts → bonjour-service → multicast-dns`), and
  `multicast-dns/index.js` does a top-level `var dgram = require('dgram')`, so the
  bare/`node:` `dgram` specifier must resolve for the static graph to evaluate.
  The browser/WASI realm has no UDP socket API (WebSocket/fetch/WebTransport are
  all stream/connection-oriented; none expose `recvfrom`/`sendto` on a UDP port),
  so this is a genuine capability ceiling: `createSocket`/`_createSocketHandle`
  and the `Socket` constructor each throw `NotImplementedError` on use, exactly
  like `tls`/`zlib`. The throw fires only if UDP is actually used (mDNS publish),
  never on import. Parity: `cases/dgram/surface.case.ts` pins the requireable
  module shape (the by-design invocation divergence is a ceiling contract, not a
  parity diff).

- **`node:worker_threads` — `markAsUntransferable` / `isMarkedAsUntransferable`
  / `markAsUncloneable` object markers.** undici's `lib/web/webidl/index.js`
  destructures `markAsUncloneable` from `node:worker_threads` and assigns it to
  `webidl.util.markAsUncloneable`, which every web-platform class (Headers,
  Request, Response, FormData, CacheStorage, WebSocket, EventTarget, …) calls in
  its constructor; the shim previously omitted it, so `new CacheStorage()` threw
  `webidl.util.markAsUncloneable is not a function`. Implemented faithfully:
  each marker is a no-op on non-objects and returns `undefined` (matching Node
  v24), the marks add no enumerable own properties, and `isMarkedAsUntransferable`
  round-trips. The tags live in module-scoped `WeakSet`s — Node stores them on
  V8 internal slots for the native structured-clone serializer, which rifty has
  no in-realm hook into; any rifty code path that re-implements clone/transfer
  in-realm consults the marks. Parity: `cases/worker_threads/markers.case.ts`.

- **`node:util/types` — full runtime type-reflection predicate set.** Promoted
  the partial 9-predicate `util.types` to a standalone faithful module
  (`builtins/util-types.ts`), registered as the standalone `node:util/types`
  builtin specifier and re-exported as `util.types`. ~40 predicates matching
  Node v24: the `ArrayBuffer` family (`isArrayBuffer`/`isSharedArrayBuffer`/
  `isAnyArrayBuffer`/`isArrayBufferView`/`isDataView`), every TypedArray
  (`isUint8Array`…`isBigUint64Array`, `isTypedArray`), keyed/weak collections and
  their iterators (`isMap`/`isSet`/`isWeakMap`/`isWeakSet`/`isMapIterator`/
  `isSetIterator`/`isWeakRef`), core objects (`isDate`/`isRegExp`/`isPromise`/
  `isNativeError`/`isArgumentsObject`/`isGeneratorObject`), functions
  (`isAsyncFunction`/`isGeneratorFunction`), and boxed primitives
  (`isNumberObject`/`isStringObject`/`isBooleanObject`/`isSymbolObject`/
  `isBigIntObject`/`isBoxedPrimitive`). Detection uses spoof-resistant brands:
  `ArrayBuffer.isView`/`instanceof` where a public brand exists, and the V8
  `Object.prototype.toString` `[[Class]]` tag for constructor-less internals
  (iterators, `arguments`, generators, boxed primitives) — matching Node's
  output for every genuine instance a dependency produces. `isProxy` throws
  rather than lie (no in-realm V8 oracle). Unblocks undici's
  `lib/web/fetch/util.js` (`require('node:util/types')` for `isUint8Array`) on
  the opencode graph. Parity: `cases/util/types.case.ts`.

- **`node:console` — faithful pure-JS builtin.** Full `Console` class over two
  writable streams (`lib/internal/console/constructor.js`): `log`/`info`/`debug`/
  `dir` → stdout, `warn`/`error`/`trace` → stderr (printf via `util.format`),
  `assert`, `group`/`groupCollapsed`/`groupEnd` indentation, `count`/`countReset`,
  `time`/`timeEnd`/`timeLog`, and `table(data[, columns])` rendering Node v24's
  box-drawing table byte-for-byte (`(index)` column, `Values` column for
  primitive rows, union of object keys, left-aligned cells, non-tabular → `log`).
  Constructor accepts positional `(stdout[, stderr])` or `{ stdout, stderr,
  inspectOptions, groupIndentation }`. Module export is the default instance
  augmented with `Console`. Unblocks undici's
  `lib/mock/pending-interceptors-formatter.js` (`new Console({ stdout })` +
  `table`) on the opencode graph. Parity:
  `cases/console/console-class.case.ts`.

- **`node:util` gains `debuglog`/`debug`.** `NODE_DEBUG`-gated lazy debug logger
  faithful to Node (`lib/internal/util/debuglog.js`): comma/space section globs
  (`*`), case-insensitive; returns a callable carrying a memoised `enabled`
  getter; the optional init callback fires on the FIRST call (not at creation);
  disabled = no-op, enabled writes `SECTION PID: <format(...)>\n` to stderr.
  `util.debug` aliases `util.debuglog`. Unblocks undici's
  `lib/core/diagnostics.js` (`debuglog('undici')`) on the opencode graph. Parity:
  `tools/node-parity-runner/cases/util/debuglog.case.ts`.

- **`node:diagnostics_channel` — faithful pure-JS builtin.** Full named
  publish/subscribe bus (`channel`, `Channel#publish/subscribe/unsubscribe`,
  `hasSubscribers`, `bindStore/unbindStore/runStores`, module-level
  `subscribe/unsubscribe/hasSubscribers`) plus `tracingChannel` /
  `TracingChannel` with the five lifecycle sub-channels (start/end/asyncStart/
  asyncEnd/error) and `traceSync`/`tracePromise`/`traceCallback`. There is no
  native binding behind this module in Node either — it is a JS-level registry —
  so the contract is mirrored exactly (parity cases under
  `tools/node-parity-runner/cases/diagnostics_channel/`). Unblocks undici's
  `lib/core/diagnostics.js` on the opencode `@effect/platform-node` graph.

- **`vfsGrep` pure-JS VFS search marker — private helper, not exported
  (feature-09 T2, Q-2026-05-30-061).** `src/utils/vfs-grep.ts` walks the VFS via
  the existing `node:fs` builtin (`readdirSync` with file types / `readFileSync`
  over `syncMirror()`) and matches lines with the JS RegExp engine — in-realm,
  ZERO process spawn. It marks the FEASIBLE side of the no-tool-execution
  (process-spawn) ceiling for the opencode facade: it reads bytes + matches like
  opencode's grep tool WITHOUT the spawn that ripgrep-the-binary needs.
  `line`/`column` are 1-based (ripgrep/Node grep convention). Private helper: no
  cross-package export via `src/index.ts`, no new builtin, no resolver intercept;
  imports only its own `builtins/fs.ts` + `@riftydev/vfs` (layer-legal). Pure-JS by
  design (not ripgrep-WASM) to stay dependency-free and trivially reversible;
  ripgrep-WASM / isomorphic-git deferred behind explicit ADR ratification. Unit:
  `utils/vfs-grep.test.ts`.

- **`vfsGrep` failure-mode contract tests (feature-09 T3, Q-2026-05-30-061).**
  Pins the off-happy-path contracts callers depend on, each catching a specific
  articulated failure mode: `maxResults` truncation (bounded walk, not an
  unbounded scan), `ignoreCase` (mixed-case matching), the suffix/extension
  `include` filter (`'*.ts'` skips `/work/x.md` — minimal suffix match, NOT full
  glob; no glob dependency), recursive descent into subdirectories, and ENOENT
  propagation when the root is missing (surfaces the underlying `node:fs`
  ENOENT — NOT swallowed into an empty result; no silent stub). The committed T2
  implementation already satisfies every contract, so these are added as
  regression pins (no production change); each was verified load-bearing (goes
  red when its branch is disabled). Unit: `utils/vfs-grep.test.ts`.

- **Spawn-ceiling conformance contract (feature-09 T4, Q-2026-05-30-063).** Pins
  the IMPOSSIBLE side of the opencode no-tool-execution ceiling as a behavioral
  contract, not prose: `child_process.spawn('git', ['status'])` and
  `spawn('bash', ['-c', …])` always fall through `spawnViaSameRealm` →
  `execScript`, surfacing `spawn <cmd> ENOENT\n` on stderr with exit code 127 —
  they MUST NOT fake-succeed. This is the substrate every impossible opencode
  tool transitively hits (`Git.run` → `ChildProcess.make('git')`, the bash tool,
  the ripgrep binary). A third case re-pins that `child.stdin.write` throws
  `NotImplementedError` on the in-realm fallback (no worker stdin port — no
  silent no-op). CONFORMANCE level, NOT Node-parity: real Node WOULD spawn
  `git`, so a parity diff is the wrong tool; asserts on `git`/`bash` only (both
  always fall through, independent of the SAB/worker-url gate). No production
  change — the ceiling already exists; this locks it. opencode is NOT vendored.
  Conformance: `builtins/child_process-ceiling.test.ts`.

- **Authoritative FEASIBLE-vs-IMPOSSIBLE tool boundary doc (feature-09 T5,
  Q-2026-05-30-062).** New `docs/compat/opencode-tool-ceiling.md` — the canonical
  table of the opencode facade's no-tool-execution ceiling in the compat
  source-of-truth, cross-linked from `docs/opencode-rifty-feasibility-2026-05-30.md`.
  ✅ feasible read substitutes (`fs.readFileSync`/`readdirSync` over the VFS, the
  pure-JS `vfsGrep`, stat) each map to an fs API exercised by T1/T2/T3; ❌
  impossible tools (bash/shell spawn, native git spawn `Git.run` →
  `ChildProcess.make('git')`, the ripgrep BINARY, PTY) each map to the
  spawn/native dependency pinned by T4's ENOENT-127 conformance contract.
  ripgrep-WASM / isomorphic-git are recorded as DEFERRED behind explicit ADR
  ratification (new dependency → IRREVERSIBLE). Documentation-only; no production
  change, no test added (prose is the "always reversible" category per CLAUDE.md).

- **`ModuleLoaderOptions` gains `workspace?` + `transformSource?`; new
  `TransformSourceHook` type (ADR-0052, feature-02 T2).** Additive optional
  public-API fields on the `@riftydev/runtime-js/loader` surface. `transformSource`
  is an injected per-file source transform
  (`{ source, id, loader: 'ts'|'tsx'|'jsx', workspace } => Promise<string>`,
  the load-bearing contract) invoked for every `.ts`/`.tsx`/`.jsx` module on the
  ESM execute path BEFORE the AST rewriter parses it; `workspace` (defaults to
  `cwd`) is the esbuild guest cwd/preopen threaded into each call. The loader
  gains zero new package import edges — the caller injects the closure (the same
  DI seam the WASI esbuild binding uses for `runWasi`). When no hook is
  configured the source passes through unchanged (no behaviour change for
  plain-JS loaders). Unit: `loader-transform.test.ts`.

- **`.ts`/`.tsx`/`.jsx` reached with no `transformSource` now throws a directed
  error on the ESM execute path (ADR-0052, feature-02 T3).** `executeEsm`
  previously deferred the no-hook case, letting raw TS fall through to acorn and
  die with an opaque `SYNTAX_ERROR` (`Unexpected token`). It now throws a
  `ModuleLoadError('SYNTAX_ERROR', …)` whose message is
  `TS transform not configured for <id>: …` BEFORE the AST rewriter parses the
  source — honest, no silent stub. The happy path (hook present) and plain-JS
  modules are unchanged. Unit: `esm.test.ts`.

- **`require()` of a `.ts`/`.tsx` module (CJS scope) throws a directed
  `NotImplementedError`, never silently `new Function`s raw TS (ADR-0052 D1
  alt-C, feature-02 T4).** `executeCjs` previously fed any `.ts`/`.tsx` that
  classified as CJS (a non-`type:module` scope) straight to `new Function`,
  dying with an opaque `SyntaxError: Unexpected token`. It now throws
  `NotImplementedError('module-loader.ts-via-require')` BEFORE touching the
  registry (so repeated `require()` calls throw idempotently rather than the
  second returning a stale loading record): the esbuild type-strip is async and
  a synchronous `require()` cannot await it, so `.ts` is only loadable as ESM via
  `import()` under a `type:module` scope. JSON and plain-JS CJS are unchanged.
  Registered in `docs/compat/modules.md` as not-supported. Unit:
  `loader-transform.test.ts`.

- **`createModuleLoader` now caches stripped TS output per resolved id, dropped
  on `invalidate(id)` (Q-2026-05-30-202, feature-02 T5).** A loader-internal
  `Map<id,string>` wraps the injected `transformSource` so the WASI esbuild
  strip runs at most once per `.ts`/`.tsx`/`.jsx` id across the import graph and
  across repeated loads within one loader instance. The cache is populated
  lazily on first hook call, read before re-invoking it, and kept coherent with
  the executed-module cache: `invalidate(id)` drops that id's stripped output,
  `invalidate()` clears all of it. `esm.ts` stays cache-unaware (the wrap is
  invisible to the execute path). Performance/REVERSIBLE only — no public-API or
  behaviour change for callers, plain-JS loaders unaffected. Unit:
  `loader-transform.test.ts`.

- **GOLD multi-file `.ts` parity case closes P0 (ADR-0052, feature-02 T7).** A
  cross-file `.ts` graph (`b.ts` exports a type-only `interface`, an `enum`, and
  a type-annotated `const`; `a.ts` imports the erased type + the value and prints
  `base + box.n + Color.G` → `43`) runs through the rifty loader's real esbuild
  WASI `transformSource` hook and is diffed against Node — proving type-stripping,
  `enum` lowering, and cross-file ESM load order match a full-TS-transform Node
  reference at the unit-of-language level, independent of opencode VFS contents.
  This is the P0 acceptance signal ADR-0052 requires.
  `tools/node-parity-runner/cases/modules/ts-graph-cross-file.case.ts`. The
  `ts-esm` parity Node reference is the vendored `tsx` (a FULL TS transform),
  not Node strip-only `--experimental-strip-types` (which throws
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on `enum`) — matching rifty's esbuild full
  transform (TODO(ADR): Q-2026-05-31-201).

- **`.ts`/`.tsx` are first-class resolvable + ESM module extensions (ADR-0053).**
  The resolver now adds `.ts`,`.tsx` to `DEFAULT_EXTENSIONS`/`INDEX_FILES` —
  AFTER the `.js` family (so plain-Node packages shipping `foo.js`, or both
  `foo.js` and `foo.ts`, resolve byte-identically to Node) and before `.json`;
  `detectKind` classifies a `.ts`/`.tsx` as `esm` under a `type:module` scope,
  else `cjs` (mirroring the `.js` branch). This is a deliberate, scoped
  deviation from Node resolution (Node never resolves bare `.ts`), required for
  the opencode `.ts` graph (M12). Resolve-side only — a `.ts` that resolves with
  no transform hook still throws a directed error at execute time (transform
  side is feature-02 T2/T3). Conformance:
  `tests/conformance/modules/resolver.test.ts` `describe('TS extension
  resolution')`.

### Fixed

- **Resolver excludes `*.d.ts`/`.d.cts`/`.d.mts` from candidate matching
  (review.md correctness-MAJOR, feature-02 F02-DTS-EXCLUDE, ADR-0053).** When
  `.ts`/`.tsx` joined `DEFAULT_EXTENSIONS`/`INDEX_FILES` there was no declaration
  -file exclusion, so a target shipping only a `.d.ts` resolved it: a relative
  `./foo.d` matched `foo.d.ts` (`${base}.ts`), an explicit `./foo.d.ts` matched
  via the `st.isFile` early return, and a package whose `exports`/`main` named a
  `.d.ts` handed it back — the strip-types path then fed types-only source to
  acorn and threw `SYNTAX_ERROR`. Declaration files are now rejected at every
  file-acceptance point in `resolveAsFileOrDir`/`resolveAsDirectory`, resolving
  as if the file did not exist (`MODULE_NOT_FOUND`), matching how Node's own
  strip-types loaders skip `.d.ts`. Surgical: a runnable sibling `foo.js` next to
  `foo.d.ts` still wins. Conformance:
  `tests/conformance/modules/resolver.test.ts` `describe('declaration-file
  exclusion')`.

- **`node:fs` `realpath`/`lstat` implement no-symlink semantics; `readdir`
  callback honours options (ADR-0050).** Reverses the prior loud-throw: for the
  symlink-free VFS, `lstatSync ≡ statSync` and `realpathSync` = normalise to an
  absolute path + `ENOENT` if missing (with `.native` alias); added async
  callback `lstat`/`realpath`/`access`/`readlink`/`copyFile`/`rename`; the
  callback `readdir` now accepts `(p, {withFileTypes}, cb)`. These are the
  correct POSIX semantics when no symlinks exist (a missing path still throws
  `ENOENT` — not a silent stub). Unblocks **real upstream Vite 5** — its watcher
  (chokidar/readdirp) calls these on the happy path; `vite createServer` +
  `listen` + `transformRequest` now run in-process. Regression:
  `tests/conformance/builtins/fs-realpath-readdir.test.ts`, the rewritten
  `src/builtins/fs.test.ts` contract block, and the opt-in
  `tests/integration/vite-live-run.opt-in.test.ts` (spawns
  `tests/integration/fixtures/real-vite-smoke.ts`). M12 symlink rewrite tracked
  by a `TODO(M12)` anchor in `fs.ts`.

- **`node:string_decoder` `StringDecoder` is now a callable constructor.**
  iconv-lite's `InternalDecoder` does `StringDecoder.call(this, enc)` then
  borrows `StringDecoder.prototype.write` — a class threw "cannot be invoked
  without 'new'", breaking body-parser's request decoding. Reimplemented as a
  function-style constructor (utf-8). Conformance:
  `tests/conformance/builtins/string-decoder.test.ts`.
- **`async_hooks.AsyncResource.runInAsyncScope` forwards `thisArg` + args +
  return value.** The stub called `fn()` and dropped everything; raw-body@2.5.x
  binds its completion callback through it, so `(err, buf)` were lost and
  body-parser left `req.body` as `{}`. Conformance:
  `tests/conformance/builtins/async-hooks.test.ts` (+ `http-incoming-body.test.ts`
  pins `IncomingMessage` POST-body streaming). Both found running real express@4.

### Added

- **`child_process.execSync` loud-throw replaces in-realm fallback (2026-05-27 audit item #2).** `packages/runtime-js/src/builtins/child_process-sync.ts` now throws `NotImplementedError('child_process.execSync', …)` when the SAB-Worker path is unavailable (no `crossOriginIsolated`, no kernel-worker URL, or main-realm call). The previous `new Function('__stdout_write', …)` fallback was a silent stub: no exit code, no stdio isolation, no PID, while pretending to be a child process — direct violation of CLAUDE.md "Hard rules → No silent stubs". Removed the dead `syncMirror` import. The existing `describe('child_process.execSync')` block in `tests/conformance/builtins/child_process.test.ts` is rewritten to assert the new contract (`NotImplementedError`); `tests/conformance/builtins/exec-sync-worker.test.ts` gains a parity `describe.skipIf(sabReady)` block for the non-SAB path so both branches are pinned end-to-end.

- **ADR-0045 — fork-IPC for Worker-backed children (M6).** `installNodeProcessShim`
  now installs `process.send(msg)` / `process.disconnect()` and emits
  `'message'` / `'disconnect'` on the Node shim (extends `EventEmitter`).
  The shim wires the kernel-supplied `KernelProcessSpec.stdio.ipc`
  `MessagePort`, dispatching `ipc:message` frames as `'message'` events and
  closing on `ipc:disconnect`. `ChildProcess.send` routes through
  `WorkerProcessHandle.send` for the SAB path (in-realm path keeps its
  existing `inboundIpc` bus). `ChildProcess.disconnect()` added; mirrors
  the handle's disconnect for the worker path and flips the local
  `ipcEnabled` gate for the in-realm fallback. Conformance:
  `tests/conformance/builtins/fork-ipc-worker.test.ts` (round-trip,
  auto-disconnect on exit, explicit disconnect), skipped outside
  SAB-capable environments.

### Changed

- **ADR-0041 — `fs.readdirSync({ withFileTypes: true })` no longer re-stats children.** `FsSync.readdirSync` returns `VfsDirent[]` directly, so the `withFileTypes` branch now reads `isFile`/`isDirectory` from the dirent shape instead of doing an N+1 `statSync` per child. `fs-watch.ts` and other internal callers are updated to read `.name` instead of bare strings.
- **`child_process.spawn` worker path uses `handle.stdout()` / `stderr()`.** The `wireWorkerStdio` helper is removed — the kernel `WorkerProcessHandle` now owns the `MessagePort` → `Readable` wiring (port start, push-on-message, EOF on exit). `spawnWorkerChild` no longer takes `stdout`/`stderr` args; the caller reads streams from the handle. `worker_threads.Worker` (kernel path) likewise drops its hand-rolled `ports.stdout.onmessage` setup. Follow-ups doc item #3.
- **`ChildProcess.stdin` wired through `WorkerProcessHandle.stdin()` for the SAB-Worker path.** `ChildProcess.stdin` is now a real `Writable` instead of a loud-throw struct (`{ write: never, end: never }`). For Worker-backed children, `spawnViaWorker` passes the kernel `bindPortAsWritable`-backed accessor — `child.stdin.write(chunk)` posts to the worker's stdin `MessagePort` and `child.stdin.end()` closes it. The in-realm `spawnViaSameRealm` fallback still has no worker, so its `stdin` is an `InRealmStdinUnsupported` subclass whose `write` / `end` throw `NotImplementedError` synchronously (kept loud per CLAUDE.md "no silent stubs"). Closes the M6 "Open acceptance" `ChildProcess.stdin IPC` row. Conformance: `tests/conformance/builtins/child_process-stdin.test.ts` (skipped outside SAB-capable environments — Vitest's plain Node runner — runs in the browser e2e harness). Worker-side `process.stdin` Readable wiring (so user scripts can do `process.stdin.on('data', …)`) remains a separate follow-up.

### Added

- **ADR-0039 — Node-API knowledge moved here from `@riftydev/kernel`.** Three
  new modules under `src/ipc/`:
  - `install-process.ts` — `installNodeProcessShim(spec)` builds the
    Node-shape `process` global from the kernel's `KernelProcessSpec`
    (pid/ppid/argv/env/cwd/stdout/stderr/exit). Module-load side-effect
    registers itself as the kernel's pre-entry hook (via
    `setKernelPreEntryHook`), so host chunks that import this module
    before `@riftydev/kernel/worker-entry` get the wiring for free. Exposed
    via the new `@riftydev/runtime-js/install-process` subpath export.
  - `handlers.ts` — `installRuntimeJsExecSyncHandler(dispatcher, resolveScript)`
    registers the `'execSync'` handler on the kernel dispatcher: parses
    `node <script>` command lines, resolves bytes from the runtime-js VFS
    sync mirror, dispatches to the recursive runner, decodes stdout.
    Exports `ExecSyncPayload`, `ScriptResolver`, and
    `InstallRuntimeJsExecSyncOptions`. 7 new unit tests in
    `handlers.test.ts` cover EUNSUPPORTED / ENOENT / happy path / child
    failure / cwd+env propagation / payload coercion.
  - `recursive-runner.ts` — `makeRecursiveRunner()` returns a runner that
    spawns a fresh kernel Worker per `execSync` invocation, captures its
    stdout, and resolves once the child exits. Statically imports
    `spawnKernelWorker` from `@riftydev/kernel` (top-down, no late binding —
    closes the previous module-load handshake the kernel needed for
    `setKernelRecursiveSpawn`).
- **`builtins/child_process.ts` boot wiring.** Module-load side-effect
  now reads `getKernelDispatcher()` and calls
  `installRuntimeJsExecSyncHandler(...)` with a VFS-backed resolver. The
  previous `setExecSyncScriptResolver(...)` call is gone (and the helper
  itself was deleted from the kernel — see ADR-0039).

### Changed

- Builtin registration sites in `src/builtins/index.ts` drop the
  `as unknown as Record<string, unknown>` cast on every `registerBuiltin(...)`
  call (34 sites). `BuiltinFactory` is now generic over its return type
  (see `@riftydev/io` changelog), so TypeScript infers each factory's concrete
  module shape and a typo against an exported namespace becomes a
  typecheck error rather than a runtime surprise. No behaviour change. The
  remaining structural-assertion casts on `EventEmitter` (used as a
  namespace) and `globalThis` (capability probes in `env/capabilities.ts`)
  are intentional and unrelated to the registry boundary.

- **ADR-0035: builtin registry sourced from `@riftydev/io`.** The
  `name → factory` cache that backs `node:<name>` lookups
  (`registerBuiltin`, `loadBuiltin`, `isBuiltinSpecifier`, `listBuiltins`,
  `BuiltinFactory`) now lives in `@riftydev/io`. The top-level public
  re-exports from `@riftydev/runtime-js`'s `src/index.ts` are unchanged;
  `src/builtins/index.ts` re-exports the surface from `@riftydev/io` so
  internal callers (`module-loader/loader.ts`, `module-loader/resolver.ts`,
  `builtins/module.ts`) keep their existing import paths. The internal
  module `src/builtins/registry.ts` is deleted (was not on the
  subpath-exports list, so no public path is broken). See ADR-0035 for
  the rationale.

- **ADR-0034 (D-B):** the re-exported `node:stream` surface from `@riftydev/io`
  (via `src/builtins/stream.ts` shim) now matches Node's documented
  contract — `_readableState`/`_writableState` containers, `Readable.read(n)`
  honours `n`, `Writable.destroy` cancels in-flight queue, `Duplex`/`Transform`
  methods on the prototype (no per-instance rebinding), `pipeline()` destroys
  upstream on error. No source change in this package — the shim re-exports
  unchanged. Listed here so consumers of `@riftydev/runtime-js/builtins/stream`
  can find the breaking-contract-restoration note from their own changelog.
  See `packages/io/CHANGELOG.md` and ADR-0034 for details.

### Added

- **Worker-globals owner table.** New internal module `src/internal/worker-globals.ts` consolidates the ad-hoc `globalThis` / `self` writes (`__riftyEsmStash`, `__riftyLastEsmBody`, `__riftyLastEsmFile`, plus the `__setCreateRequireImpl` closure, plus `require`/`__riftyImport` on `self`) under one typed publish/read/unpublish API rooted at `globalThis.__rifty.*`. Mirrors kernel's `shared-globals.ts` pattern; sub-namespace keeps the M11 A-026 multi-realm story collision-free against the kernel-owned flat `__riftyKernel*` keys. Closes the "Ungoverned globals" Tier 2 #10 finding from the 2026-05-26 architecture review. 17 unit tests cover publish/read roundtrip per documented key, unpublish cleanup, and isolation from kernel-owned flat keys.
- **D-E granular module invalidation.** `ModuleRegistry.invalidate(id?)` and `ModuleLoader.invalidate(id?)` — full reset with no `id`, single-entry drop with an absolute id (future HMR hook). `worker-entry`'s `load-fixture` handler now calls `loader.invalidate()` instead of rebuilding the loader, so the resolver and REPL bindings survive editor saves (was Tier 1 #4 in the 2026-05-26 architecture review).

### Removed

- **ADR-0037: parallel `SyncVfs` / `MemorySyncVfs` deleted.** The module loader (`createModuleLoader`, `createResolver`) now consumes `@riftydev/vfs:FsSync` directly; the loader-local `SyncVfs` interface (`module-loader/vfs-sync.ts`) and the hand-rolled `MemorySyncVfs` backend (`module-loader/memory-sync-vfs.ts`) are removed, along with the corresponding `MemorySyncVfs` / `SyncVfs` re-exports on `@riftydev/runtime-js/loader`. Inside the runtime Worker, `worker-entry.ts` now mints one `MemoryFsSync` (via `createMemoryFs()`), publishes it via `setSyncMirror(...)`, and feeds it to the loader — so `load-fixture`, `fs.readFileSync`, WASI preopens, and module resolution all reach the same `MemoryBackend` (ADR-0014's promise, finally redeemed for the Worker realm). Callers (tests, parity runner, playground adapter) construct `new MemoryFsSync()` from `@riftydev/vfs/internal` and feed it to the loader; the playground's `realVite.ts` adapter drops its hand-rolled `makeSyncVfs()` wrapper and passes `syncMirror()` directly. Public API change for `@riftydev/runtime-js/loader` — see ADR-0037.

### Fixed

- `readline.cursorTo` / `clearLine` / `clearScreenDown` / `emitKeypressEvents` now throw `NotImplementedError` instead of silently no-op'ing (no-silent-stubs).
- `perf_hooks.PerformanceObserver.observe` now throws `NotImplementedError('perf_hooks.PerformanceObserver.observe')` instead of silently no-op'ing. The constructor stays callable so defensive top-level `new PerformanceObserver(...)` (Vite, etc.) doesn't blow up at module load — mirrors ADR-0010's import-time-OK / use-time-loud pattern.

### Added

- **ADR-0019 host-eval cwd wiring.** `RuntimeController.eval(code, { cwd })` now propagates the cwd to the Worker via `EvalRequest.cwd`; the Worker bootstrap calls `setProcessCwd(req.cwd)` before running user code, so `process.cwd()` reflects the host-supplied value. New exported type `EvalOptions`. Conformance: a new case in `tests/conformance/builtins/process-cwd.test.ts` covers the inherited-cwd path.
- **Sync globals via typed reader.** `builtins/child_process-sync.ts` calls `readKernelSyncApi()` instead of indexing `globalThis[KERNEL_SYNC_CALL_KEY]`; the legacy untyped accessor has been removed.

- Host-side `spawnRuntime` controller + Worker entry that evaluates code and streams `stdout`/`stderr`/`error` events. `reset()` terminates and respawns the Worker.
- Console capture: replaces `console.log/info/debug/warn/error/dir/trace` with sinks that serialise non-primitives via a Node-style inspector.
- `detectCapabilities()` checks for `crossOriginIsolated`, `SharedArrayBuffer`, `Atomics.waitAsync`, and OPFS sync handle.
- Module loader (`createModuleLoader`):
  - Shared Node resolver: walk-up `node_modules`, `package.json` `main`/`exports`/`imports`, conditional exports (`node`/`default`/`import`/`require`), extension fallbacks, directory `index.js`/`index.mjs`.
  - CJS loader (`new Function('module','exports','require',...)`) with cycle support via the half-populated `module.exports` pattern.
  - ESM loader: `es-module-lexer` for fast scanning, transform to async-function form, top-level await, live bindings via getters on the module namespace, dynamic `import()`, cycle support.
  - CJS ↔ ESM interop: ESM importing CJS through a `default` + namespace wrapper, CJS loading ESM only via async `import()`.
- Conformance tests (resolution, cycles, live bindings, interop) and integration test fixtures (`lodash` CJS, `nanoid` ESM).
- **M10:** `fs.watch` / `fs.watchFile` / `fs.unwatchFile` (polling-based). Watcher emits Node-compatible `'rename'` / `'change'` events; directory watches report changed filename; abort via `AbortSignal`; idle interval doesn't fire. New `./builtins/fs-watch` subpath export. 8 conformance tests.
- **M10:** `RuntimeController.writeFile(path, content)` for editor↔VFS sync (used by the playground's Dev Mode).
- **ADR-0029:** `fs.utimesSync(path, atime, mtime)` and `fs.promises.utimes` route through `syncMirror().utimes`. Accepts numeric seconds or `Date` per Node semantics; mtime stored in ms.
- **ADR-0012:** `builtins/{events,buffer,stream}.ts` became thin re-export shims over `@riftydev/io` — the primitives now live in `@riftydev/io`. `builtins/child_process.ts` allocates PIDs via `@riftydev/kernel.globalProcessManager.spawn(...)` so `ChildProcess.pid`, `exitCode`, `signalCode`, and `cwd` (ADR-0019) come from the kernel record. Added `@riftydev/kernel` as a direct dependency.
- **ADR-0011 phase 2:** `builtins/child_process.ts` (and `fork`) now branches on `isSabIpcSupported() && getKernelWorkerUrl()` — when both hold it routes through `globalProcessManager.spawnWorker(...)` (real Web Worker realm) via the new `builtins/child_process-worker.ts` helper, which builds a `SpawnWorkerSpec` from the script bytes in `syncMirror()` and pumps the worker's stdout/stderr `MessagePort`s into the existing `Readable`s. Non-`node` commands and the SAB-less fallback path keep the existing in-realm `execScript` behaviour (marked `// fallback per ADR-0011`). `execSync` stays in-realm — true sync blocking is phase 3. `builtins/worker_threads.Worker` carries the same branching: `startViaKernel()` for the SAB path, `startSameRealm()` for the fallback. 2 new conformance tests (`tests/conformance/builtins/child_process-worker.test.ts`, skip in Node-without-isolation).
- **ADR-0011 phase 3:** `builtins/child_process-sync.ts` houses the new `execSync` body. When `isSabIpcSupported() && getKernelWorkerUrl() && globalThis[KERNEL_SYNC_CALL_KEY]` (i.e. we are inside a kernel-spawned Worker) it delegates to the global hook `__riftyKernelSyncCall('execSync', { cmd, opts })`, decoding the parent dispatcher's stdout reply as a UTF-8 `Buffer`. The hook itself is installed by `@riftydev/kernel`'s `worker-entry.ts` and backed by a `SyncRpcClient` that `Atomics.wait`s on the SAB reply slot — this is the first path that truly blocks the calling realm. Outside a kernel Worker (no hook, no isolation, or main realm) the function falls back to the existing in-realm `new Function(...)` evaluation, marked `// fallback per ADR-0011 phases 2/3`. The 5 existing `child_process` conformance tests cover that fallback. A new skip-by-default suite under `tests/conformance/builtins/exec-sync-worker.test.ts` documents the SAB contract for the browser e2e harness. `builtins/child_process.ts` re-exports `execSync` from the new module so the public Node-shape surface is unchanged. The same file also calls `setExecSyncScriptResolver` at import time so the kernel's default `execSync` handler can read scripts from this realm's `syncMirror()` without taking a runtime dependency on `@riftydev/vfs`.

### Changed

- **ESM loader** now uses an **AST-based transformer** (`acorn` + scope-tracking walker) instead of the regex / zone-scanner approach. Scope-aware rewriting fixes parameter-shadowing of imported bindings, which previously broke real Vite's pre-bundled deps (e.g. `dep-BK3b2jBa.js` with `function format(win32, …)`). See ADR 0009. Adds `acorn` and `acorn-walk` to dependencies; removes `module-loader/source-scanner.ts`.
