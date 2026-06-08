# Performance Audit — rifty Browser JS Runtime

> Generated 2026-06-05 by an 8-subsystem fan-out review with per-finding adversarial verification (57 agents). 48 findings raised → 44 confirmed against real code → deduplicated to ~22 distinct actions. Goal: **JS runtime execution speed** (user Node code in the browser), not repo build speed.

## 1. Executive summary

Biggest, lowest-risk wins:

- **Stateless-codec hoisting** — one `TextEncoder`/`TextDecoder` per `Buffer.from`/`toString`/fs read-write/socket chunk, repo-wide.
- **Resolver caching** — each module is resolved/read twice, its `package.json` parsed 2–4×, its package scope walked twice per load.

Dominant *latency* defect: the sync-RPC dispatcher **busy-polls at `setInterval(1ms)`** instead of waking on the `Atomics.notify` the worker already fires — adding ~2–4ms (browser nested-timer clamp) of dead latency to every parent-delegated syscall, the prerequisite for moving fs/net onto the ring.

Cross-cutting theme: **redundant per-call allocation/recomputation on known-good data** — codecs reconstructed, paths re-normalized 2–5×, buffers copied twice per write/frame, JSON round-trips on bytes that are already bytes.

Biggest *structural* throughput lever: **fetch concurrency in npm install**, fully serial today (Σ of every network RTT instead of overlapped batches).

The 44 findings dedupe to ~22 distinct actions (codec-singleton, dispatcher-waitAsync, resolver-cache, OPFS double-slice, normalizePath, EventEmitter-slice, statSyncOrNull each appear 2–3× across reports).

## 2. Top 10 prioritized actions (impact-on-hot-path ÷ effort)

| Rank | Action | Subsystem | Hot path | Impact | Effort | Risk |
|------|--------|-----------|----------|--------|--------|------|
| 1 | Hoist module-level `UTF8_ENCODER`/`UTF8_DECODER` singletons in `buffer-codec.ts` (+ net.ts/server.ts); keep decoder **non-fatal** | io / net | per-byte | Medium | S | Very low |
| 2 | `EventEmitter.emit`: single-listener fast path (no `slice()`, no `apply`-spread), keep slice for len>1 | io | per-chunk | Medium | S | Low |
| 3 | OPFS `writeFileSync`: take **one** defensive `data.slice()`, share it between content cache and write-through | vfs | per-syscall | Medium | S | Low |
| 4 | Resolver: compute `findPackageScope` once in `readResolved`, pass scope into `detectKind` (kills double scope-walk + double pkg-json parse per JS/TS module) | module-loader | per-module-load | Medium | S | Low |
| 5 | `package.json` parse cache (Map on loader closure, cleared in `invalidate()`) routing all 4 parse sites | module-loader | per-module-load | Medium | S | Low |
| 6 | `fs.ts resolvePath`: drop redundant outer `normalizePath` on relative branch (`joinPath` already normalizes) | vfs | per-syscall | Low | S | Low |
| 7 | `normalizePath` "already-normalized" early-out (single scan, no split/join) — helps every fs syscall + every resolver probe | vfs | per-syscall | Medium | M | Low-moderate |
| 8 | Dispatcher: replace `setInterval(1ms)` with `Atomics.waitAsync` arm on `REQ_STATE` (+ long backstop poll) | kernel/ipc | per-syscall | High | M | Medium |
| 9 | Carry `ResolvedModule` to execution (`loadResolved`) instead of re-resolving by id — removes per-first-load second read+decode+scope-walk | module-loader | per-module-load | Medium | M | Low-mod |
| 10 | npm install: bounded-concurrency tarball fetch pool (placement walk stays serial/deterministic) | npm-client | per-request | Medium | L | High |

Ranks 1–6 are quick wins (S effort, no API change, no ADR). Ranks 7–10 carry the higher ceiling.

## 3. By subsystem

### io — Buffer + streams

