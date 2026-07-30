# ADR 0338: Sequenced worker stdio reconstructs cross-port write order

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
Node, WASI, recursive children, parity Workers, and worker threads, without
exposing raw ports or coordination state to runtimes.

## Decision

### One admitted order

Retain ADR-0332's opaque state, process-wide active writer, phase, attestation,
and exact stdout/stderr committed counters. While holding that existing active
slot, every successful semantic output write derives its zero-based `order`
from the sum of the two committed counters. It posts an exact internal envelope
`{ order, bytes }` on the selected stream's existing port, increments only that
stream's committed counter, then releases and notifies in `finally`.

The stream identity comes from the port, not from frame data. `order` is a
trusted contiguous integer below the chunk ceiling and `bytes` is a
`Uint8Array`. Runtimes still receive only
`KernelStdioOutputWriter.write(Uint8Array): void`; the envelope, raw ports, and
shared state stop at the kernel bootstrap.

A throwing `postMessage` commits neither counter nor order. Death after post
but before counter commit can leave a delivered frame and a claimed writer, so
physical death abandons the proof rather than inventing a target. Re-entry,
write after cut, invalid state/input/order, and counter overflow fail loudly.

### One parent receiver

The parent binds both raw output ports to one package-internal ordered receiver.
It validates each exact envelope once, counts receipt on the authenticating
port, and buffers frames by `order`. Starting at order zero, it synchronously
projects only the longest contiguous prefix into the corresponding local
stdout/stderr `Readable`; later frames wait behind any missing predecessor.

Duplicate, stale, colliding, negative, non-integer, over-ceiling, malformed, or
deserialization-failed frames are protocol failures. There is no timeout,
arrival-order fallback, or best-effort sorting.

Before a terminal cut, the receiver may hold a legal out-of-order suffix. One
immutable `{ stdout, stderr }` target fixes both the per-stream receipt counts
and total `stdout + stderr` order frontier. Normal completion requires exact
per-stream equality, no buffered frames, and
`nextOrder === stdout + stderr`; target drift, overrun, or a gap fails loudly.
Abrupt abandonment claims no target and emits only the already reconstructed
contiguous prefix; an unprovable buffered suffix is discarded.

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
| `torn-state` | envelope post, counter commit, active release | post-before-count; physical death abandons a stranded or uncommitted proof |
| `corrupt-input` | envelope, order, bytes, state, target | validate once; malformed/duplicate/stale/collision/gap/overrun fails loudly |
| `provenance-lie` | stream and order | port authenticates stream; kernel writer authenticates order; guests receive neither capability |
| `lossy-aggregate` | per-stream receipt and total frontier | both exact stream targets plus contiguous total order must agree |
| `unbounded-read` | missing predecessor or active writer | normal drain waits exact evidence; death abandons without a deadline claim |
| `false-fallback` | inversion, missing capabilities, port failure | no callback-order fallback, timeout, EOF frame, or port-close inference |
| `sibling-drift` | Node, WASI, parity, recursive, worker-thread carriers | one kernel writer/receiver shapes every physical Worker producer |
| `frozen-assumption` | terminal and stream ordering | real-Node parity covers partial writes, UTF-8 splits, EOF tails, diagnostics, exit, and close |

## Mechanism and carrier sweep

| surface | disposition |
|---|---|
| runtime-js | existing semantic stdout/stderr writers; no protocol knowledge |
| runtime-wasi | fd 1/fd 2 reach the same semantic writers |
| Workbench terminal | consumes already ordered kernel Readables; no reorder logic |
| parity runner | physical Worker adapter binds the same writer; capture preserves callback order only |
| recursive Node children | owner-root `ProcessManager` uses the same receiver per physical route |
| `worker_threads` | kernel-backed threads use the same output boundary; structured-clone `parentPort` stays separate |
| program/eval entries | both use the same receiver and terminal lifecycle |
| stdin, public IPC, private control, SyncRpc | remain separate directional protocols and own no output order/drain evidence |

## Consequences

- Cross-stream byte order is recovered at the deepest shared authority, so
  terminal and parity consumers cannot drift.
- The two-port public `WorkerStdioPorts` shape and runtime writer interfaces do
  not change. The only new state is the receiver's bounded-by-admitted-output
  reorder map; the existing counters derive the sequence without another
  shared ledger.
- A missing frame can retain later frames until exact drain evidence arrives;
  normal completion then fails loudly rather than returning reordered output.
- A single multiplexed output port was rejected because it changes the public
  spawn shape and removes the independent-delivery fault boundary. Per-write
  acknowledgements or a second SAB ledger were rejected as duplicate
  authorities beside the existing admission state.

This ADR supersedes and grafts all load-bearing context from ADR-0332: terminal
admission, seal/cut/abandon, exact targets, exit attestation, transport
fallback, diagnostic/EOF/exit/close ordering, and the semantic-writer
corrections to ADR-0011, ADR-0038, ADR-0039, ADR-0122, ADR-0157, and ADR-0326.
Where active ADRs cite ADR-0332 as the output authority, ADR-0338 now supplies
that authority.
