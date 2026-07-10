# ADR 0211: Node-default JSON serialization over MessagePort child-process IPC

Status: Accepted
Date: 2026-07

> Corrects ADR-0045's child-process serialization and clone-failure clauses.
> The dedicated `MessagePort` remains the raw Worker transport;
> `child_process` owns Node's default JSON serialization at the runtime
> boundary, while internal control and `worker_threads` keep honest
> structured-clone semantics. A serialization failure never disconnects IPC.

## Context

Worker-backed `fork()` originally dropped `child.send` / `process.send` messages.
ADR-0045 fixed the transport: `spawnKernelWorker` allocates a fourth, dedicated
`MessageChannel` beside stdin/stdout/stderr; parent port stays on the
`WorkerProcessHandle`, child port is transferred in the process spec; symmetric
`ipc:message{payload}` / `ipc:disconnect` frames carry async IPC. SAB was rejected
because fork IPC is async; sharing a stdio port was rejected because it couples
lifecycles and payload framing. Those transport choices remain load-bearing.

ADR-0045 also made one false equivalence: the raw browser transport's structured
clone was treated as the serialization contract of Node's `child_process` API.
It claimed functions/symbols would fail asynchronously through `messageerror`.
In Chromium/Node `MessagePort.postMessage`, a function nested in a payload throws
`DataCloneError` synchronously. Rifty caught that throw, classified it as a closed
peer, closed the IPC port, and returned `false`.

Real `nodemon@3.1.14` exposed the consequence. When `process.send` exists,
nodemon proxies every bus event upstream. Its `config:update` payload contains
own function properties (`config.load` / `config.reset`). Structured clone
rejects the payload; rifty silently disconnects the dev-server child; the app
still listens, but the later plain `rifty:dev-ready` frame cannot reach the
owner, so preview remains OFF and the Service Worker returns 503.

Node 24.16.0 is the oracle (ADR-0164). With default child IPC, sending
`{a:1, fn(){}, nested:{x:2, fn(){}}}` returns `true` and the parent receives
`{a:1, nested:{x:2}}`: Node's default is JSON serialization. A circular payload
throws `Converting circular structure to JSON`, but a subsequent valid send on
the same channel succeeds. Therefore merely preserving the structured-clone
channel after failure would still reject a real tool path that Node accepts.

## Decision

1. **Keep the raw transport from ADR-0045.** Every kernel Worker retains its
   dedicated parent-child `MessagePort`, the two frame kinds, early-message
   buffering, and idempotent disconnect-on-explicit-disconnect/exit/kill.
   `WorkerProcessHandle.send` is the raw structured-clone transport primitive.
2. **Separate transport from Node API serialization.** `@riftydev/kernel` stays
   Node-API-agnostic (ADR-0039) and never JSON-shapes a payload.
   `@riftydev/runtime-js` owns one child-process IPC codec used by BOTH
   `ChildProcess.send` and the child realm's `process.send`.
3. **Node default = JSON.** Omitted/default child-process serialization performs
   Node-compatible JSON serialization before posting in each direction. Function
   properties are omitted, non-finite JSON values follow JSON behavior, and
   serialization errors are synchronous. The receiver observes the deserialized
   value, never the sender's live object.
4. **Raw control is not `process.send`.** Playground owner/dev-server lifecycle
   frames use a raw kernel-IPC sender rather than aliasing the public
   `NodeProcess.send` codec. This preserves structured-cloned `Uint8Array`
   terminal/VFS frames without weakening child-process parity. `worker_threads`
   also keeps structured-clone semantics through its own `parentPort` adapter.
   ADR-0217 subsequently names that logical lane `control:message` and gates the
   public runtime-IPC lane independently.
5. **Serialization failure does not mean disconnect.** JSON serialization fails
   before posting; raw structured clone may throw `DataCloneError`. Both surface
   loudly and leave the channel usable. Only the existing explicit disconnect,
   peer disconnect, process exit, or kill transitions it to disconnected; only
   then does a later send return `false`.
6. **Never label structured clone as Node advanced serialization.** Until
   Node's `serialization:'advanced'` behavior is implemented and parity-proven,
   that option throws a directed `NotImplementedError`; it is not silently
   accepted as an approximation.

## Consequences

- Real fork-aware tools such as nodemon can send ordinary config/event objects;
  their function properties disappear exactly as in Node instead of poisoning
  the supervisor channel.
- Kernel Worker control, typed arrays, and `worker_threads` do not pay a JSON
  round-trip and do not lose structured-clone types.
- Parent and child directions cannot drift: one runtime codec owns both.
- RED coverage is three-tiered: Node parity for function-property omission;
  an IPC fault test where an unserializable send is followed by a successful
  send on the same channel; and the real Chromium nodemon preview/restart e2e.
- ADR-0045 remains active: its dedicated transport decision is unchanged, while
  its child-process serialization and clone-failure clauses are corrected by
  this decision. ADR-0217 separately corrects capability/lane ownership.
