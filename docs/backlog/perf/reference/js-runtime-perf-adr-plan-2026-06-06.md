# ADR Plan (lean) — rifty JS-runtime perf audit

> Re-applied under **ADR-0081** (reversibility rule 4 refined: record decisions, not diffs).
> The size-driven first pass's 12 rule-4 ADRs collapse to **5 new ADRs (+ this meta-ADR + 1 deferred)**;
> the one proposed supersede was reconsidered by a decision subagent (ADR-0063) and **upheld** — no ADR-0087.
> The rest move to CHANGELOG or OPEN_QUESTIONS. Companion to `js-runtime-perf-audit-2026-06-05.md`. Generated 2026-06-06.

## Recording rule (post ADR-0081)

A change needs an **ADR** only if it: (1) changes a cross-package public API / wire contract, (2) adds a dependency, (3) contradicts a recorded ADR, or (4) makes a genuine design choice (new mechanism / observable-behavior change / contested default). Size alone never triggers it. Reversible + behavior-preserving → **CHANGELOG only**. Reversible + a provisional judgment call → **OPEN_QUESTIONS**.

---

## A. ADRs to ADD (5 — all rule 1, real cross-package contract)

| ADR | Title | Audit items | Trigger |
|---|---|---|---|
| **0082** | `bytesToString(bytes, enc)` on the `@riftydev/io` public surface (drop the full-buffer copy in fs text reads) | #12 | rule1 — new `io` export consumed by runtime-js |
| **0083** | `FsSync.statSyncOrNull` — non-throwing stat to collapse `existsSync`+`statSync` double-probe (7 resolver sites) | #11 | rule1 — method on the shared `FsSync` interface (precedent ADR-0029/0041) |
| **0084** | SAB ring + SyncRpc **v2** wire: `Atomics.waitAsync` responder, zero-copy view, configurable payload capacity, 1-byte JSON/BINARY frame discriminator | #17 #18 #19 #23 | rule1 — `SabRing` return contract, `SYNC_RPC_PROTOCOL_VERSION` 1→2, both spawn-spec shapes. Cites ADR-0011 (silent on these) + ADR-0032 (executes its pre-authorized version bump — not a supersede) |
| **0085** | `setImmediate`/`clearImmediate` queue rep (Map + head-cursor) + check-phase tail-snapshot drain order | #28 | rule1 — `./builtins/timers` is a committed public subpath export (ADR-0018); pins drain-order contract. Parity cases FIRST |
| **0086** | optional `dispatchStruct({url,method,headers,body})` on `CrossRealmPortHandler` (skip Request rebuild + body re-drain) | #21 | rule1 — additive method on a cross-package-exported interface. *(Request/preview path, not core VM — lower priority)* |

