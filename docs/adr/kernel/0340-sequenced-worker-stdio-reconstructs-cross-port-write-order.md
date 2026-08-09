# ADR 0340: Sequenced worker stdio reconstructs cross-port write order

Status: Accepted (supersedes ADR-0332, removed)
Date: 2026-07-30

> TL;DR: the existing process-wide output admission assigns every stdout/stderr
> write one trusted order; the parent reconstructs that order across the two
> independently delivered ports before exposing bytes or terminal events.

## Context

Worker stdout, stderr, and terminal outcomes use separate asynchronous
channels. Per-port FIFO orders one stream, but not stdout against stderr or
either stream against the worker-global exit channel. Closing a `MessagePort`
is peer death/cleanup, not proof that queued bytes reached the parent.

ADR-0332 solved the terminal half: one opaque process-wide output state admits
writes, a child seal or parent cut snapshots exact per-stream targets, and the
parent exposes EOF/exit/close only after both targets arrive. Its global active
writer already linearizes stdout and stderr admission, but ADR-0332 explicitly
declined to preserve that order after the writes enter two independent output
ports. A legal delivery inversion can therefore render an eval program's
`stdout.write("a"); stderr.write("b"); stdout.write("c")` as `b,a,c`.

Capturing callback arrival in Workbench or a parity harness cannot recover the
lost child order. The authority must remain at the kernel boundary shared by
Node, WASI, recursive children, parity Workers, and worker threads. It must
also preserve the public raw-port contract: `WorkerStdioPorts`,
`spawnKernelWorker`, `SpawnWorkerResult.spec`, and
`WorkerProcessHandle.ports.stdout/stderr` expose `Uint8Array` messages even
though stream accessors are preferred.

## Decision

### One admitted order; raw output stays bytes

Retain ADR-0332's opaque state, process-wide active writer, phase, attestation,
and exact stdout/stderr committed counters. While holding that existing active
slot, every successful semantic output write derives its zero-based `order`
from the sum of the two committed counters. It posts the original
`Uint8Array` unchanged on the selected public output port, then posts one exact
authenticated witness
`{ kind: 'control:stdio-order', stream, order, attestation }` on the existing
child-to-parent IPC/private-control port, increments only that stream's
committed counter, and releases/notifies in `finally`.

`order` is a contiguous safe integer strictly below the sum of the two
per-stream chunk ceilings. The attestation is the existing output-state secret;
the published process spec gives guest code the control port but not the state,
so a guest cannot mint a trusted witness. Before that spec is published, the
kernel captures the native state-view/Atomics operations and native-bound
`postMessage` capabilities for both the raw output and control ports. Later
guest replacement of those intrinsics, either port instance method, or its
prototype cannot reveal the state secret or observe, modify, or redirect a
trusted byte/witness pair. Parity's physical Worker adapter performs the same
bind-before-publication sequence. Runtimes still receive only
`KernelStdioOutputWriter.write(Uint8Array): void`.

The public `IpcFrame` union gains the order witness because the deprecated raw
IPC port can observe every private control frame. The parent consumes this kind
inside `ProcessManager`; it never emits it as user IPC. Existing stdout/stderr
raw ports and their byte payloads do not change.

If the byte post throws, nothing was delivered and no witness/counter commits.
If the witness post throws after the byte post, the state becomes permanently
broken: later writes, child seal, and normal cut fail loudly, so an orphan raw
chunk can never be paired with a later retry. Death after both posts but before
counter commit can leave a delivered pair and a claimed writer; physical death
abandons the proof rather than inventing a target. Re-entry, write after cut,
invalid state/input/order, and counter overflow fail loudly.

### One parent receiver

The parent binds both raw output ports and the authenticated control witnesses
to one package-internal ordered receiver. It validates each raw chunk as
`Uint8Array`, preserves each port's FIFO queue, validates each exact witness
and secret, then pairs the witness's stream with the next chunk from that
stream. Starting at order zero, it synchronously projects only the longest
fully paired contiguous prefix into the corresponding local stdout/stderr
`Readable`; a later stream waits behind any missing predecessor.

Missing/wrong-type/forged witness fields; duplicate, stale, colliding, negative,
non-integer, unsafe, or over-ceiling orders; non-byte output; and
deserialization failure are protocol failures. There is no timeout,
callback-arrival fallback, or best-effort sorting.

Before a terminal cut, the receiver may hold a legal out-of-order suffix. One
immutable `{ stdout, stderr }` target fixes raw-chunk counts, authenticated
witness counts, per-stream pair counts, and the total `stdout + stderr` order
frontier. Normal completion requires exact equality for all four views, no
buffered chunks/witnesses, and `nextOrder === stdout + stderr`; target drift,
overrun, or a gap fails loudly. Abrupt abandonment claims no target and emits
only the already reconstructed contiguous prefix; unprovable buffered chunks
or witnesses are discarded.

