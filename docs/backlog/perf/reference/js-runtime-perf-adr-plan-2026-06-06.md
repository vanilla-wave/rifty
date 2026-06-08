> Companion to rifty-js-runtime-perf-audit.md. Maps every perf-audit action to its required ADR
> work via the CLAUDE.md reversibility checklist; each classification adversarially audited against
> the real ADR text (6 mappers + per-verdict skeptics, 37 agents). 30 verdicts, 0 rejected.
> Generated 2026-06-06.

# Consolidated ADR Change Plan — rifty JS-runtime perf audit

Scope: 30 audit verdicts. New ADRs numbered 0081+ in dependency order (0056-0062, 0074 skipped — unused, not reused). New OPEN_QUESTIONS ids start Q-2026-06-06-319. Verified: highest existing ADR = 0080; highest existing Q = Q-2026-06-05-318.

---

## A. NEW ADRs to ADD

**ADR-0081 — `bytesToString` decode helper on `@riftydev/io` public surface** — covers **#12**; rule1 (cross-package public API), precedent ADR-0029/ADR-0041.
- New export on `packages/io/src/index.ts`, consumed by `runtime-js` `builtins/fs.ts:140-142`.
- Add `bytesToString(bytes, enc): string`; call it in fs text reads to drop the full-buffer `Buffer.from(bytes)` copy. Keep `!encoding → Buffer.from(bytes)` (owned-mutable).
- Prefer re-exporting/aliasing internal `buffer-codec.ts:58 decode(view, enc)` over duplicating (auditor note). No decision subagent.

**ADR-0082 — per-instance cached DataView for Buffer integer/float accessors** — covers **#13**; rule4 (~30 accessors + buffer.ts + OOB parity cases).
- Governs internal accessor impls of cross-package `Buffer` (`buffer-prototype.ts`, `buffer.ts`).
- Lazily-cached full-range DataView; clone-survival preserved; cache keyed via `WeakMap<Uint8Array,DataView>` inside buffer-prototype.ts with **no** buffer.ts type-back import (madge). ADR must note clone-rebuild-on-receiver. No decision subagent.

**ADR-0083 — single-schedule drain (`drainScheduled`) + bounded sync-drain loop for io streams** — covers **#25**; rule4 (writable.ts + readable.ts behavioral rewrite + ordering/backpressure parity cases).
- Governs internal scheduling of `Writable`/`Readable` (private flag; no public shape/state-bag change).
- Collapse N `queueMicrotask` → 1 via `drainScheduled`; sync-drain loop breaking on first async `_write`. Must cite **ADR-0034** as the event-semantics contract it must NOT break (not supersede). No decision subagent.

**ADR-0084 — `normalizePath` already-normalized fast-path + normalized-string path helpers in `@riftydev/vfs`** — covers **#10**; rule4 (multi-file thread-through; byte-identical but blast-radius = every fs syscall + resolver probe).
- Governs body of exported `normalizePath` + new internal `dirnameNormalized`/`basenameNormalized`, threaded into hot callers (opfs-sync, memory backend).
- Single-scan early-return; new helpers stay internal (exporting flips to rule1). Preserves ADR-0037's normalisation invariant (not a supersede). No decision subagent.

**ADR-0085 — `FsSync.statSyncOrNull` — non-throwing stat to collapse existsSync+statSync double-probe** — covers **#11**; rule1 (cross-package public API), precedent ADR-0029/ADR-0041/ADR-0037 ("future evolutions … land in FsSync only").
- Governs cross-package `FsSync` interface (`vfs/src/fs-sync.ts`), implemented in MemoryFsSync + OpfsFsSync, consumed by runtime-js resolver.ts.
- Add `statSyncOrNull(path): {isFile;isDirectory;size?;mtime?} | null` (null-on-any-miss); `statSync` stays throwing for Node parity. Collapse the **7** real double-probe sites in resolver.ts (94,264,281,303,318,424,620 — 292/355 are bare existsSync, excluded). No decision subagent.

