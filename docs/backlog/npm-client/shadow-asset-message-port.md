---
area: npm-client
status: ready
title: Shadow-asset MessagePort adapter — bounded reads, progress, cancellation, disposal
created: 2026-07-15
why: supervised Workers need verified multi-megabyte asset bytes, but neither the 1MiB SAB sync-RPC nor guest Node IPC owns this protocol
user_story: As a supervised runtime Worker, I want a dedicated capability session that returns verified asset bytes or a bounded typed error
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-asset-manager]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/kernel/0266-opaque-named-capability-ports-on-worker-bootstrap.md]
code: [packages/npm-client/src/index.ts]
---

## Context

The protocol is independently testable on a real `MessageChannel`; kernel is
needed only later to transport the child endpoint during Worker bootstrap.

## Acceptance

- npm-client exports
  `SHADOW_ASSET_CAPABILITY = 'rifty.shadow-assets.v1'`, a manager-side session
  server, a child client adapter, clone-safe frame/error types, and explicit
  start/dispose operations.
- One server session is bound to one exact `ShadowAssetPlan`. Requests may
  read only ids in that plan; unknown ids reject
  `ShadowAssetReadError {code:'ESHADOWASSETREAD'}`.
- Frames are versioned and exactly
  `read|progress|result|error|cancel|dispose` with request id. Result transfers
  one response-owned `ArrayBuffer` bounded by descriptor size; server retains
  no detached buffer and uses no SAB/Node IPC/env frame.
- Client validates every incoming frame, id, phase, error envelope, and byte
  length. It reconstructs typed errors; raw `Error`, `DOMException`, stack,
  function, callback, manager, storage/source adapter, and `AbortSignal` never
  cross the wire.
- Every request has a caller-supplied or default finite deadline. Port close,
  malformed frame, timeout, manager shutdown, and server disposal settle every
  request with typed `ESHADOWASSETPORT` cause.
- Cancel removes one waiter and best-effort notifies the server; it does not
  abort a manager flight still used by another session/caller. Late terminal
  frames for a settled id are ignored.
- Client dispose rejects local pending requests, sends one best-effort dispose,
  removes listeners, and closes. Server dispose stops admission, settles
  requests with one terminal error, removes listeners, and closes. Both are
  idempotent.
- The adapter implements only `ShadowAssetRuntimeReader`, with behavior equal
  to the direct runtime reader. `ensure`, receipt inspection, admin, manager
  close, state, and store paths remain unreachable. Local signal/progress
  options become cancel/progress frames; their objects/functions never cross.

## Observable proof

1. Transfer the real 13,918,738-byte esbuild member through one real
   `MessageChannel`; bytes/hash equal the direct manager read and exactly one
   transferable buffer is used.
2. Two clients read one missing hash while one cancels: one manager fill occurs,
   the survivor succeeds, and the cancelled request rejects.
3. Oversize/truncated/malformed/duplicate/unknown-id frames, deadline, each-side
   disposal, manager close, and abrupt peer close settle all requests.

## Parity cases

1. Direct and MessagePort runtime readers return byte-identical verified data
   and equivalent typed domain errors.
2. Capability traffic never appears through Node `process.env`,
   `process.send`, stdio, or fork IPC.

## Fault matrix

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `corrupt-input` | malformed/version-drifted/oversize frame | typed rejection; session cannot publish bytes |
| `torn-state` | port closes before result/error | deadline/close settles every request |
| `observable-order` | request before start or frame after settle | loud pre-start failure; late frame ignored |
| `concurrent-same-key` | shared manager flight with one cancellation | survivor unaffected; no second writer |
| `sibling-drift` | direct and port adapters shape different outcomes | shared contract suite across both adapters |

## Out of scope

- Passing the child port through Worker bootstrap; ADR-0266 owns that.
- Workbench owner composition, public progress UI, or runtime-specific adapter.
- Graceful behavior after hard Worker termination beyond the client deadline.

## Decisions

- Dedicated async MessagePort, not SAB, env, stdio, or guest Node IPC.
- Sessions are exact-plan scoped; bare owner-wide reads are forbidden.
- Protocol concerns stay in the adapter; manager correctness is not duplicated.
