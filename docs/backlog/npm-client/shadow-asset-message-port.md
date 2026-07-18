---
area: npm-client
status: ready
title: Shadow-asset MessagePort adapter — bounded reads, progress, cancellation, disposal
created: 2026-07-15
why: supervised Workers need verified multi-megabyte asset bytes, but neither the 1MiB SAB sync-RPC nor guest Node IPC owns this protocol
user_story: As a supervised runtime Worker, I want a dedicated capability session that returns verified asset bytes or a bounded typed error
epic: honest-shadow-substitutions
blocked_by: []
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/kernel/0266-opaque-named-capability-ports-on-worker-bootstrap.md]
code: [packages/npm-client/src/index.ts]
---

## Context

The protocol is independently testable on a real `MessageChannel`; kernel is
needed only later to transport the child endpoint during Worker bootstrap.

## Public interface

~~~ts
const SHADOW_ASSET_CAPABILITY = 'rifty.shadow-assets.v1'

type ShadowAssetPortFailurePhase =
  | 'send'
  | 'receive'
  | 'decode'
  | 'deadline'
  | 'closed'
  | 'dispose'

interface ShadowAssetPortFailure {
  readonly message: string
  readonly phase: ShadowAssetPortFailurePhase
  readonly assetId?: string
  readonly cause?: unknown
}

class ShadowAssetPortError extends Error {
  readonly code: 'ESHADOWASSETPORT'
  readonly phase: ShadowAssetPortFailurePhase
  readonly assetId?: string
  readonly cause?: unknown
  constructor(failure: ShadowAssetPortFailure)
}

interface ShadowAssetPortServer {
  dispose(): Promise<void>
}

interface ShadowAssetPortClient extends ShadowAssetRuntimeReader {
  dispose(): Promise<void>
}

declare function startShadowAssetPortServer(options: Readonly<{
  port: MessagePort
  plan: ShadowAssetPlan
  reader: ShadowAssetRuntimeReader
}>): ShadowAssetPortServer

declare function createShadowAssetPortClient(options: Readonly<{
  port: MessagePort
  plan: ShadowAssetPlan
}>): ShadowAssetPortClient
~~~

These factories, the capability constant, and `ShadowAssetPortError` are the
whole added adapter surface. It reuses the manager-owned exported
`ShadowAssetError` and `ShadowAssetReadError` classes and constructors; there is
one nominal prototype for direct and port reads. `ShadowAssetStoreError` remains
manager/admin-local and never enters this capability.
Frames and clone-safe envelopes are package-private.
Both factories validate/freeze the exact plan and start the port before return;
each read uses npm-client's exported
`SHADOW_ASSET_MAX_READ_DEADLINE_MS` (30,000 ms) unless its call supplies a
smaller positive safe integer. Factory-local defaults are forbidden, so the
manager, client, and server cannot drift.
`ShadowAssetPortError` validates/snapshots its exact failure object and sets
`name='ShadowAssetPortError'`; it has no constructor overload.

The package-private wire is exact-key decoded and every frame carries
`protocol:'rifty.shadow-assets/v1'`:

~~~ts
type ShadowAssetPortFrame =
  | { protocol: 'rifty.shadow-assets/v1'; type: 'read';
      requestId: number; assetId: string; deadlineMs: number }
  | { protocol: 'rifty.shadow-assets/v1'; type: 'progress';
      requestId: number; progress: ShadowAssetProgress }
  | { protocol: 'rifty.shadow-assets/v1'; type: 'result';
      requestId: number; assetId: string; sha256: string; bytes: ArrayBuffer }
  | { protocol: 'rifty.shadow-assets/v1'; type: 'error';
      requestId: number; error: ShadowAssetPortErrorEnvelope }
  | { protocol: 'rifty.shadow-assets/v1'; type: 'cancel'; requestId: number }
  | { protocol: 'rifty.shadow-assets/v1'; type: 'dispose' }

interface ShadowAssetCauseEnvelope {
  readonly name: string
  readonly code?: string
  readonly message: string
}

