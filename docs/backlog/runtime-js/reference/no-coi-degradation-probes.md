# No-COI degradation probes — same guest source, both worlds (2026-08)

Provenance: spike `prototype/no-coi-agent-loop` (throwaway branch
`t3code/prototype-no-coi-agent-cycle`, `src/degradation-probes.ts` +
FINDINGS.md §5c). Branch artifacts rot (declined-concepts row) — the observed
table is inlined here as the durable record; re-verify claims against current
main before building on them.

Worlds: **product (COI)** = kernel-spawned worker child over SAB sync-RPC;
**no-COI** = same-realm fallback (`spawnViaSameRealm`, no SAB /
`kernelWorkerUrl`).

| probe | no-COI (same-realm) | product (COI) | verdict |
|---|---|---|---|
| `execSync('node --version')` | `NotImplementedError` naming SAB/COI | mechanism alive (probe passed a flag, not a script) | honest loud gap in no-COI |
| `spawn('node',['-e',…])` | close=1, stdout `""`, stderr internal `VfsError: ENOENT: /proj/-e` | close=1, stdout `""`, `Cannot find module '/-e'` | not a COI issue — `-e` via spawn unsupported BOTH worlds; internal error leaks instead of Node's (CLI-eval family: `node-cli-*` drafts) |
| `spawn('node',['./file.js'])` | **close=0, stdout `""`** — output printed to parent realm console | close=0, stdout `"2"` | SILENT WRONG in no-COI → `same-realm-spawn-stdio-pipe-drop` |
| `worker_threads.Worker(file)` | exit=0 + warn-once (no real parallelism) | `NotImplementedError: worker_threads.Worker.execArgv` | no-COI better → evidence on `worker-threads-inherited-exec-argv` |
| `child_process.fork` + IPC | exit=0, `ipc={"hi":1}` | **hung >45 s**, needed interrupt | no-COI better → `coi-fork-ipc-hang` |
| `os.cpus().length` | 12 (host) | 12 (host) | faithful to host; under no-COI a 12-worker pool shares ONE event loop — throughput cliff, tier-decision input, not a defect |

Also observed (same spike): without COI Chromium defines no
`SharedArrayBuffer` global at all — bare references throw `ReferenceError`
(`worker-realm-compat-bare-sab-referenceerror`).

Tier-decision surprises: COI is NOT uniformly the capable tier —
`fork`/`worker_threads` complete in no-COI and break under COI. Any no-COI
capability plan must account for `spawn` NOT warning (the settled
warn-once+capability-report plan covered `worker_threads` only).

## 2026-08-29 — real no-COI Chromium 148 realm probe (bare-sab-guard re-cut)

REPLAYABLE — one command regenerates every row from the real built shim:
`node tools/probes/no-coi-realm-probe.mjs`. Raw output committed:
`no-coi-realm-probe-transcript-2026-08-29.json` (this dir). Mechanism (the
committed driver, formerly a disposable spike): esbuild of the REAL prod
sources (`ipc/worker-realm-compat.ts`, `builtins/util-types.ts`, the kernel
PUBLIC entry `kernel/src/index.ts` + `kernel/src/worker-stdio-drain.ts`
bundled); page + dedicated MODULE Worker served
by `tests/no-coi/server.mjs` (plain `node:http`, NO COOP/COEP); probe body
`tests/no-coi/fixtures/probe-lib.mjs` (same body the no-COI substrate lane
runs); Playwright `chromium.launch()` — **Chromium 148.0.7778.96**. Results
IDENTICAL in page and Worker realms (transcript keys `page-*`/`worker-*` ×
`direct`/`aggregate` install). Oracle column: **node v24.16.0** — same probe
body, transcript `nodeOracle.binding-intact-direct`; absent-binding sim =
`nodeOracle.binding-deleted-direct` (`delete globalThis.SharedArrayBuffer`).

