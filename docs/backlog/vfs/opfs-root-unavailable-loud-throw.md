---
area: vfs
status: ready
title: Report an unavailable OPFS root under persistence required as a storage-unavailable error, not as NotImplementedError('sandbox.toolchain.worker') plus a worker crash
created: 2026-09-27
why: when navigator.storage.getDirectory() rejects in the worker realm, createSandbox({ persistence: 'required' }) rejects loudly but with the wrong name — "Not implemented: sandbox.toolchain.worker (toolchain Worker crashed during handshake …)" — for a feature that is implemented and a storage that is merely unavailable
epic: browser-support-floor
sources: [docs/backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md, ADR-0372, ADR-0437]
code: [packages/runtime-js/src/worker-entry.ts, packages/runtime-js/src/host.ts, packages/rifty/src/sandbox.ts, packages/vfs/src/boot.ts]
---

## Context

Finding (probe P2, 2026-09-27, worktree @ 4f94a0584, Chromium 148 + WebKit 26.4 native; evidence file §Probes). `getDirectory()` replaced with the WebKit-shaped rejection `UnknownError: The operation failed for an unknown transient reason`:
- `persistence: 'required'` → rejects in 71–81 ms with `NotImplementedError: Not implemented: sandbox.toolchain.worker (toolchain Worker crashed during handshake: Uncaught UnknownError: …)`, feature `sandbox.toolchain.worker`. Path: `worker-entry.ts:151` rethrows inside top-level boot → the Worker `error` event → `host.ts:192-194, 414` wraps it as NotImplementedError. Same text natively on WebKit 26.4 (the 13-test group in the 2026-09-16 run).
- `persistence: 'preferred'` / no option → memory fallback, `vfs.reason` set, logged warning, `persistence: 'memory'` — honest, keep.
- Nothing hangs on either engine; the two WebKit timeouts (`no-coi-agent-sdk.spec.ts:8`, `no-coi-sandbox-build-loop.spec.ts:2698`) are test-side waits without deadline → `playground/no-coi-lane-firefox-webkit`.

Fidelity: the throw is loud but misnamed — "not implemented" and "worker crashed" describe neither the cause (storage root unavailable in this realm) nor what the host can do (fall back to `preferred`, ask the user to leave private mode). `checkSandboxSupport` already reports `opfs` unmet with the native reason; the runtime's rejection must carry the same native name + message and a storage-unavailable identity, decided before the toolchain worker handshake, not by crashing it. → I4.

## Challenge

challenge: 2026-09-28 — clear; accepted goal I4 and recorded P1/P2 unchanged; reproduced in real Chromium at pickup.

## Acceptance

1. A real Worker whose `getDirectory()` rejects exposes `StorageUnavailableError` / `ERR_STORAGE_UNAVAILABLE` at required startup, carrying native name/message in message and structured cause; never worker-crash or NotImplementedError. → I4
2. Preferred/default retain memory fallback with native diagnosis; ephemeral bypasses native storage. → I4

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| quota-perm-fail × native root acquisition | structured startup rejection or visible memory fallback | no-coi-storage-capability.spec.ts | → I4 |

## Out of scope

Retry/heal of a transient root failure (tier works); making Playwright's ephemeral WebKit context provide an OPFS root (test infra, item 5); the `preferred` fallback (already honest).

## Decisions

- 2026-09-28 — RDY-8: observed P1/P2 baseline + real-browser RED; independent DEC-2 review approved ADR-0476; evidence `docs/backlog/vfs/reference/browser-support-storage-evidence.md`.

- 2026-09-27 — re-cut from "no hang" to "named storage error" after probe P2 refuted the hang — trace: none