### Seal, cut, and terminal order

ADR-0332's remaining lifecycle is retained:

- a trusted child seal changes `OPEN → CHILD_SEALED`; a live parent cut changes
  `OPEN → PARENT_CUT`, waits one admitted writer, then snapshots exact targets;
- physical death blocks new writes, releases a stranded waiter, and claims no
  drain;
- child seal plus the secret attestation authenticates worker-global exit;
  private peer-close and global-exit transports cross-fallback, while dual
  failure fabricates no settlement;
- the first authoritative natural exit, signal, failure, or peer death wins;
  canceled global errors remain nonterminal;
- after exact ordered child output, a parent diagnostic precedes local EOF,
  exit, and close. `close` follows both local Readable EOF turns.

The physical Worker route still requires cross-origin isolation,
`SharedArrayBuffer`, and `Atomics.waitAsync` for a contended cut. The declared
same-realm route remains a distinct lifecycle and claims no Worker drain proof.

## Fault matrix

| axis | boundary | contract |
|---|---|---|
| `observable-order` | independently delivered stdout/stderr frames | forced legal inversion reconstructs authenticated child write order |
| `concurrent-same-key` | stdout/stderr write versus terminal cut | one existing process-wide active slot assigns the order and admits the write |
| `torn-state` | byte post, witness post, counter commit, active release | byte-post failure commits nothing; witness-post failure poisons the route; death abandons a stranded/uncommitted proof |
| `corrupt-input` | byte, witness, order, state, target | validate once; malformed/unsafe/duplicate/stale/collision/gap/overrun/target drift fails loudly |
| `provenance-lie` | stream and order | capture state/Atomics and native posts before port publication; raw port authenticates chunk stream; state secret authenticates witness; guest posts/interceptors cannot mint/mutate order |
| `lossy-aggregate` | per-stream receipt and total frontier | both exact stream targets plus contiguous total order must agree |
| `unbounded-read` | missing predecessor or active writer | normal drain waits exact evidence; death abandons without a deadline claim |
| `false-fallback` | inversion, missing capabilities, port failure | no callback-order fallback, timeout, EOF frame, or port-close inference |
| `sibling-drift` | Node, WASI, parity, recursive, worker-thread carriers | one kernel writer/receiver shapes every physical Worker producer |
| `frozen-assumption` | terminal and stream ordering | real-Node parity covers partial writes, UTF-8 splits, EOF tails, diagnostics, exit, and close |

## Mechanism and carrier sweep

| surface | disposition |
|---|---|
| public `WorkerStdioPorts` / spawn result / handle ports | stdout/stderr messages remain exact `Uint8Array`; no envelope or byte prefix |
| public `IpcFrame` / raw IPC port | adds one authenticated private-control witness; `ProcessManager` consumes it and never emits it as user IPC |
| runtime-js | existing semantic stdout/stderr writers; no protocol knowledge |
| runtime-wasi | fd 1/fd 2 reach the same semantic writers |
| Workbench terminal | consumes already ordered kernel Readables; no reorder logic |
| parity runner | physical Worker adapter binds the same writer; capture preserves callback order only |
| recursive Node children | owner-root `ProcessManager` uses the same receiver per physical route |
| `worker_threads` | kernel-backed threads use the same output boundary; structured-clone `parentPort` stays separate |
| program/eval entries | both use the same receiver and terminal lifecycle |
| stdin and SyncRpc | remain separate directional protocols and own no output order/drain evidence |

## Consequences

- Cross-stream byte order is recovered at the deepest shared authority, so
  terminal and parity consumers cannot drift.
- The two-port public `WorkerStdioPorts` shape, stdout/stderr byte messages, and
  runtime writer interfaces do not change. The existing private-control lane
  carries the authenticated order witness; no fifth port or second SAB ledger
  is added. The receiver's queues are bounded by admitted output.
- A missing frame can retain later frames until exact drain evidence arrives;
  normal completion then fails loudly rather than returning reordered output.
- A single multiplexed output port or stdout/stderr envelope was rejected
  because either changes the public raw byte carrier and removes or leaks the
  independent-delivery boundary. A fifth order port, per-write
  acknowledgements, and a second SAB ledger were rejected as avoidable
  machinery beside the existing private-control lane and admission state.

This ADR supersedes and grafts all load-bearing context from ADR-0332: terminal
admission, seal/cut/abandon, exact targets, exit attestation, transport
fallback, diagnostic/EOF/exit/close ordering, and the semantic-writer
corrections to ADR-0011, ADR-0038, ADR-0039, ADR-0122, ADR-0157, and ADR-0326.
Where active ADRs cite ADR-0332 as the output authority, ADR-0340 now supplies
that authority.