- **Per-call codec construction** (`buffer-codec.ts:25,59`): `new TextEncoder()` / `new TextDecoder('utf-8')` on every utf8 encode/decode — the default path behind `Buffer.from(str)`, `toString('utf8')`, fs reads/writes, console/stdout. Fix: module-level singletons. *Medium / S / very low — stateless one-shot codecs are byte-identical; decoder MUST stay non-fatal (Node replaces bad bytes with U+FFFD, never throws — do not copy sync-rpc's `{fatal:true}`); do not touch the per-stream streaming decoder in `readable.ts:116`.*

- **`emit` always allocates a snapshot array** (`event-emitter.ts:157`): `arr.slice()` + `.apply` per emit, on the hottest fan-out path (stream `'data'` per chunk, socket `'message'`). Fix: `if (arr.length===1)` call the captured single listener via an `args.length` switch (0/1/2/3 positional, else apply) and `return true`. *Medium / S / low — must `return true` not bare return (boolean contract); keep `slice()` for len>1 (a `once` self-removal/`removeListener` during emit splices the live array and would skip listeners). Verified safe vs all three Node invariants.*

- **Redundant full-buffer copy in fs text reads** (`fs.ts:141`, `buffer-prototype.ts:33`): `Buffer.from(bytes).toString(enc)` allocates a full copy then decodes. Fix: expose `bytesToString(bytes, enc)` from `@riftydev/io` index, call directly in the encoded branch; **keep `!encoding → Buffer.from(bytes)` (owned-mutable Buffer per Node).** *Medium / M / low — but the public export is a cross-package API addition → ADR. Add parity case (empty/odd-length utf16le/latin1-high/hex).*

- **`new DataView` per int/float accessor** (`buffer-prototype.ts:27` and all `readUInt*`/`writeUInt*`): throwaway DataView per `readUInt32LE` etc. Fix: cache a lazy full-range `DataView` per instance (`dvFor(this).getUint32(offset, le)`). **Do NOT use the byte-math fast path** — returns garbage on OOB instead of `RangeError` and benchmarked *slower* (cached getUint32 ~48ms vs byte-math ~71ms vs fresh-DataView ~2200ms per 50M iters). *Medium / M / low — internal field; add OOB-throw parity cases (none exist for int accessors today).*

- **Char-by-char decode loops** (`buffer-codec.ts:63-84`): `s += String.fromCharCode(...)` for latin1/ascii/hex/base64/utf16. Fix: batched `String.fromCharCode.apply` over 8K slices; drop `?? 0` (index provably in range). *Low (~1.5–2× on non-utf8 paths only; NOT quadratic — V8 cons-strings keep concat linear) / M / low-medium — chunk under arg-count ceiling; preserve utf16 trailing-odd-byte truncation.* **Separate ticket (do NOT bundle):** ascii decode is missing the `& 0x7f` 7-bit mask — `toString('ascii')` diverges from Node for bytes ≥0x80; fix in its own PR with a failing parity case first.

- **Per-chunk `queueMicrotask` in `Writable.write`/`Readable.push`** (`writable.ts:152,208`, `readable.ts:357,382`): N writes queue N microtasks, one chunk drained per turn. Fix A (low-risk first): `drainScheduled` flag collapses N schedules → 1. Fix B (separate commit): loop in `drainBuffer` while `_write` fires synchronously, break on first async. *Medium / L / medium — stream event order (`data`/`drain`/`finish`) and backpressure timing are parity-critical; bound the sync loop by "first async `_write`"; full stream suite must stay green.*

### VFS — file system backends + resolver

- **`dirname`/`basename`/`extname`/`segments` re-run full `normalizePath`** (`path.ts:44-80`) on already-normalized strings; OPFS `writeFileSync` pays 3× and `MemoryBackend.writeFile` ~5× per syscall. Fix: (1) internal `dirnameNormalized`/`basenameNormalized` doing only `lastIndexOf('/')` slicing for known-normalized callers; (2) an already-normalized early-return inside `normalizePath` (leading `/`, no `//`, no trailing `/`, no `./`/`../` *or `/.`/`/..` endings*). *Medium (allocation/GC relief) / M / low-moderate — fast-path must be byte-identical to `normalizePath`; gate with predicate-targeted unit tests incl. `/a/..`, `/a/.`, `/a//b`, relative, empty, filenames-with-dots.*

- **`existsSync` THEN `statSync`** (resolver.ts: 7 sites, e.g. `264,281,303,318,355,424,620`): two normalize + two index/tree lookups for one logical "is this a file?". Fix: add `statSyncOrNull(path)` to `FsSync` (returns stat-or-null, never throws); replace double-probe sites. Keep `statSync` throwing (Node parity). *Medium (constant-factor on hits; `&&` already short-circuits misses) / M / moderate — new method on cross-package `FsSync` interface → ADR; both backends implement identically; mirror existing `statSync` tests (incl. OPFS live-handle size).*

- **`readPackageJson` no cache** (resolver.ts:594, called at 293/356/425 + inlined at 624): N modules from one package → N decode+parse of its `package.json`. Fix: `Map<string,PackageJson>` owned by the loader, routed through all 4 parse sites, **cleared in `loader.invalidate()`** alongside `transformCache`. *Medium / S / low — but the "immutable, no invalidation" rationale is WRONG: `load-fixture` reload overwrites files (incl. package.json) then calls `invalidate()`; an unwired cache serves stale `type`/`exports`/`main`. Add test: edit package.json → `invalidate()` → new value observed.*

- **OPFS `writeFileSync` copies the buffer twice** (`opfs-sync.ts:434,438`): `data.slice()` for cache AND again for write-through. Fix: `const owned = data.slice(); this.content.set(...,owned); this.enqueueWriteThrough(...,owned)`. *Medium (2N→N per write, on tarball-extract/bundle-emit) / S / low — write-through only reads; read path copies via `Buffer.from`, cache buffer never mutated in place.* **Caveat (cross-cutting report #44 disputes this):** if WASI `fd_write` mutates the cache buffer in place via a by-reference `readFileBytesSync`, sharing is unsafe. Verify whether `readFileBytesSync` returns by reference and whether WASI mutates it; if so, the safe variant requires making `readFileBytesSync` return a copy first (trades a write copy for a read copy — only wins write-heavy). Gate behind a benchmark + an aliasing test.

- **`fs.ts resolvePath` double-normalize** (`fs.ts:41`): `normalizePath(joinPath(cwd,str))` — `joinPath` already normalizes. Fix: `return joinPath(getProcessCwd(), str)`. **Do NOT "guard it in joinPath"** (public util, 45+ callers, IRREVERSIBLE). *Low (~214ns/call isolated, relative-arg user fs calls only; resolver bypasses `resolvePath`) / S / low — add a `chdir`-then-relative-`readFileSync` parity case.*

### Module loader — resolution + transform

- **Every module resolved twice + read+scope-walked twice per load** (loader.ts:184-187 → 139 → 159-160; esm.ts:113-117): `resolve()` runs full `readResolved` then drops `.source`/`.packageRoot`, passes only `.id`, and `loadAsync` re-resolves. Fix: `loadResolved(resolved)` carrying the already-resolved module; in `executeEsm`'s static-import preload, `loadResolved(dep)`. *Medium (≈50% of source reads on tree-shaped graphs; less on high-fan-in — the per-edge `deps.resolve(spec)` re-resolve, in-degree D times, is NOT addressed here) / M / low — registry/cycle guards still fire; `esm:true` vs `false` re-resolve is behaviorally equivalent given an absolute id.*

- **`findPackageScope` runs twice per file in one `readResolved`** (resolver.ts:639 + 658 via `detectKind`): two upward walks + two reads + two `JSON.parse` of the scope package.json, for every `.js`/`.ts`/`.tsx`. Fix: compute scope once, pass `pkg.type` into `detectKind`. *Medium / S / low — purely internal; preserve `detectKind` early returns for `.json`/`.mjs`/`.cjs`/text.* **The single best quick win in the loader — confirmed at resolver.ts:639/658.**

- **No resolution cache** (resolver.ts: no memo): `react` from 200 files → 200 `node_modules` walks + pkg-json parses. Fix: memo INSIDE the resolver closure keyed `${esm}\0${fromDir}\0${specifier}` → **file-id string or sentinel** (cache at `resolveSpecifierToFile`, NOT the `resolve()` boundary — `readResolved` must re-read fresh source). **Full-clear on ANY `invalidate()`** (input-keyed cache can't be pruned by resolved-id). *Medium (CPU, not I/O — VFS is Map-backed) / M / moderate — invalidation is the whole risk.* **Do NOT cache negative/not-found results** (guest `fs.writeFileSync`/npm-install-then-require writes to the shared VFS without firing `invalidate()` → poisoned absence). Do NOT cache the `PACKAGE_PATH_NOT_EXPORTED` throw path. REVERSIBLE → OPEN_QUESTIONS + TODO(ADR).

- **`transformEsm` (acorn parse + AST walk) never cached** (esm.ts:102, esm-ast.ts:556-624): the heaviest per-module CPU step; the editor-save `invalidate()` loop re-parses every unchanged byte-identical module. Fix: id-keyed `Map<string,TransformResult>` dropped in lockstep with `transformCache`/registry. Wiring: add a `transformEsm?` hook field to `EsmLoaderDeps` (it's imported directly, not injected like the strip cache) — `executeEsm` calls `deps.transformEsm`. *Medium (re-run scenarios, not cold load) / M / low-moderate — `transformEsm` verified pure; invalidate single-id vs full-clear must mirror `transformCache`. REVERSIBLE, TODO(ADR) like Q-2026-05-30-202.*

### Synchronous IPC transport (SAB ring + dispatcher)

- **Dispatcher `setInterval(1ms)` instead of `Atomics.waitAsync`** (sync-dispatch.ts:137-151; notify already fired at sab-ring.ts:212): the docstring's claim that `waitAsync` "blocks forever on the main thread" is false — it returns a Promise (the repo's own `waitReplyAsync` proves it). Browsers clamp nested `setInterval` to ~4ms, so every parent-delegated sync call eats ~2–4ms dead latency. Fix: per-ring `armRequestAsync` on `REQ_STATE`/`STATE_IDLE`; on sync `{async:false,'not-equal'}` → pump immediately + re-arm; on `{async:true}` → await then pump; re-arm AFTER reply written (tie to thenable settle); cancel pending wait on detach; keep a 50–100ms backstop poll + feature-detect fallback where `waitAsync` is absent. **Keep `pollIntervalMs` as accepted-but-ignored / backstop interval (exported public API).** *Today medium (only `execSync` registered, an already-multi-ms path); becomes **high** as prerequisite for moving fs/net syscalls onto the ring (A-021) / M / medium — re-arm sequencing, sync `not-equal` return, detach cancel, recursive-attach arming. No Node-semantics change. Softens ADR-0011 phase-3 → OPEN_QUESTIONS note (reversible, 1 file).*

- **Full JSON serialize/deserialize per frame, incl. large execSync stdout** (sync-rpc.ts:96-138, handlers.ts:98): raw bytes → string → JSON-escaped string → UTF-8 → SAB → UTF-8 → string → JSON.parse. Fix: 1-byte frame-tag discriminator; execSync returns `result.stdout` as `Uint8Array`, dispatcher writes a BINARY-tagged raw copy. *Medium (execSync stdout only — `readFileSync` reads syncMirror in-realm, NOT the ring) / L / medium — `SYNC_RPC_PROTOCOL_VERSION` 1→2 (two-peer recompile, ADR-0032).* **Primary justification is a correctness fix:** current non-fatal `TextDecoder` + `Buffer.from(...,'utf8')` mangles non-UTF-8 child stdout (U+FFFD) where Node returns exact bytes. Add a binary/non-UTF-8 execSync parity case (only ASCII conformance exists today).

- **Double buffer copy per frame** (sab-ring.ts:207/291 write, 247-249/270-272 read): `bytes.set` into SAB, then fresh `new Uint8Array` + `set` out. Fix: decode directly from `this.bytes.subarray(off,off+len)` (TextDecoder/JSON consume synchronously before slot reuse). *Medium / M / moderate — success path becomes decode-then-flip-IDLE; error/version-mismatch path keeps flip-then-throw (ring-wedge guard); return contract changes from copy to view → SabRing is public → ADR.*

- **Fixed 2 MiB SAB per spawn** (sab-ring.ts:52,119; spawn-worker.ts:127): every child, incl. tiny-payload execSync, gets a zero-filled ~2 MiB SAB. Fix: plumb `payloadCapacity` through `SpawnWorkerSpec` AND `WorkerSpawnSpec` (worker-entry.ts:241 `SabRing.attach(spec.syncRing, spec.payloadCapacity)`); lower default (e.g. 64 KiB) **only after** an escalation path (larger ring for execSync, or MessageChannel chunking for oversize replies). *Medium (memory footprint under high spawn counts > CPU — SAB zeroing is lazy) / M / low-medium — both peers must agree; smaller default WILL throw `RingPayloadTooLargeError` for large execSync stdout until escalation is built; cross-package public shape → ADR.* **Correction:** stdout/stderr already bypass the ring via MessageChannels — execSync stdout is the ONLY large ring consumer.

- **execSync handler string round-trip + fresh TextDecoder** (handlers.ts:98,85): `new TextDecoder().decode(result.stdout)` per call. Fix: hoist a module-level **lenient** `STDOUT_DECODER` (NOT sync-rpc's fatal one); the real win (return bytes, drop decode) folds into the binary-frame work above. *Low / S / low.*

### process/worker lifecycle + npm install

- **npm install fully serial — no fetch concurrency** (installer.ts:296,309-345; confirmed no `Promise.all`, serial `await visit` at 320-343): Σ of every packument+tarball RTT. Fix: keep placement walk serial+deterministic (preserves the express-diamond first-wins contract, installer.test.ts:225); parallelize only the **tarball fetch** into a bounded zero-dep counting semaphore, await all before `link()`. *Medium (cold live-resolve only; re-installs hit lockfile fast path; `extractTarGz` inflate/tar-parse serializes on main thread; prod ADR-0028 Edge Function not deployed → ceiling unverifiable) / L / high.* **Reject the finding's "claim-flat-slot synchronous-before-await"** — placement needs `pin.version` known only AFTER `await source.resolve`, so the claim straddles the await and makes layout depend on resolve-completion order → breaks installer.test.ts:225 (hard rule: never edit the test). Keep placement request-ordered.

- **Linker per-file recursive mkdir** (linker.ts:42-47; opfs.ts:133-146,60-66): `mkdir(dir,{recursive})` once per FILE re-resolves every path segment from root → O(M·D) `getDirectoryHandle` round-trips, serial. Fix: per package, dedup distinct parent dirs into a `Set`, `mkdir` each once, then `Promise.all` the writes (drop per-file mkdir — OPFS `writeFile` creates the parent chain anyway). *Medium / S / low — pre-creating distinct dirs first closes the leaf-creation race; distinct files are independent handles. Add a multi-dir-package install test.*

- **`pickBestVersion` full filter+sort per resolve** (semver.ts:278-286): hundreds of regex matches + O(n log n) sort for popular packages (`@types/node`, `lodash` 400-800 versions), only the max needed. Fix: single linear max-scan via existing `compare` (byte-identical selection). Optional: memo `(name|range)→pick` alongside `packumentCache`. *Low (dwarfed by serial network — land alongside the concurrency change) / S / low — reuse `compare`/`matchesRange`; guarded by semver.test.ts:61 + `^4→4.21.2`.*

- **Per-spawn env+argv structured-clone** (spawn-worker.ts:150-175): full env record + argv cloned every spawn regardless of ring use. Fix: ship a per-spawn diff/overrides over a hoisted/shared canonical env, or freeze+share one env object. *Medium if spawn-rate high (test runners, worker_threads fan-out) / M / low — internal to spawn, REVERSIBLE → OPEN_QUESTIONS.* **Worker pre-warm pool** (1–2 fresh never-executed workers) is the biggest spawn-latency lever but gate on a measured spawn spike; separate PR.

- **Worker boot eagerly evaluates 40+ builtin module bodies** (builtins/index.ts:1-117): a log-only worker drags the whole builtin surface; `child_process.ts` runs `installRuntimeJsExecSyncHandler` + pulls kernel/worker-spawn at barrel boot. Fix: (1) split `isBuiltinSpecifier`/name-list into a names-only module so resolver stops pulling the barrel; (2) move the execSync handler install into the `child_process` factory. *Low/medium (per-worker-realm cold start, amortized — NOT per-spawn) / L / moderate — `loadBuiltin` is on the SYNC `require()` path → keep hot core (path/util/events/buffer/process/stream/fs/os/crypto) static; never convert a sync-require()-able builtin to async import; touches public re-exports + ADR-0035 → ADR.*

### net / http / cross-realm preview

- **Per-request body copied 5–6× across realms** (route-preview.ts:81; preview-bridge-wiring.ts:41-43; preview-port.ts:171-176,431,449): no Transferables. Fix (achievable today): give `CrossRealmPortHandler` an optional `dispatchStruct({url,method,headers,body})` fast-path the real-vite wiring uses, eliminating one O(N) copy + one `arrayBuffer()` drain + one Request rebuild. **Drop the BroadcastChannel transfer claim** — `BroadcastChannel.postMessage` takes no transfer list (the extra arg is silently ignored); copies 4–5 are gated on the M12 MessagePort swap (ADR-0017/0048). *Medium / M / medium — preserve identical handler bytes (e2e m7/m10); the shared wiring was deliberately deduped (devMode + realVite) — don't re-diverge.*

- **Cross-realm streaming reply buffered+concatenated on page side** (preview-port.ts:379-414): worker chunks into ≤64 KiB frames but page copies each chunk into a fresh `Uint8Array` then concatenates all into one buffer before responding — 2× M copy + head-of-line latency. Fix a (ship now): push `frame.data` directly (BroadcastChannel already structured-cloned it — the re-copy at 385-387 is redundant). *Low (one O(M) copy removed) / M / low.* Fix b (real streaming) is a **recorded M12/ADR-0017 decision → decision subagent / superseding ADR, not an inline edit.**

- **Fresh `TextEncoder` per chunk/request** (response.ts:262-265, net.ts:34/121, server.ts:148): covered by the io codec-singleton item — fix at `buffer-codec.ts:25` plus the direct net.ts/server.ts sites. *Low-medium / S / low.*

- **Headers serialized 6+× per request** (request.ts:80; preview-bridge-wiring.ts:38/49; preview-port.ts:130-136/439; route-preview.ts:91/117): mostly load-bearing (each `new Headers` feeds a Request/Response; each `Object.fromEntries` serializes for a structured-clone wire that can't carry Headers). Only safe win: in route-preview.ts skip `new Headers(data.headers)` — do CORP/COEP defaulting on the lowercased record and pass `new Response(body,{headers: data.headers})` directly. **Reject threading the record through `dispatchToPort`** (public `PortHandler(Request)` contract → IRREVERSIBLE). *Low (~1 of 6 walks; path dominated by body clone + channel round-trips) / M / medium.*

- **`new URL(request.url)` twice on one line** (net.ts:120): Fix: parse once, reuse `.pathname`/`.search`. Leave request.ts:77 (one parse already; removing needs the `PortHandler` contract change). *Low / S / low.*

- **http client buffers body into a Blob + fresh encoder per chunk** (server.ts:135-153): Fix: one pre-sized `Uint8Array` (sum byteLengths, alloc once, set at running offset), pass as fetch body; reuse one local encoder; keep empty→undefined. *Low (large uploads) / S / low — `Uint8Array` body is header-equivalent to Blob (neither sets Content-Type).*

- **`IncomingMessage` eager `Object.fromEntries` headers** (request.ts:80,95): Fix: lazy materialize on first read, then `Object.defineProperty(this,'headers',{value,writable:true,enumerable:true,configurable:true})` — **a bare getter breaks Express/proxy middleware that assigns `req.headers = {...}`**. *Low / S / low if done with a writable data property, not a read-only accessor.* The finding's "avoid the second pass" rationale is false — `Object.fromEntries` already iterates once.

### runtime-js core builtins

- **`Promise.prototype.then` patched to wrap every callback for nextTick draining** (process.ts:57-78): 2 closures/`.then` + `drainNextTicks` `shift()` is O(n²). Fix: replace `shift()` with a head-cursor/`splice(0)` O(n) drain (re-check for items appended during flush). **Reject the empty-queue fast-path** — the wrapper is created at `.then()` call time but the drain is needed at fire time; eliding it breaks nextTick-before-then ordering (event-loop.test.ts:29-36, hard rule). *Low (no internal high-frequency nextTick callers; only pathological user code) / M / shift→cursor is zero-semantic; the closure-allocation breadth has no safe elision under the current patch.*

- **`setImmediate`/`clearImmediate` O(n) array ops** (timers.ts:10-50): Fix: `Map<id,item>` for O(1) clear; head-cursor for drain; **snapshot tail at tick entry** so a setImmediate scheduled inside an immediate callback defers to the next tick (Node check-phase). *Low (no evidence of large bursts) / M / high if batching is greedy — add parity cases for nested setImmediate + setImmediate-vs-setTimeout(0) interleaving (none exist) BEFORE any drain-order change.*

## 4. Quick wins (do first — S effort, no ADR)

- [ ] **Codec singletons** in `buffer-codec.ts:25,59` (+ net.ts:34/121, server.ts:148) — keep decoder non-fatal. *(medium)*
- [ ] **`EventEmitter.emit` single-listener fast path** (event-emitter.ts:157) — `return true`, keep slice for len>1. *(medium)*
- [ ] **OPFS `writeFileSync` single shared slice** (opfs-sync.ts:434,438) — verify WASI-aliasing first; gate behind aliasing test if `readFileBytesSync` returns by reference. *(medium)*
- [ ] **Resolver: compute `findPackageScope` once**, pass scope into `detectKind` (resolver.ts:639,658). *(medium)*
- [ ] **`package.json` parse cache**, cleared in `loader.invalidate()` (resolver.ts:594 + 4 sites). *(medium)*
- [ ] **`fs.ts resolvePath` drop outer `normalizePath`** (fs.ts:41). *(low)*
- [ ] **Linker per-package dir-dedup + `Promise.all` writes** (linker.ts:42-47). *(medium)*
- [ ] **`pickBestVersion` linear max-scan** (semver.ts:282-286). *(low)*
- [ ] **net.ts:120 single `new URL`**; **http client `Uint8Array` body** (server.ts:145-153); **lazy writable-data-property headers** (request.ts:80). *(low)*

## 5. Structural bets (L-effort, higher ceiling)

- **Dispatcher `Atomics.waitAsync` responder** (M, high-ceiling prerequisite for moving fs/net onto the ring per A-021). Backstop poll + feature-detect fallback mandatory. → OPEN_QUESTIONS note (softens ADR-0011).
- **Binary-frame discriminator on the SAB reply (proto v1→2)** — kills the JSON byte→string→escape round-trip AND fixes the non-UTF-8 execSync-stdout corruption. (L, ADR-0032 version bump.)
- **npm install bounded-concurrency tarball fetch** — biggest cold-install throughput lever; placement walk stays serial/deterministic. (L, high risk.)
- **Worker pre-warm pool (1–2 fresh workers) + per-spawn env diff** — biggest spawn-latency win; gate on a measured spawn spike. (M–L.)
- **Configurable + smaller-default SAB capacity with chunked escalation / SAB freelist** — memory footprint under high spawn counts. (M, ADR.)
- **Cross-realm end-to-end ReadableStream (preview-port)** — removes the second O(M) concat copy + head-of-line latency, but it's a recorded M12/ADR-0017 decision → decision subagent + superseding ADR.
- **Resolution cache (id/sentinel, full-clear on invalidate, never cache not-found)** + **`transformEsm` result cache** — collapse re-resolution/re-parse on dependency-heavy + editor-save loops. (M each.)

## 6. How to measure (concrete to this codebase)

- **Codec singletons (#1):** counter in `encode`/`decode` utf8 branches counting `new TextEncoder/Decoder` constructions; assert it stays at 2 (the singletons) across a `require('express')` boot. Micro-bench: 1M `Buffer.from('package.json-sized string')` before/after.
- **Dispatcher waitAsync (#8):** in a same-realm harness drive N back-to-back `writeRequest`s with **timers faked/disabled** and assert each `pumpOnce` fires on the notify, not a tick; time 5000 serialized execSync-style round-trips wall-clock and assert the ~2–4ms/call clamp floor is gone (`pumpOnce` is already public for deterministic driving).
- **Resolver double-work (#4,#5,#9):** spy on `vfs.readFileBytesSync`, count `findPackageScope` + `JSON.parse(package.json)` calls during a full `require('express')` / opencode-fixture load; assert (a) each module's scope package.json parses once, (b) a second sibling import from the same package does not re-parse, (c) after `loader.invalidate()` it IS re-read.
- **OPFS double-slice (#3):** count `Uint8Array.prototype.slice` (or wrap `data.slice`) calls during a tarball-extract install; assert 1 per write, not 2. Plus the aliasing regression test (mutate a `readFileBytesSync` result → cache/in-flight write uncorrupted).
- **Binary frame (#2-ipc):** time a SAB round-trip for a 1 MiB execSync stdout reply before/after; add the non-UTF-8 stdout parity case (`Buffer.from([0xff,...])` echoed) asserting byte-exact (currently mangles to U+FFFD).
- **npm fetch concurrency (#10):** instrument the fetch path with a concurrency gauge (max in-flight); assert >1 against a cold live-resolve install of express/vite; assert express-diamond layout identical across repeated runs (determinism) and that two concurrent fetches of the same `(name,version)` dedupe to one network call. **Measure against the real registry path, not FakeRegistry.**
- **EventEmitter (#2):** wrap `Array.prototype.slice` count (or a `slice` counter on the emit path) over a stream pumping 10k chunks through one `'data'` listener; assert ~0 slices post-fix.
- **Linker (#linker):** count `getDirectoryHandle` calls (or `mkdir` invocations) during a multi-dir-package install; assert it drops from O(M·D) to O(K distinct dirs).

## 7. Coverage & gaps

- **Suspected-but-unconfirmed / disputed:** OPFS single-shared-slice (#3) safety hinges on whether `readFileBytesSync` returns the cache buffer **by reference** and whether WASI `fd_write` mutates it in place (cross-cutting report #44 flags HIGH risk, contradicts the vfs-subsystem report's "low risk"). **Resolve before merging** — verify `opfs-sync.ts:421` return and `fd.ts:90-95` mutation path.
- **Not independently re-verified here:** streams microtask-batching event-order claims (writable.ts/readable.ts), the WASI `fd_write` mutation path, the `transformEsm` purity assertion — each needs the cited test suite green as the gate.
- **Production-unverifiable ceilings:** npm fetch concurrency (#10) and cross-realm body-transfer copies 4–5 both depend on infra that does not exist yet — the ADR-0028 Edge Function (never deployed) and the M12 MessagePort transport. Headline magnitudes can't be validated until that infra lands; size conservatively.
- **Hot paths NOT reviewed:** acorn parse + `collectRewrites` AST-walk internals (esm-ast.ts) — heaviest per-module CPU step but only addressed via caching, not algorithmically; `extractTarGz` gzip-inflate/tar-parse (serializes on main thread, erodes any fetch-concurrency win — candidate for worker offload, not covered by any finding); TS-strip transform cost (already cached, not profiled here).
- **Missing parity coverage flagged repeatedly:** binary/non-UTF-8 execSync stdout, int-accessor OOB throws, ascii `& 0x7f` masking, setImmediate/nextTick scheduling order — all must get parity cases added (parity-first hard rule) *before* the corresponding changes land.