**ADR-0086 — carry `ResolvedModule` to execution (`loadResolved`) — drop the second resolve+read+scope-walk** — covers **#14**; rule4 (symmetric impl spans 3 files / >100 LOC; internal deps types not public, rule1 does not fire).
- Governs internal `EsmLoaderDeps`/`CjsLoaderDeps` contract (loader.ts + esm.ts + cjs.ts); public `ModuleLoader` signatures unchanged.
- Add `loadResolved(resolved)` entrypoint; acceptance = registry/cycle guards still fire and `esm:true` vs `esm:false` re-resolve stays equivalent for an absolute id. No decision subagent.

**ADR-0087 — Dispatcher `Atomics.waitAsync` responder + SAB ring capacity + SyncRpc v2 binary frame** *(CONSOLIDATED: #17 + #18 + #19 + #23 — one SAB/sync-IPC wire decision)* — rule1 (`SYNC_RPC_PROTOCOL_VERSION`, `SabRing` documented return contract, both spawn-spec public shapes) + independently rule4.
- Governs SAB ring + SyncRpc wire contract across `kernel` ↔ `runtime-js`: `SabRing` payload return contract, `SYNC_RPC_PROTOCOL_VERSION`, `SpawnWorkerSpec`/`WorkerSpawnSpec.payloadCapacity`, `SyncRpcDispatcherOptions.pollIntervalMs` semantics. One coherent versioned-wire/dispatcher decision avoids four near-simultaneous edits to the same files (sync-rpc.ts, sab-ring.ts, sync-dispatch.ts, spawn-worker.ts, worker-entry.ts, runtime-js handlers.ts).
- Subsections the ADR must record:
  - **#17** `Atomics.waitAsync` arm on REQ_STATE/STATE_IDLE; pump+re-arm on settle; cancel-on-detach; 50-100ms backstop + feature-detect fallback; `pollIntervalMs` redefined to **backstop-only** (cross-package contract-meaning change → rule1).
  - **#18** zero-copy: `readRequest`/`consumeReply` return a SAB **view** not a fresh copy; success path decode-then-flip-IDLE, error/version-mismatch keeps flip-then-throw (ADR-0032 wedge guard); record aliasing constraint (consumer decodes synchronously before slot reuse — already true for both in-package consumers).
  - **#19** thread optional `payloadCapacity` through both spec types; lower `DEFAULT_PAYLOAD_CAPACITY` (1 MiB→e.g. 64 KiB) **only after** an execSync escalation path (larger ring / MessageChannel chunking) exists; both peers must agree.
  - **#23** 1-byte JSON/BINARY frame discriminator; bump `SYNC_RPC_PROTOCOL_VERSION 1→2` (**executes** ADR-0032's pre-authorized forward mechanism — cite, do not supersede); execSync returns raw `Uint8Array` (kills bytes→string→JSON→UTF-8 round-trip; primary justification = non-UTF-8 child-stdout parity correctness fix).
- Cites ADR-0011 (process model, silent on ring size/schedule/copy-vs-view) and ADR-0032 (version mechanism). No decision subagent (nothing overturned; v2 bump is the pre-authorized path).

**ADR-0088 — bounded-concurrency tarball fetch in npm install (placement walk stays serial + deterministic)** — covers **#24**; rule4 (semaphore util + walkAndPin restructure + tests; determinism-vs-throughput invariant worth recording).
- Governs internal concurrency of `npm-client` `installer.ts` (zero-dep hand-rolled semaphore; new util file). Public `install` signature unchanged.
- Parallelize only `fetchAndUnpackToCache`; keep `walkAndPin`/`choosePlacement` serial+request-ordered (express-diamond first-wins layout, pinned by installer.test.ts:269-274 — **never edit the test**; must NOT hoist flat-slot decision before `await source.resolve`). No new dep. No decision subagent.

**ADR-0089 — lazy builtin registration at worker boot — names-only split + deferred execSync handler install (keep sync-require core eager)** — covers **#26**; rule1 downgraded (no signature change) → firmer trigger rule4 (new names-only module + 40-entry barrel restructure + child_process factory move across >2 files). Either way IRREVERSIBLE→NEW_ADR.
- Governs how cross-package builtin surface (`registerBuiltin`/`isBuiltinSpecifier`/`listBuiltins`/`loadBuiltin`, re-exported runtime-js index.ts:4) is wired — **timing**, not signatures.
- Split name-list into names-only module; defer eager `installRuntimeJsExecSyncHandler` into the child_process factory. Hard rule: hot-core builtins (path/util/events/buffer/process/stream/fs/os/crypto) stay statically registered; `loadBuiltin` is on the sync `require()` path and must **never** become async; preserve no-reverse-imports when re-wiring net's `registerBuiltin`. Does NOT supersede ADR-0035 (package boundary, not timing). No decision subagent.

**ADR-0090 — kernel worker pre-warm pool — amortize spawn latency (gated on a measured spawn spike)** — covers **pre-warm** item; rule4 (>100 LOC / >2 files: SAB/port pre-alloc + idle teardown + `isSabIpcSupported` gating + claim handshake).
- New runtime mechanism layered on `spawnKernelWorker` (pool state, ring/channel pre-allocation, idle-evict teardown, capability-gating, claim/init handshake).
- 1-2 never-executed warm workers; identity bound only at claim/init time (preserves ADR-0011 "own realm per process"). Record the **conditional/measured-need gate** (ADR-0064 inflection): design recorded now, build conditioned on a measured spawn spike, separate PR. No decision subagent. *(Auditor corrected the verdict's proposed "0083" → 0090.)*

**ADR-0091 — optional `dispatchStruct({url,method,headers,body})` fast-path on `CrossRealmPortHandler`** — covers **#21**; rule1 (additive method on cross-package-exported interface — "touches", not "breaks"). Does NOT contradict ADR-0043 (BroadcastChannel carrier) / ADR-0048 (frame shape).
- Governs exported `CrossRealmPortHandler` (`net/src/index.ts`), consumed by `apps/playground` preview wiring.
- Optional `dispatchStruct` skips the page→worker `new Request(...)` + `arrayBuffer()` drain + Request rebuild. **Feasibility gap the ADR must record:** today the page reaches the handler only via `dispatchToPort(port, Request)` and holds no `CrossRealmPortHandler` ref / `getHandler` returns base `PortHandler`; the ADR must record the extra plumbing (typed handler handle) since the audit rejects threading the record through `dispatchToPort`. No decision subagent.

**ADR-0092 — setImmediate/clearImmediate queue rep (Map + head-cursor) + check-phase tail-snapshot drain order** *(REASSIGNED from verdict's proposed Q-2026-06-06-319 → NEW ADR per auditor correction)* — covers **#28**; rule1.
- Auditor overturned the mapper's rule5/OPEN_QUESTIONS call (mapper's "module-private / no cross-package API" grounding is stale; **adrRefAccurate=false**). ADR-0018 ratifies `./builtins/timers` as stable public API; tail-snapshot changes the observable contract of a committed cross-package export. Verified consumed by `apps/playground/.../real-vite-bootstrap.ts:62`.
- Governs drain-order contract of cross-package public `setImmediate`/`clearImmediate` (signatures unchanged; observable nested-drain ordering changes).
- `Map<id,item>` for O(1) clear + head-cursor drain; snapshot tail at tick entry so a nested `setImmediate` defers to next check phase (Node parity). Write nested-setImmediate + setImmediate-vs-setTimeout(0) **parity cases FIRST** (parity-first hard rule). Does NOT supersede (ADR-0018 commits the surface, records no drain order). No decision subagent.

---

## B. Existing ADRs to CHANGE (supersede — ADRs are immutable)

**Supersede ADR-0048 "cross-realm preview port frame" (D2 page-buffered clause) → new ADR-0093** — driven by **#22 fix(b)**.
- Contradiction (recorded decision broken): ADR-0048 D2 — *"the page still accumulates and concatenates on end (true end-to-end ReadableStream is M12, ADR-0017). … Page-side worst-case memory is unchanged from the buffered path … the win is worker-side memory + first-byte latency."* ADR-0017 defers `body: ReadableStream<Uint8Array>` to M12; ADR-0055 §Risks: *"the v3 frame bump … is DEFERRED … contradicts ADR-0048 D2 / ADR-0017's M12 deferral. … Do NOT ship v3 under this ratification."* Building real page↔worker streaming now overturns all three deferrals (rule3; rule1 also fires on the versioned wire / `PREVIEW_PORT_FRAME_VERSION` 2→3 bump).
- ADR-0093 formally supersedes **ADR-0048** (owns `PREVIEW_PORT_FRAME_VERSION` + the page-buffered clause), additionally **cites** ADR-0017 (M12 envelope) and ADR-0055 (opencode SSE compat depending on the deferral); aligns with named draft ADR-0060.
- **DECISION-SUBAGENT-REQUIRED ✅** — reconsidering a recorded decision other work depends on (ADR-0063); the subagent reads ADR-0048/0017/0055 + draft 0060 and produces ADR-0093.

*No other audit item's claimed supersede survives.* Every other "contradicts?" check resolved false — all correctly **DOWNGRADED**:
- ADR-0030 (Buffer brand/Symbol.species, not DataView strategy — #13)
- ADR-0034 (stream event semantics, not schedule count — #25)
- ADR-0037 (invites additive FsSync — #11)
- ADR-0011/0032 (silent on / pre-authorize the SAB+SyncRpc changes — #17/18/19/23)
- ADR-0035 (package boundary, not timing — #26)
- ADR-0042/0023 (placement/cache, not fetch seriality — #24)
- ADR-0043/0048 (carrier/shape, not handler signature — #21)
- ADR-0072 (one-copy/async-writethrough, not two-distinct-copies — #3)
- ADR-0004 (resolution algorithm, not caching — #15)
- ADR-0052 (public ModuleLoaderOptions, not internal EsmLoaderDeps — #16)
- ADR-0026 (process.platform, not event-loop drain — #27/28)
- ADR-0018 (timers surface, not drain order — #28, → NEW ADR not supersede)

---

## C. New OPEN_QUESTIONS entries (REVERSIBLE — no ADR)

**Q-2026-06-06-319 — OPFS writeFileSync single shared content-cache/write-through slice + WASI fd_write aliasing gate** — item **#3** (not a supersede of ADR-0072).
- Decision: take one defensive `data.slice()` for both the content cache (opfs-sync.ts:434) and the enqueued write-through (:438), 2N→N copies.
- **Gate (must record + test):** the WASI fd_write in-place-mutation aliasing hazard against by-reference `readFileBytesSync` (opfs-sync.ts:421 / path.ts:118 / fd.ts:92-97) — ship with an aliasing regression test.
- TODO(ADR): `packages/vfs/src/opfs-sync.ts` (writeFileSync body, ~line 434).

**Q-2026-06-06-320 — Loader-internal `package.json` parse cache — key (absolute path) + invalidation** — item **#5**, precedent Q-2026-05-30-202.
- Decision: `Map<string,PackageJson>` on the loader closure routing all four parse sites (readPackageJson + inline JSON.parse in findPackageScope), cleared in `loader.invalidate()` in lockstep with `transformCache` (full-clear on `id===undefined`, per-id delete otherwise).
- Wiring nuance: bridge loader-owned invalidate to resolver-owned parse sites (thread cache into `createResolver` or co-locate). Risk = invalidation coherence (stale type/exports/main).
- TODO(ADR): `packages/runtime-js/src/builtins/resolver.ts` (readPackageJson ~line 594; sites 293/356/425/624).

**Q-2026-06-06-321 — Resolver-internal resolution cache — key, full-clear-on-invalidate, never cache not-found** — item **#15**. Does NOT contradict ADR-0004 (binds algorithm, not caching).
- Decision: memoize `resolveSpecifierToFile` (NOT the `resolve()` boundary — `readResolved` must re-read source fresh) keyed `${esm}\0${fromFile}\0${specifier}` → file-id; **full-clear on ANY invalidate; never cache not-found / never cache PACKAGE_PATH_NOT_EXPORTED throw**.
- Nuance: loader owns the result Map (mirroring transformCache) so the `Resolver` interface stays unchanged.
- TODO(ADR): `packages/runtime-js/src/builtins/resolver.ts` (resolveSpecifierToFile, ~line 167).

**Q-2026-06-06-322 — Per-spawn env/argv sharing — freeze a canonical env vs ship a diff** — item **#20**.
- Decision: share/freeze ONE canonical env object on the spawn-caller side, keeping `WorkerSpawnSpec.env` as `Readonly<Record<string,string>>` and the wire payload (spawn-worker.ts:150-159) byte-identical.
- **Boundary note:** the diff/`{baseEnvId,overrides}` variant would redefine the cross-realm wire shape → flips to rule1/NEW_ADR; out of scope here.
- TODO(ADR): `packages/kernel/src/spawn-worker.ts` (~line 150).

---

## D. TODO(ADR) referencing an EXISTING question

| Item | Attaches to | Note |
|---|---|---|
| **#16** transformEsm result cache + optional `transformEsm?` hook on internal `EsmLoaderDeps` | **Q-2026-05-30-202** (loader-cache family) | Reuse existing `cachedTransform`/wrap-and-inject seam (loader.ts:90-99); 2 files (esm.ts deps field + loader.ts wrap/invalidate), id-keyed, invalidate-coherent. Record only single-id-vs-full-clear coupling + transformEsm purity assumption as a TODO(ADR) keyed to extended Q-202. NOT governed by ADR-0052 (that's *public* ModuleLoaderOptions; EsmLoaderDeps is internal). |

---

## E. NO ADR / NO OPEN_QUESTIONS needed (internal, byte-identical, small)

- **#1** codec singletons (UTF8_ENCODER/UTF8_DECODER hoist, buffer-codec.ts:25,59) — module-private one-shot codecs, byte-identical, decoder stays non-fatal, not re-exported. Leave readable.ts:116 streaming decoder per-stream.
- **#2** EventEmitter single-listener fast path (event-emitter.ts:157) — internal dispatch only; `emit` boolean contract preserved (keep `arr.slice()` for len>1, must `return true`).
- **#4** compute findPackageScope once, pass pkg.type into detectKind (resolver.ts:639/640/658) — both fns module-private (no cross-package consumer), byte-identical.
- **#6** drop redundant outer `normalizePath` on resolvePath relative branch (fs.ts:41) — private fn, provable no-op; do NOT guard inside exported joinPath (45+ callers → IRREVERSIBLE).
- **#7** Linker per-package dir-dedup + Promise.all writes (linker.ts:42-47) — uses existing Vfs methods, byte-identical tree; multi-dir install test is the safety gate.
- **#9** net micro-fixes (net.ts:120 single `new URL`; server.ts:145-153 pre-sized Uint8Array body; request.ts:80 lazy headers as **writable** data property) — three independent one-file byte-identical micro-allocs; gate = Express `req.headers={...}` reassign test (lazy headers MUST be writable, not a getter).
- **#22 fix(a)** drop redundant page-side re-copy, push frame.data directly (preview-port.ts:385-387) — BroadcastChannel already structured-cloned; byte-identical; guarded by existing 5×64 KiB round-trip test.
- **#27** nextTick drain shift()→head-cursor (process.ts:33-44) — module-private array, zero-semantic, ~10 LOC; keep the then-wrapper (no empty-queue elision — breaks nextTick-before-then ordering).
- **ascii-mask** (buffer-codec.ts:72-74, ascii decode `& 0x7f`) — parity-driven correctness fix (Node = single ground truth, not a design fork); internal; ship in its own PR with a **FAILING parity case written first**. Does not contradict ADR-0030.

---

## F. COVERAGE MATRIX

| Audit item | Reversibility | Checklist rule | ADR action | Target | Decision subagent? |
|---|---|---|---|---|---|
| #1 codec singletons | REVERSIBLE | none-internal | NONE | — | No |
| #2 EE single-listener fast path | REVERSIBLE | none-internal | NONE | — | No |
| #12 bytesToString export | IRREVERSIBLE | rule1 | NEW_ADR | **0081** | No |
| #13 Buffer cached DataView | IRREVERSIBLE | rule4 | NEW_ADR | **0082** | No |
| #25 streams single-schedule drain | IRREVERSIBLE | rule4 | NEW_ADR | **0083** | No |
| ascii-mask decode `&0x7f` | REVERSIBLE | none-internal | NONE | — | No |
| #3 OPFS shared write slice | REVERSIBLE | rule5 | OPEN_QUESTIONS | **Q-…-319** | No |
| #6 resolvePath drop outer normalize | REVERSIBLE | none-internal | NONE | — | No |
| #7 Linker dir-dedup + Promise.all | REVERSIBLE | none-internal | NONE | — | No |
| #10 normalizePath fast-path + helpers | IRREVERSIBLE | rule4 | NEW_ADR | **0084** | No |
| #11 FsSync.statSyncOrNull | IRREVERSIBLE | rule1 | NEW_ADR | **0085** | No |
| #4 findPackageScope once | REVERSIBLE | none-internal | NONE | — | No |
| #5 package.json parse cache | REVERSIBLE | rule5 | OPEN_QUESTIONS | **Q-…-320** | No |
| #14 loadResolved | IRREVERSIBLE | rule4 | NEW_ADR | **0086** | No |
| #15 resolution cache | REVERSIBLE | rule5 | OPEN_QUESTIONS | **Q-…-321** | No |
| #16 transformEsm result cache | REVERSIBLE | rule5 | TODO_ADR (existing Q) | **Q-2026-05-30-202** | No |
| #17 dispatcher waitAsync responder | IRREVERSIBLE | rule1 (+rule4) | NEW_ADR | **0087** | No |
| #18 SAB zero-copy view | IRREVERSIBLE | rule1 | NEW_ADR | **0087** | No |
| #19 configurable SAB capacity | IRREVERSIBLE | rule1 (+rule4) | NEW_ADR | **0087** | No |
| #23 SyncRpc v2 binary frame | IRREVERSIBLE | rule1 (+rule4) | NEW_ADR | **0087** | No |
| #20 per-spawn env/argv sharing | REVERSIBLE | rule5 | OPEN_QUESTIONS | **Q-…-322** | No |
| #24 npm bounded-concurrency fetch | IRREVERSIBLE | rule4 | NEW_ADR | **0088** | No |
| #26 lazy builtin loading | IRREVERSIBLE | rule4 (rule1 downgraded) | NEW_ADR | **0089** | No |
| pre-warm worker pool | IRREVERSIBLE | rule4 | NEW_ADR | **0090** | No |
| #9 net micro-fixes (a/b/c) | REVERSIBLE | none-internal | NONE | — | No |
| #21 dispatchStruct fast-path | IRREVERSIBLE | rule1 | NEW_ADR | **0091** | No |
| #22 fix(a) drop page re-copy | REVERSIBLE | none-internal | NONE | — | No |
| #22 fix(b) end-to-end ReadableStream | IRREVERSIBLE | rule3 (+rule1) | SUPERSEDE_ADR | **0093** (supersedes 0048; cites 0017, 0055) | **Yes** |
| #27 nextTick drain head-cursor | REVERSIBLE | none-internal | NONE | — | No |
| #28 setImmediate Map + tail-snapshot | IRREVERSIBLE | rule1 (adrRef corrected) | NEW_ADR | **0092** | No |

All 30 verdicts represented (the four SAB items #17/#18/#19/#23 fold into ADR-0087; #22 splits into a NONE row (a) and a SUPERSEDE row (b)).

---

## G. Sequencing & risks

**Write-before-code** (ADRs that must exist before their implementation PR starts): 0081, 0082, 0083, 0084, 0085, 0086, 0087, 0088, 0089, 0090, 0091, 0092, and the superseding 0093. Reversible items (#3/#5/#15/#20 → Q-319..322; #16 → Q-202 extension) need their OPEN_QUESTIONS entry + TODO(ADR) marker before merge, not before code. NONE items (E) ship immediately.

**Recommended ordering (low → high cross-package risk):**
1. **io-buffer/streams:** 0081 (bytesToString) → 0082 (Buffer DataView) → 0083 (stream drain); plus NONE #1/#2 and the ascii-mask parity-first PR.
2. **vfs/path/fs:** 0084 (normalizePath chokepoint — land before anything depending on path helpers) → 0085 (statSyncOrNull, the FsSync addition both backends implement); plus NONE #6/#7 and Q-319.
3. **module-loader:** 0086 (loadResolved) after 0085; Q-320/Q-321/Q-202(#16) are independent caches; NONE #4.
4. **sync-IPC/kernel:** **0087 = single biggest blast radius** — rewrites SAB wire + SyncRpc v2 + dispatcher across kernel and runtime-js (6 files). Write the consolidated ADR first; #23's v2 bump is a two-peer recompile-at-once moment. Inside the ADR: zero-copy (#18) and waitAsync (#17) are independent of the v2/capacity work and can land first; v2 binary frame (#23) + capacity (#19) ship together.
5. **process/npm:** 0088 (npm concurrency) and 0089 (lazy builtins) are independent; 0090 (pre-warm) is **conditionally built** — record design now, gate build on a measured spawn spike (ADR-0064). Q-322 independent.
6. **net/cross-realm/timers:** NONE #9/#22(a)/#27 ship now. 0091 (dispatchStruct) and 0092 (setImmediate) are independent NEW ADRs. **0093 (#22 fix(b)) last** — the version-bumping streaming upgrade.

**Decision subagent required (exactly one): #22 fix(b) → ADR-0093 superseding ADR-0048.** Per ADR-0063, reconsidering the recorded M12/page-buffered deferral (ADR-0017, ADR-0048 D2, ADR-0055; named draft ADR-0060) — which opencode SSE compat (ADR-0055) depends on — must go through a focused decision subagent reading the existing decisions + draft 0060 and producing the superseding ADR. No other item overturns a recorded decision.

**`adrRefAccurate=false` flags (stale/wrong ADR ref in the audit, corrected here):**
- **#28 (setImmediate):** mapper's grounding ("module-private array / no cross-package API / no ADR governs timers") is **stale** — `./builtins/timers` IS a committed public subpath (verified: package.json:31 + playground real-vite-bootstrap.ts:62 import `installTimerGlobals`) ratified by **ADR-0018**. Reclassified rule5/OPEN_QUESTIONS → **rule1/NEW_ADR 0092**. Caveat for the ADR: the current array impl is already check-phase-correct for nested setImmediate via single-shift-per-postMessage; the tail-snapshot is "preserve correct nesting under a batch-drain rewrite," and the load-bearing trigger is the behavioral-contract change on a public cross-package export, independent of that.
- **pre-warm:** verdict's `adrRefAccurate=false` was a numbering defect (proposed "ADR-0083" while highest existing is 0080). Corrected to **ADR-0090**. Substantive classification (rule4/NEW_ADR, no supersede of ADR-0011) stands.

**Other auditor corrections (numbering/scope, not adrRef-false):** verdicts proposed colliding "0081/0082/0083" labels and a Q-319 for #17/#28/#20 — all reassigned to unique sequential numbers above (#17→0087, #28→0092, #20→Q-322; #11 proposed 0082→0085; #26 proposed 0082→0089; #23 proposed 0083→0087). #11's site count corrected 9→7 (lines 292/355 are bare existsSync, excluded).
