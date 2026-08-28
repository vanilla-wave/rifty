---
area: runtime-js
status: draft
title: worker-realm-compat TextDecoder shim throws ReferenceError in realms without SharedArrayBuffer
created: 2026-08-26
why: without COI Chromium defines NO `SharedArrayBuffer` global; the shim's bare references make EVERY decode() in that realm throw ReferenceError — crashes unrelated code paths in the no-COI tier
user_story: As a dev on the no-COI fallback tier, I want TextDecoder to keep working, but today `installSharedMemoryTolerantTextDecoder`'s patched decode references bare `SharedArrayBuffer` and throws `ReferenceError` on every call in a realm where the global is absent.
epic: no-coi-sandbox-tier
sources: [docs/backlog/runtime-js/reference/no-coi-degradation-probes.md]
code: [packages/runtime-js/src/ipc/worker-realm-compat.ts]
---

## Context

`worker-realm-compat.ts` `installSharedMemoryTolerantTextDecoder` (~:68)
patches `TextDecoder.decode` to copy shared-backed views before decoding; the
patched body references `SharedArrayBuffer` bare. In a non-COI realm the
global is undefined → `ReferenceError` on every decode. Nothing can be shared
in such a realm, so the correct behavior is a no-op install. A verified guard
existed as a spike patch (throwaway branch, not carried over) — it landed
without a RED test; the fix must re-land failing-test-first (repo rule: no fix
without its regression test). Realm-sensitivity class:
`toolchain-build/worker-realm-conformance-harness` (tested-realm ≠ ships-realm).

## Options or Next

- RED: unit/conformance case simulating absent `SharedArrayBuffer` global →
  decode() must succeed (shim no-ops, returns false).
- Guard: feature-detect the global before installing the patched decode.

## Reversibility

REVERSIBLE — internal shim guard, no public surface.