type ShadowAssetPortErrorEnvelope =
  | Readonly<{
      name: 'ShadowAssetError'
      code: 'ESHADOWASSET'
      message: string
      requiredSetDigest: string
      assetId?: string
      phase: ShadowAssetFailurePhase
      transports: readonly ShadowAssetTransportFailure[]
      recovery: 'retry' | 'clear-and-retry' | 'none'
      usedBytes?: number
      requiredBytes?: number
      cause?: ShadowAssetCauseEnvelope
    }>
  | Readonly<{
      name: 'ShadowAssetReadError'
      code: 'ESHADOWASSETREAD'
      message: string
      assetId: string
      reason: 'unknown-asset'
      cause?: ShadowAssetCauseEnvelope
    }>
  | Readonly<{
      name: 'ShadowAssetPortError'
      code: 'ESHADOWASSETPORT'
      message: string
      phase: ShadowAssetPortFailurePhase
      assetId?: string
      cause?: ShadowAssetCauseEnvelope
    }>
~~~

Request ids are positive safe integers allocated monotonically from one per
client and never reused; exhaustion rejects before send. Frame deadlines are
positive safe integers no greater than the exported maximum. The server rejects
a larger value as malformed, starts its timer before `readVerified`, and passes
that same value with its request-scoped signal/progress sink to the reader. A
dead or hostile client therefore cannot leave manager waiters unbounded. Error envelopes omit
stack and recursively flatten at most one cause. Extra/missing/accessor/symbol
keys, wrong prototypes, invalid ids/deadlines/phases, non-owned buffers, and
result bytes/hash/length that disagree with the bound descriptor are malformed.

## Acceptance

- npm-client adds exactly the public surface above: capability name,
  manager-side server factory, child client factory, and port error; manager
  domain errors are reused, not redeclared.
- One server session is bound to one exact `ShadowAssetPlan`. Requests may
  read only ids in that plan; unknown ids reject
  `ShadowAssetReadError {code:'ESHADOWASSETREAD',reason:'unknown-asset'}`.
- Frames use the package-private union above. Result transfers
  one response-owned `ArrayBuffer` bounded by descriptor size; server retains
  no detached buffer and uses no SAB/Node IPC/env frame.
- Both sides validate every incoming frame, id, phase, error envelope, and byte
  length. The client reconstructs typed errors; raw `Error`, `DOMException`, stack,
  function, callback, manager, storage/source adapter, and `AbortSignal` never
  cross the wire.
- Every request has a caller-supplied or default finite deadline on both sides.
  Port close, timeout, manager shutdown, and server disposal settle every
  request with typed `ESHADOWASSETPORT` cause. A malformed frame, duplicate
  active read id, or terminal id never issued by that client fails the session
  and settles all pending requests; no later frame is admitted. A terminal frame
  for an issued id already settled by result/error/cancel/timeout is merely late
  and ignored.
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
- Expected direct-reader failures preserve the same class and every public field
  through the discriminated envelope. Only `cause` is sanitized to one
  `{name,code?,message}` level. Two adapter-lifecycle outcomes are exact
  exceptions: direct `ShadowAssetReadError {reason:'deadline'}` maps to
  `ShadowAssetPortError {phase:'deadline',assetId,
  message:'Shadow asset read deadline exceeded'}`, and a manager
  `ShadowAssetStoreError` caused by clear/closing/closed maps to
  `ShadowAssetPortError {phase:'closed',assetId,
  message:'Shadow asset authority is unavailable'}`. Both mappings omit cause;
  the internal store/deadline fields do not cross. Other
  framing/deadline/peer failures also use `ShadowAssetPortError`;
  `ShadowAssetInstallError` and `ShadowAssetStoreError` never enter a frame.

## Observable proof

1. Transfer the real 13,918,738-byte esbuild member through one real
   `MessageChannel`; bytes/hash equal the direct manager read and exactly one
   transferable buffer is used.
2. Start one ensure flight, then two clients join its missing hash while one
   cancels: one manager fill occurs, the survivor succeeds, and the cancelled
   request rejects. No runtime read starts a source request.
3. Oversize/truncated/malformed/duplicate/unknown-id frames, a deadline above
   the fixed maximum, effective deadline expiry, each-side disposal, manager
   clear/close, and abrupt peer close settle all requests with the exact mapped
   type.

## Parity cases

1. Direct and MessagePort runtime readers return byte-identical verified data
   and equivalent typed data-domain errors; the two documented deadline/store
   lifecycle mappings are port errors.
2. Capability traffic never appears through Node `process.env`,
   `process.send`, stdio, or fork IPC.

## Fault matrix

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `corrupt-input` | malformed/version-drifted/oversize frame | typed rejection; session cannot publish bytes |
| `torn-state` | port closes before result/error | deadline/close settles every request |
| `unbounded-read` | client sends an excessive deadline or either peer/read stalls | reject the frame or settle with `ShadowAssetPortError {phase:'deadline'}` within the fixed ceiling |
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
