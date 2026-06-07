# Backlog — honest browser / COI test coverage

A **pull backlog** for test coverage that only a REAL cross-origin-isolated browser can give — the gap class where **Node passes but a real COI Worker throws**. Seeded by the `#test=execsync` honest e2e (ADR-0087) and a read-only adversarial sweep (2026-06-07).

- **IDs:** `BT-n`. **Status:** `done` · `accepted` (agreed, not built) · `idea` · `deferred`. **Size:** S/M/L.
- `reuse-harness` = builds on `apps/playground/src/execsync-harness.ts` (`#test=execsync`) + the page-realm `installRuntimeJsExecSyncHandler` wiring.

## Why this exists (the bug class)

The honest COI-Worker e2e immediately caught a **Node-invisible** bug: SyncRpc `decodeReply/decodeRequest` ran `TextDecoder.decode` on a **SharedArrayBuffer-backed view** (the ring returns a deliberate zero-copy view, ADR-0084 #18). Fixed in ADR-0087 (consumer-side `body.slice()` copy).

Two honest corrections from the sweep:
- **Not engine-specific.** Rejecting a shared-backed view in `TextDecoder`/`crypto.subtle`/transfer/`Blob` is WHATWG-spec in **all three engines**; **Node is the lax outlier**. Firefox + WebKit would hit it too. The `.slice()` fix is engine-independent.
- **#18 "zero-copy" is largely unrealizable in a browser.** The ring view is genuinely zero-copy, but every browser consumer MUST copy before a rejected op → the optimization's benefit doesn't materialize, and it introduced the (now-fixed) bug. Candidate ADR-0084 footnote/supersede if revisited.

## Sweep verdict

**No live sibling bug.** Every production consumer that feeds a browser-rejected op is downstream of a copy (`Buffer.from` always copies; recursive-runner/net concat into fresh buffers; `crypto.subtle` on tarballs takes fetch/VFS bytes; the 3 stdio `postMessage(transfer)` paths copy first). The **systemic risk is structural**: the protective copy lives at EACH consumer (not at the ring), so a future consumer that forgets it re-introduces the exact bug and **passes Node CI**.

## Items

### Top ROI
- **BT-1 — shared-view guard (closes the whole class).** `accepted · S-M`. A `detachIfShared(view)` helper (returns `view` if not shared, else `view.slice()`) applied at every `TextDecoder.decode` / `crypto.subtle.*` / `postMessage(transfer)` / `new Blob` / OPFS `createSyncAccessHandle.write|read` boundary that can see a ring/wasm-memory view, **plus a CI grep** flagging a raw decode/transfer of a known-shared source. Cheaper than per-behavior e2es; the load-bearing invariant otherwise lives only in reviewers' heads. *(NB: the ring intentionally returns a zero-copy view — the guard belongs at consumers.)*
- **BT-2 — JSON-reply assertion on the existing harness.** `idea · S · reuse-harness`. Extend `execsync-sab.spec` to also assert a UTF-8 JSON reply round-trips, exercising `decodeUtf8FromMaybeShared`'s `body.slice()` in a real COI Worker (regression guard for ADR-0087's fix). Near-zero cost.

### High — real-browser SAB/Worker paths (Node-only / `skipIf(!sabReady)` today)
- **BT-3 — `child_process.spawn` over SAB-Worker.** `idea · M · reuse-harness`. stdout bytes byte-exact + exit-code-1-on-throw. Mirrors `child_process-worker.test.ts` (skipped in Node).
- **BT-4 — `ChildProcess.stdin` IPC over SAB-Worker.** `idea · M · reuse-harness`. parent `write`+`end` → child stdin MessagePort → echo; proves `bindPortAsWritable` across a real Worker boundary (`child_process-stdin.test.ts` is the Node skip).
- **BT-5 — dispatcher `Atomics.waitAsync` edges (ADR-0084 #17).** `idea · M · reuse-harness`. detach-cancels-pending, missed-notify backstop recovery, back-to-back re-arm, async-handler defer — under REAL browser scheduling. **The most genuinely-unobservable-in-Node gain** (Node unit only has the huge-backstop stand-in; the harness today does one happy round-trip).

### Medium
- **BT-6 — fork-mode IPC (ADR-0045).** `idea · M`. `send`/`'message'` round-trip + auto-disconnect-on-exit + explicit disconnect over the parent↔child MessagePort. New `#test=fork` page (cleaner than overloading execsync).
- **BT-7 — `worker_threads` real kernel-spawned realm.** `idea · M · reuse-harness`. `parentPort` both directions + `workerData`; crucially assert **no same-realm fallback** fired.
- **BT-8 — #21 `dispatchStruct` preview fast-path + #22a re-copy drop.** `idea · M`. FIRST verify whether `m7-preview-sw.spec` actually exercises the struct path (realVite passes the typed bridge) or only the `dispatchToPort(Request)` fallback; then a `#test=preview-struct` harness over a real page↔Worker BroadcastChannel.
- **BT-9 — OPFS real round-trip.** `idea · M`. #3 single-slice `fd_write` aliasing + #vfs-readdir dirent kind-flip against a real `createSyncAccessHandle` (Worker-only API) — the Node fake can't exercise real in-place fd reuse / by-reference reads. Inside a Worker realm.

### Low / deferred
- **BT-10 — #19 configurable SAB capacity two-peer.** `idea · S · reuse-harness`. Non-default `payloadCapacity` through `spawnWorker`; assert agreement + in-bounds/too-large at the real boundary.
- **BT-11 — WASI shared-memory-guest hardening.** `deferred · S`. `runtime-wasi/fd.ts:79` + `shared.ts:220` `TextDecoder.decode` directly over wasm memory — SAFE today (esbuild Go WASIp1 = non-shared memory), but a latent browser bug the instant a threaded/`shared:true` wasm guest lands. Mitigation: `subarray`→`slice` before decode, or assert `!(memory.buffer instanceof SharedArrayBuffer)` at memory-bind. `TODO(ADR)` — gate on a shared-memory guest actually existing.
- **BT-12 — one-off `test:e2e:all` diagnostic.** `idea · S`. Run firefox+webkit ONCE; record per-engine facts into `docs/compat` (expected: webkit COEP:credentialless / COI wall per D-006; firefox = the real signal). Keep PR path chromium-only; do NOT gate on it.

## Recommended first pull
**BT-1 + BT-2 + BT-5** (+ BT-12 once): closes the bug class with a guard, gives the fix a real-browser regression test, and covers the single most Node-invisible path (`waitAsync` timing) — for the least effort. The rest is a pull-when-worth-it tier of new harnesses.
