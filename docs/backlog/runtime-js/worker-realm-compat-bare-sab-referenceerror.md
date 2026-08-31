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

`installSharedMemoryTolerantTextDecoder` unconditionally replaces
`TextDecoder.prototype.decode`; the replacement evaluates bare
`SharedArrayBuffer` references before delegating private inputs. In a real
headerless Chromium realm the binding is absent, so installing the shim turns a
working native private-buffer decode into `ReferenceError`. `installNodeRuntime`
installs this realm shim before Node-worker entry evaluation, making the defect
an I2 prerequisite for the no-COI goal.

Evidence C149 — real source in a disposable Vite page served without COOP/COEP:

```sh
pnpm exec vite .tmp-no-coi-probe --host 127.0.0.1 --port 4173 --strictPort
# In Chrome for Testing 149.0.7827.55, load the page whose module imports
# packages/runtime-js/src/ipc/worker-realm-compat.ts through Vite, captures
# TextDecoder.prototype.decode, installs the shim, then decodes Uint8Array([111,107]).
# → crossOriginIsolated: false
# → typeof SharedArrayBuffer: "undefined"
# → install: true
# → decoder identity changed: true
# → ReferenceError: SharedArrayBuffer is not defined
```

Evidence N24 — the native behavior with the same absent binding:

```sh
node --input-type=module -e 'console.log(process.version); delete globalThis.SharedArrayBuffer; try { console.log(SharedArrayBuffer) } catch (error) { console.log(error.name + ": " + error.message) }; console.log(new TextDecoder().decode(new Uint8Array([111,107])))'
# → v24.16.0
# → ReferenceError: SharedArrayBuffer is not defined
# → ok
```

## Reference contract

- Oracle: Node v24.16.0 native `TextDecoder` with the realm's
  `SharedArrayBuffer` binding deleted; private bytes decode to `ok` although a
  bare binding read throws (Evidence N24).
- Browser realm: Chrome for Testing 149.0.7827.55 on a page served without
  COOP/COEP; `crossOriginIsolated === false` and
  `typeof SharedArrayBuffer === 'undefined'` are test preconditions, and the
  actual TypeScript module is imported through Vite (Evidence C149).
- Existing SAB-realm contract: ADR-0162 decision 3 keeps the TextDecoder patch
  unconditional so shared-backed inputs are copied before native decode.

## Acceptance

- A RED-first browser test imports the actual TypeScript module on a page served
  without COOP/COEP and rejects the run before install unless
  `crossOriginIsolated === false` and
  `typeof SharedArrayBuffer === 'undefined'`.
- In that realm `installSharedMemoryTolerantTextDecoder(TextDecoder)` returns
  `true`, changes `TextDecoder.prototype.decode`, and private
  `Uint8Array([111, 107])` decodes to `ok` without reading the absent binding.
- `installWorkerRealmCompat()` has the same private-decode outcome; no guard may
  skip the aggregate's `global` or writable-`self` sibling effects.
- Existing SAB-realm shared-copy, private pass-through, and idempotence tests
  remain green unmodified. A no-op install guard is rejected: it contradicts
  ADR-0162's unconditional-patch decision.

## Parity cases

1. Absent binding + native private decode → `ok`; installed rifty shim must
   preserve that result. Artifact: Evidence N24 is the Node v24.16.0 oracle;
   Evidence C149 is the Chrome 149.0.7827.55 RED (`ReferenceError` today).
2. Absent binding + direct install → `true` and decoder identity changes, then
   private decode → `ok`. Artifact: Evidence C149 records the first two values
   already green and the decode RED on the actual source module.
3. SAB-present realm + shared-backed view → private-copy decode with identical
   bytes; second install → `false`. Artifact: `pnpm vitest run
   packages/runtime-js/src/ipc/worker-realm-compat.test.ts` on the current tree,
   Node v24.16.0 / Vitest 2.1.9, passes the existing shared-copy and idempotence
   cases; these are green preservation pins, not new REDs.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| absent realm binding × install then private decode | unconditional install succeeds; decode delegates once and returns native `ok`, never `ReferenceError` | Evidence C149 (Chrome 149.0.7827.55 RED) against Evidence N24 (Node v24.16.0 oracle); real no-COI browser test |
| SAB-present realm × shared-backed decode | copy only the addressed bytes to private memory, then decode | existing `worker-realm-compat.test.ts` shared-view test, command/version in Parity 3 |
| either realm × repeat install | first patched function remains authoritative; repeat returns `false` | existing idempotence test plus no-COI browser identity assertion, same artifacts as Parity 2–3 |

## Out of scope

- No capability-report or warning surface: the corrected shim is faithful, not
  a degradation; the report belongs to `distribution/no-coi-sandbox-build-loop`.
- Kernel SAB allocation and sync-RPC: no-COI `execSync`/`spawnSync` keep their
  named loud `NotImplementedError` boundary.
- Same-realm spawn stdio, single-CPU reporting, OPFS policy, build/dev/HMR, and
  restart/durability behavior remain their mapped sibling slices.

## Decisions

ready-verdict: 2026-08-31 — Contract+RED @ 02f20db5f1b8d69d2c67cd5c1184cce1f32faa91
review: checkpoints — parity behavior at a browser realm boundary.
contract-red: 2026-08-31 — blocker @ e7b45a865173cf811c06d06f6a69953181848411

- ADR-0162's unconditional patch remains binding. Fix the patched decode's
  shared-input discrimination so it never evaluates an absent bare binding;
  do not skip installation in a SAB-less realm.
- The browser carrier is implementation-owned; the contract pins only a real
  headerless Chromium realm, actual source-module import, preconditions before
  install, and observable install/identity/decode results.
- REVERSIBLE: internal realm-shim correction, no public API or dependency.
