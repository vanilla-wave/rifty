# Changelog

## [Unreleased]

### Added

- **Run a VFS Node entry through the module loader (ADR-0137).** New
  `runNodeEntry` primitive (`builtins/node-entry.ts`) + `node-entry-url.ts` host
  seam (`setNodeEntryWorkerUrl`/`getNodeEntryWorkerUrl`, mirrors the kernel's
  `setKernelWorkerUrl`). The playground node-entry bootstrap calls it to run a
  shell-resolved `.bin` launcher (resolve target → import via loader) or a plain
  `node <script>`. `child_process.spawn('node', [script])` (worker path) now
  spawns this bootstrap instead of a raw `kind:'source'` worker, so a spawned
  script with a shebang / relative import runs via the loader.

### Fixed

- **`createReadStream` prefers the sync content cache over the async disk surface
  (P5 of ADR-0143 "D", ADR-0148).** On an OPFS-backed realm `OpfsVfs.openReadable`
  (`File.stream()`) stalls under cross-realm preview serving (`express.static` →
  serve-static → `send`), 502ing static files while a dynamic route on the same
  port works. The sync mirror's content cache (ADR-0072) is the authoritative,
  fully-in-memory view, so `createReadStream` now serves from it, falling back to
  `openReadable` only for paths the cache lacks. True async streaming (ADR-0020
  phase 2) is restored once the OPFS stream is fixed (backlog:
  `runtime-js/createreadstream-true-async-streaming`).

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
  The remaining `eval` divergence is recorded in ADR-0138.
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
  a permanent divergence (ADR-0138). Closes the
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