| # | check (both realms) | Chromium 148 no-COI | node v24.16.0 |
|---|---|---|---|
| 1 | `crossOriginIsolated` / `typeof SharedArrayBuffer` | `false` / `'undefined'` | — (binding present) |
| 2 | `new WebAssembly.Memory({initial:1,maximum:1,shared:true})` | constructs; `.buffer` brand `[object SharedArrayBuffer]`, `instanceof ArrayBuffer` → `false` | constructs |
| 3 | NATIVE `decode(new Uint8Array(mem.buffer,3,5))` AND `decode(new DataView(mem.buffer,3,5))` ("hello" bytes at offset 3; transcript `native.sharedView`/`native.sharedDataView`) | `TypeError: Failed to execute 'decode' on 'TextDecoder': The provided ArrayBufferView value must not be shared.` (both view classes) | `"hello"` (both view classes) |
| 4 | NATIVE `decode(mem.buffer)` (raw shared wasm buffer) | `TypeError: … parameter 1 is not of type 'ArrayBuffer'.` | whole buffer EXACT: `{length: 65536, sha256: c0a9261ddb870cc7bec7a6a90e0f766b574bea8f741797e448ab112e73e0af4f}` (U+0000s, U+FFFD sentinels, "hello" at [3,8)) |
| 5 | NATIVE `decode(encode('hello'))` / `decode()` | `"hello"` / `""` | same |
| 6 | streaming: `é` (0xC3,0xA9) split across two shared-wasm views, ONE decoder, `{stream:true}` then final | native rejects shared (row 3) | `"é"` (first part `""`) |
| 7 | built shim: `installSharedMemoryTolerantTextDecoder()` | `true`; `TextDecoder.prototype.decode.__riftyShared === true` | same |
| 8 | patched `decode(bytes)` / `decode()` / shared-wasm Uint8Array view / DataView / raw buffer / streaming | ALL `ReferenceError: SharedArrayBuffer is not defined` | works (binding present — 'hello'/''/'hello'/'hello'/row-4 digest/'é'); node-sim `delete globalThis.SharedArrayBuffer` → same ReferenceError |
| 9 | `installWorkerRealmCompat()` → `global === globalThis`; `self = globalThis` assignment | `true`; assign ok, `self === globalThis` | — |
| 10 | built util-types: `isSharedArrayBuffer(new ArrayBuffer(1))` / `isAnyArrayBuffer(…)` | `false` / `true`, no throw | same — REAL `node:util/types`, same inputs (transcript `utilTypesNative`; binding intact AND deleted) |
| 11 | built util-types on shared wasm buffer: `isSharedArrayBuffer` / `isAnyArrayBuffer` | `true` / `true`, no throw | same — REAL `node:util/types` (transcript `utilTypesNative`) |
| 12 | kernel PUBLIC entry (bundled `kernel/src/index.ts` — a removed export fails here): `createSabRing()`, `spawnKernelWorker()`, plus retained private `createWorkerOutputState()` (`worker-stdio-drain.ts:119`, bundled `worker-stdio-drain.ts`); a counting `Worker` constructor wraps the sweep — the driver fails LOUD on any nonzero count | ALL `ReferenceError: SharedArrayBuffer is not defined` with `workerConstructions: 0` per call — `spawnKernelWorker` PROVABLY dies at its FIRST constructor (`spawn-worker.ts:395`) before any Worker exists (transcript `kernelPublicEntry`) | — |
| 13 | poisoned binding: `SharedArrayBuffer` redefined as a counting+throwing accessor AFTER install, then the full patched-decode sweep of row 8 (transcript `poisonedBinding`, all four realm×install combos) | count **6** — EVERY class trips `POISON: bare SharedArrayBuffer binding evaluated`; contract target after fix: count 0, outputs of rows 5–8 intact | count 6 (binding intact AND deleted sims — same patched body) |
| 14 | mixed install sequence (direct-mode realms): direct helper install FIRST, then the realm's FIRST `installWorkerRealmCompat()` — snapshot immediately (transcript `mixedDirectThenAggregate`) | decoder identity kept (`=== captured` patched fn), marker, `global` alias, own-writable-data `self` all `true`; `decode(bytes)` `ReferenceError` (today) — an aggregate early return keyed on the decoder marker would skip global/self here | decoder identity + siblings same; decode `"hello"` (binding-deleted sim: same ReferenceError) |
| 15 | non-shared sibling classes through the REALM decoder, both install modes: `decode(new DataView(bytes('hello').buffer))` / `decode(bytes('hello').buffer)` (transcript `patched.privDataView`/`patched.privArrayBuffer`) | `ReferenceError` (today; target `"hello"` each) | `"hello"` each |
| 16 | response-header provenance: `fetch` of EVERY substrate response class — document `/index.html`, worker script, probe module, built shim + util-types bundles (transcript `responseHeaders`) | status 200 with BOTH `cross-origin-opener-policy` AND `cross-origin-embedder-policy` ABSENT on every class; the probe body fails LOUD on any present header — derived `crossOriginIsolated === false` alone passes a COOP-only/COEP-only server | — (oracle runs skip the fetch sweep, `requireNoCoi: false`) |
| 17 | ordered exact-call log, BOTH real install carriers (direct = injected logging class; aggregate = realm decoder swapped to an UNMARKED logging original, then `installWorkerRealmCompat()` re-patches over it) × full class set: priv view/DataView/ArrayBuffer, no-arg, shared view/DataView/raw, streaming (transcript `exactCallLog.direct`/`.aggregate`) | `ReferenceError` before the original is EVER invoked (today, both carriers, all four realm×install combos) | EXACTLY one original call per decode, in order; priv classes + no-arg pass the SOURCE object through; every shared-source call carries a private `[object ArrayBuffer]` copy — never the source — bytes exact (raw row `{length: 65536, sha256: 167c274d…}`), opts object exact, unique `log-N` sentinel returns unchanged |
| 18 | fresh-TypeError first-error sweep, EVERY shared class — shared view / DataView / raw buffer / streaming `{stream:true}` (transcript `identity.errorFirstShared`) | `{first: false, throwCount: 0}` each (patched decode dies on the bare binding before the original throws) | `{first: true, throwCount: 1}` each — a native-first wrapper retrying only on `TypeError` passes the generic-Error row, and a Uint8Array-only row misses a DataView/raw/streaming retry branch |

