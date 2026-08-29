---
area: runtime-js
status: ready
title: worker-realm-compat TextDecoder shim throws ReferenceError in realms without SharedArrayBuffer
created: 2026-08-26
why: without COI Chromium defines NO `SharedArrayBuffer` global; the shim's bare references make EVERY decode() in that realm throw ReferenceError — crashes unrelated code paths in the no-COI tier
user_story: As a dev on the no-COI fallback tier, I want TextDecoder to keep working, but today `installSharedMemoryTolerantTextDecoder`'s patched decode references bare `SharedArrayBuffer` and throws `ReferenceError` on every call in a realm where the global is absent.
epic: no-coi-sandbox-tier
sources: [docs/backlog/runtime-js/reference/no-coi-degradation-probes.md]
code: [packages/runtime-js/src/ipc/worker-realm-compat.ts, packages/runtime-js/src/ipc/install-process.ts]
---

## Context

`installSharedMemoryTolerantTextDecoder` patches `TextDecoder.prototype.decode`
with a body referencing `SharedArrayBuffer` bare (worker-realm-compat.ts:75,80).
`installNodeRuntime` (install-process.ts:117) runs it unconditionally in every
Node realm. No-COI Chromium defines no `SharedArrayBuffer` global at all
(spike-observed, probes record) → every `decode()` after install throws
`ReferenceError` — including no-arg `decode()` (line 80 path). Nothing can be
shared in such a realm, so the correct behavior is a no-op install. A verified
guard existed as a spike patch (throwaway branch, not carried over) — it landed
without a RED test; the fix re-lands failing-test-first (repo rule: no fix
without its regression test). Realm-sensitivity class:
`toolchain-build/worker-realm-conformance-harness` (tested-realm ≠ ships-realm).

Repro from real source (node v24.16.0, worktree 2026-08-29):

```
npx esbuild packages/runtime-js/src/ipc/worker-realm-compat.ts --format=esm --outfile=/tmp/wrc-spike.mjs
node --input-type=module -e 'delete globalThis.SharedArrayBuffer;
  const m = await import("/tmp/wrc-spike.mjs");
  class Dec { decode(i){ return i === undefined ? "" : "decoded"; } }
  console.log("install:", m.installSharedMemoryTolerantTextDecoder(Dec));
  new Dec().decode(new Uint8Array(3));'
# → install: true
# → ReferenceError: SharedArrayBuffer is not defined
# same with no-arg new Dec().decode()
```

## Acceptance

- RED-first in a real no-COI Chromium context — page served with no COOP/COEP;
  test asserts `crossOriginIsolated === false` AND
  `typeof SharedArrayBuffer === 'undefined'` before acting, and exercises the
  real built shim (not a source copy). This page/harness is the goal's first
  no-COI test substrate, reusable by later slices.
- After `installWorkerRealmCompat()` in that realm:
  `new TextDecoder().decode(new TextEncoder().encode('hello'))` → `'hello'`,
  `new TextDecoder().decode()` → `''`. On current main both throw
  `ReferenceError` (artifact above).
- `installSharedMemoryTolerantTextDecoder` there returns `false` and leaves
  `TextDecoder.prototype.decode` untouched (no `__riftyShared` marker).
- COI behavior unchanged: existing shared-copy / pass-through / idempotence
  unit tests (`worker-realm-compat.test.ts`) stay green unmodified.
- Approximation rejected: stubbing `SharedArrayBuffer = undefined` in a
  COI/Node realm does NOT satisfy the RED (a stubbed binding gives
  `instanceof undefined` TypeError, not the absent-binding ReferenceError);
  the RED must run in the real no-COI browser realm.

## Parity cases

Oracle: native no-COI Chromium `TextDecoder` (nothing shared can exist there —
unpatched native decode is exact). Each row a failing-test-first target unless
marked green.

1. no-COI realm, `decode(bytes('hello'))` → `'hello'`; today `ReferenceError:
   SharedArrayBuffer is not defined` — artifact: Context repro, node v24.16.0.
2. no-COI realm, `decode()` (no arg) → `''`; today same ReferenceError via
   line 80 `input instanceof SharedArrayBuffer` — artifact: same run.
3. no-COI realm, `installSharedMemoryTolerantTextDecoder(Dec)` → `false`, no
   patch; today `true` + patch — artifact: same run, `install: true`.
4. no-COI realm, `util.types.isSharedArrayBuffer(new ArrayBuffer(1))` →
   `false`, `isAnyArrayBuffer(...)` → `true`, no throw — GREEN already (type
   positions erase; see Decisions); pin in the same substrate.
5. COI/SAB realm: shared-backed view decodes via private copy; second install
   → `false` — existing green tests, unmodified.

## Fault matrix

| axis × operation | honest outcome | fault target |
|---|---|---|
| realm lacks SAB global × install/decode | install → `false`, prototype untouched; native decode fully faithful (no shared input physically possible: Chromium gates SAB and wasm shared memory on COI) | no-COI browser RED (rows 1–3) |
| realm has SAB, decoder rejects shared views (older Chromium) × decode(shared view) | copy-into-private path, same bytes | existing unit test |
| realm has SAB × decode(non-shared) | pass-through unchanged | existing unit test |

## Out of scope

- No warn and no capability-report row for the no-op install — nothing is
  degraded (see Fault matrix row 1); the capability report surface is the
  `build-loop` slice.
- Kernel `new SharedArrayBuffer` sites (`worker-stdio-drain.ts:119`,
  `sab-ring.ts:136`) — worker-spawn path only, behind `isSabIpcSupported()`
  `typeof`-gate (`kernel/src/ipc/capabilities.ts`); unreachable no-COI;
  unchanged.
- `execSync`/`spawnSync` loud `NotImplementedError` naming SAB/COI — stays
  (map Out of scope).
- Other no-COI degradations (spawn stdio pipe, cpus→1, worker_threads
  warn-once) — sibling slices.

## Decisions

- Guard = feature-detect at install: `typeof SharedArrayBuffer !== 'function'`
  → return `false`, never patch. Not a degradation — a SAB-less realm can hold
  no shared-backed input, so unpatched native decode is exact; silent no-op is
  the faithful behavior (no warn, no capability row).
- File-header "patched UNCONDITIONALLY" rationale guards against probing
  shared-DECODE tolerance (false-negative risk); constructor-absence detection
  has no false-negative mode — rationale intact for realms WITH SAB.
- Map open question 3 settled: `util-types.ts:27,31` SAB refs are TS type
  positions + string literals, erased in emitted JS
  (`npx esbuild packages/runtime-js/src/builtins/util-types.ts --format=esm |
  grep SharedArrayBuffer` → string literals/identifiers only; runtime call with
  deleted SAB global: `isSharedArrayBuffer(new ArrayBuffer(1))` → `false`, no
  throw, node v24.16.0). No guard needed there.
- Sweep (2026-08-29, prod `packages/*/src` grep): the only runtime-evaluated
  bare `SharedArrayBuffer` reachable from a no-COI realm is
  `worker-realm-compat.ts:75,80`; kernel constructor sites are
  worker-spawn-only behind the `typeof` capability gate.
- RED substrate carrier (which lane / how the headerless page is served) is
  implementation-owned; the contract pins only observables: real Chromium,
  `crossOriginIsolated === false`, absent `SharedArrayBuffer`, real built shim.

## Reversibility

REVERSIBLE — internal shim guard, no public surface.