> Note: **0084** is the biggest blast radius — it rewrites the SAB wire across kernel ↔ runtime-js (6 files); the v2 bump is a two-peer recompile-at-once moment. Inside it, zero-copy (#18) and waitAsync (#17) are independent and can land before the v2 frame (#23) + capacity (#19).

## B. ADR to CHANGE — supersede: NONE (decision subagent ran → upheld)

The only candidate was **#22 fix(b)** (end-to-end page↔worker `ReadableStream`, which would supersede ADR-0048 and bump `PREVIEW_PORT_FRAME_VERSION` 2→3). A decision subagent (ADR-0063) reconsidered it on 2026-06-06 and **UPHELD the deferral** — no ADR-0087 written. Reasons: the transport real streaming needs (MessagePort) doesn't exist yet (both bridge ends still on `BroadcastChannel` → no backpressure); ADR-0055 explicitly forbids shipping v3; the benefit is "low"/production-unverifiable and the only large-stream consumer (opencode `/event`) already streams via the page-direct path. Recorded as **Q-2026-06-06-323** with three concrete overturn triggers (see §D). `#22 fix(a)` (drop the redundant page-side re-copy, no frame change) proceeds regardless → CHANGELOG.

## C. ADR — DEFERRED (1, build-gated)

| ADR | Title | Item | Note |
|---|---|---|---|
| **0088** | kernel worker pre-warm pool (1–2 never-executed warm workers) | pre-warm | rule4-new (genuine new mechanism: pool size / eviction / claim-handshake alternatives). Record the **design** when built; build gated on a measured spawn spike (ADR-0064 inflection). |

## D. New OPEN_QUESTIONS (5 — reversible + a provisional judgment call)

| Q-id | Title | Item |
|---|---|---|
| **Q-2026-06-06-319** | OPFS `writeFileSync` single shared cache/write-through slice **+ WASI `fd_write` aliasing gate** | #3 |
| **Q-2026-06-06-320** | Loader `package.json` parse cache — key (abs path) + invalidation (clear in `loader.invalidate()`) | #5 |
| **Q-2026-06-06-321** | Resolver resolution cache — key, full-clear-on-invalidate, **never cache not-found** | #15 |
| **Q-2026-06-06-322** | Per-spawn env/argv — freeze a shared canonical env vs ship a diff | #20 |
| **Q-2026-06-06-323** | When to overturn the page-buffered cross-realm preview deferral (decision subagent: **upheld**; 3 triggers) | #22b |

## E. TODO(ADR) → existing question

| Item | Attaches to |
|---|---|
| #16 `transformEsm` result cache + optional `transformEsm?` hook on internal `EsmLoaderDeps` | **Q-2026-05-30-202** (loader-cache family) |

## F. CHANGELOG only (behavior-preserving, contract-stable — no ADR, no OPEN_QUESTIONS)

These were the rule-4-by-size ADRs that ADR-0081 demotes, plus the already-internal micro-fixes. Each rides its package CHANGELOG, citing the perf-audit doc.

- **#13** Buffer per-instance cached `DataView` for int/float accessors *(same values, same OOB throws)*
- **#10** `normalizePath` already-normalized fast-path + internal `dirnameNormalized`/`basenameNormalized` *(byte-identical; helpers stay internal — exporting them would flip to rule1)*
- **#14** `loadResolved` — carry the resolved module, drop the second resolve+read+scope-walk *(same resolution result)*
- **#26** lazy builtin registration *timing* + names-only split *(no observable change; hard constraint — sync-`require()` core stays eager — as a code comment)*
- **#25** stream single-schedule drain (`drainScheduled`) + bounded sync-drain loop *(behavior-preserving by intent; full stream + backpressure parity suite is the gate)*
- **#24** npm bounded-concurrency tarball fetch *(same dependency tree; invariant — placement walk stays serial/deterministic, `installer.test.ts` first-wins — as a code comment + test; zero-dep semaphore)*
- **#1** codec singletons · **#2** EventEmitter single-listener fast path · **#4** `findPackageScope` once · **#6** `resolvePath` drop outer normalize · **#7** linker dir-dedup + `Promise.all` · **#8** `pickBestVersion` linear max-scan (semver) · **#9** net micro-fixes (single `new URL`, `Uint8Array` body, lazy writable headers) · **#22a** drop redundant page-side re-copy · **#27** nextTick drain `shift()`→head-cursor
- **char-by-char decode** (`buffer-codec.ts:63-84`) batched `String.fromCharCode.apply` · **`readdirSync`** per-call sort+rebuild cache *(both low-value folds from the audit synthesis, kept for completeness)*
- **ascii-mask** — `toString('ascii')` missing `& 0x7f` *(parity-driven correctness fix; own PR with a FAILING parity case first)*

---

## G. Coverage matrix (all 33 distinct actions)

| Item | Recording | Target |
|---|---|---|
| #12 bytesToString | ADR | 0082 |
| #11 statSyncOrNull | ADR | 0083 |
| #17 waitAsync responder | ADR | 0084 |
| #18 SAB zero-copy view | ADR | 0084 |
| #19 configurable SAB capacity | ADR | 0084 |
| #23 SyncRpc v2 binary frame | ADR | 0084 |
| #28 setImmediate drain-order | ADR | 0085 |
| #21 dispatchStruct fast-path | ADR | 0086 |
| #22b end-to-end ReadableStream | OPEN_QUESTIONS (decision subagent → upheld) | Q-…-323 |
| pre-warm worker pool | ADR (deferred) | 0088 |
| #3 OPFS shared slice + aliasing | OPEN_QUESTIONS | Q-…-319 |
| #5 package.json parse cache | OPEN_QUESTIONS | Q-…-320 |
| #15 resolution cache | OPEN_QUESTIONS | Q-…-321 |
| #20 per-spawn env sharing | OPEN_QUESTIONS | Q-…-322 |
| #16 transformEsm cache | TODO(ADR) | Q-2026-05-30-202 |
| #13 Buffer DataView | CHANGELOG | — |
| #10 normalizePath fast-path | CHANGELOG | — |
| #14 loadResolved | CHANGELOG | — |
| #26 lazy builtins | CHANGELOG | — |
| #25 stream drain | CHANGELOG | — |
| #24 npm concurrency | CHANGELOG | — |
| #1 codec singletons | CHANGELOG | — |
| #2 EE fast path | CHANGELOG | — |
| #4 findPackageScope once | CHANGELOG | — |
| #6 resolvePath | CHANGELOG | — |
| #7 linker dir-dedup | CHANGELOG | — |
| #8 pickBestVersion linear max | CHANGELOG | — |
| #9 net micro-fixes | CHANGELOG | — |
| #22a page re-copy | CHANGELOG | — |
| #27 nextTick head-cursor | CHANGELOG | — |
| char-by-char decode | CHANGELOG | — |
| readdirSync sort cache | CHANGELOG | — |
| ascii-mask | CHANGELOG | — |

**Tally:** 5 new ADRs · 0 supersede (1 reconsidered → upheld) · 1 deferred ADR · 5 new OPEN_QUESTIONS · 1 TODO(ADR) · 21 CHANGELOG-only = **33 distinct actions**.
Down from the first pass's **12 new ADRs + 1 supersede**. The 48→33 shrink is dedup (~13 cross-reviewer duplicates) + a few low-value folds; #8 was an accidental drop now restored. ADR-0032's mandatory per-frame version-validation was correctly NOT removed (one of the 4 verification drops).

## H. Delta vs the size-driven first pass

Demoted from NEW_ADR → CHANGELOG by ADR-0081 (rule 4 no longer fires on size): Buffer DataView (was 0082), normalizePath (0084), loadResolved (0086), lazy builtins (0089), stream drain (0083). npm-concurrency (was 0088) → CHANGELOG (behavior-preserving tree; invariant as code comment). Everything that hits a real cross-package contract, a recorded-ADR overturn, or a genuine new mechanism is kept.