Kills the 2026-08-26 frozen assumption "nothing can be shared in a SAB-less
realm": Chromium does NOT gate shared `WebAssembly.Memory` on COI — shared
BufferSource EXISTS in no-COI pages and Workers; only the `SharedArrayBuffer`
global binding is absent. A no-op TextDecoder guard would leave native decode
throwing (row 3) where Node decodes.

Parity 6–9 evidence rows (same transcript, per realm/oracle):
`firstInstall`/`repeatDirectReturned`/`repeatIdentity` — repeat install
returns `false` AND `proto.decode` strictly `===` the first patched fn (row 7
strengthened past booleans); `afterFirstInstall` (aggregate rows) — sibling
effects snapshot IMMEDIATELY after call ONE: marker, global alias, `self`
pre-write value + `Object.hasOwn` + writable-data descriptor, then assignment,
then a decode (today: siblings green, decode ReferenceError);
`patched.sharedView`/`patched.sharedDataView`/`patched.rawShared` over a
sentinel-laid shared wasm buffer ('hello' at offset 3, 0xFF elsewhere) — Node
oracle decodes EXACTLY the view bytes ('hello' per view class; raw buffer
length+SHA-256 above — projections dropped checkpoint 3); `identity.*` — spy
decoder receives the EXACT input/opts objects AND its UNIQUE per-call sentinel
comes back unchanged (fabricated-output wrappers fail); error identity: a
sentinel propagates as the SAME object, and on SHARED-wasm input a
fresh-error-per-call decoder proves the propagated error is the FIRST thrown
with throw count EXACTLY 1 (`identity.errorIdentitySharedFirst` — a
try-native/catch/copy-retry wrapper throws twice and propagates the second;
Node oracle `{first: true, throwCount: 1}`; Chromium no-COI today
ReferenceError → `{first: false, throwCount: 0}` — flips with the fix).

Blast-radius observation (driver development, Node absent-binding sim): after
install the patched decode poisons the HOST's own decodes too — Node's ESM
loader crashed loading the NEXT module (`import()` → TextDecoder →
ReferenceError). "EVERY decode in the realm" includes loader/infra decodes,
not just guest calls.
