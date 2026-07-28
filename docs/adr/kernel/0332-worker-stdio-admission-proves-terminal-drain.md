# ADR 0332: Worker stdio admission proves terminal drain

Status: Accepted
Date: 2026-07-27

> TL;DR: one opaque process-wide output state cuts stdout/stderr writes; exact
> per-stream targets prove transport drain before exit, while local EOF and exit
> both precede close.

## Context

Worker stdout, stderr, and terminal outcomes use separate asynchronous
channels. Per-port FIFO does not order one output port against the worker-global
exit channel, and closing a `MessagePort` is peer death/cleanup, not proof that
its queued bytes reached the parent. An EOF frame on each output port would add
two competing terminal authorities and still need correlation with signals,
global errors, and physical Worker death.

The parent therefore needs one process-wide boundary that answers two distinct
questions: which writes were admitted before termination, and how many
committed chunks from each stream must arrive before it may expose EOF,
`'exit'`, or `'close'`. Abrupt peer death cannot truthfully answer the second
question.

## Decision

### One opaque output state

Every physical Worker process receives one branded, package-internal 16-byte
`SharedArrayBuffer`. Its four `Int32` words are:

| word | meaning |
|---|---|
| 0 | phase: `OPEN (0)`, `CHILD_SEALED (1)`, or `PARENT_CUT (2)` |
| 1 | one process-wide active writer: `0` or `1` |
| 2 | committed stdout chunk target |
| 3 | committed stderr chunk target |

The state and raw output `MessagePort`s stop at the kernel bootstrap.
Runtime-js and runtime-wasi receive only the semantic
`write(Uint8Array): void` byte-writer interface. Each successful call is one
committed chunk; targets count messages, not byte length. A single active slot
linearizes both streams against one terminal cut but does not promise relative
delivery order between the two ports.

A write CAS-claims the active slot, requires `OPEN`, posts the byte chunk,
increments only that stream's committed target, then releases and notifies in
`finally`. Re-entry, write after cut, invalid state, non-byte input, and counter
overflow fail loudly. A throwing `postMessage` commits nothing. Death between
post and counter commit can leave a claimed slot, so physical death abandons
the proof rather than inventing a target.

### Seal, cut, and abandon are different evidence

- **Child seal** is the trusted child finalizer/self-close attestation. It
  requires no active writer and changes `OPEN → CHILD_SEALED`. It is
  idempotent; a prior parent cut wins and cannot be reopened.
- **Parent cut** is the live-parent terminal boundary. It changes
  `OPEN → PARENT_CUT`; a prior child seal remains sealed. It rejects new
  writes, waits for the one admitted writer to commit or roll back, then
  snapshots both per-stream targets.
- **Abrupt abandon** is physical-death handling. It cuts new writes but neither
  waits nor returns targets. It clears and notifies a stranded active slot only
  to release a parent already waiting on that slot; this is not a commit or
  drain claim. The parent settles visibly without claiming complete output
  drain.

Only `CHILD_SEALED` authenticates the worker-global `{ type: 'exit', code }`
frame. Child `self.close()` seals before its private peer-closing control frame;
raw port close is never evidence. Duplicate sealed exit codes are idempotent;
an initial malformed sealed exit becomes a failure. A changed duplicate is
diagnosed on stderr but cannot replace the first accepted outcome.

The worker-global `error` event remains cancelable. The kernel checks it after
dispatch and seals only when `defaultPrevented` is false; a canceled error is
not terminal evidence and later writes plus a clean exit remain valid.

Attestation has two existing transports. A sealed finalizer whose global exit
post fails falls back to private IPC peer-close. A sealed `self.close()` whose
private IPC post fails falls back to authenticated global exit 1. If both
transports fail, the child still closes but the kernel invents no terminal
frame or successful drain; the parent can settle only from physical-death
evidence.

The first authoritative terminal outcome wins across natural exit, signal,
failure, and peer death. Later abrupt-death evidence may abandon an in-flight
drain proof so settlement stays finite, but it cannot replace that outcome.

### Parent completion

The parent validates each output frame as `Uint8Array`, counts received chunks
per stream, and accepts one immutable target per stream. Target drift,
overrun, malformed frames, deserialization failure, and corrupt shared state
fail loudly and cannot complete normally. Normal completion requires
`received.stdout === target.stdout` and
`received.stderr === target.stderr`.

Parent-generated diagnostics are appended only after the exact child stderr
target is received and before stderr EOF, `exit`, and `close`. An abandoned
route has no target to await; its diagnostic is still emitted before the
scheduled terminal settlement.

Stdout/stderr send no EOF frames. After target equality, the parent closes the
output ports only as cleanup, signals EOF on its local Readables, and emits the
chosen exit outcome. Node permits a flowing stream's public `end` on either
side of `exit`; `close` waits through the local EOF turns and follows both.
These microtask checkpoints preserve local Readable observer order only; they
are not remote delivery or drain proof.

The physical-Worker route requires the existing cross-origin-isolated
`SharedArrayBuffer` capability gate, including `Atomics.waitAsync`. A contended
cut without `waitAsync` throws. There is no timer, busy-poll, EOF-frame, or
port-close fallback. An existing same-realm execution mode remains a different
lifecycle and does not claim this Worker drain proof.

## Outcome matrix

| observation | output evidence | terminal result |
|---|---|---|
| trusted child finalizer exit | child seal; parent snapshots exact targets | drain both targets, then exit/close |
| child-attested `self.close()` | child seal before private peer-closing frame | drain both targets, then visible peer death |
| parent signal while Worker is live | parent cut waits the admitted writer | drain both targets, terminate the realm, then signal/close |
| child-sealed global failure | authenticated seal plus failure | drain both targets, then failure exit/close |
| unsealed global error or physical peer death | abrupt abandon; no targets claimed | visible failure/peer death, finite settlement, no drain claim |
| malformed output frame, deserialization, target drift, or overrun | output protocol failure and abandon | loud failure; never fabricated success or drain |
| malformed initial sealed exit | authenticated failure | drain exact targets, then failure exit/close |
| changed duplicate sealed exit | stderr diagnostic; first exit remains authoritative | drain its exact targets, then the first exit/close |
| sealed global-exit post failure | private IPC peer-close fallback | drain exact targets, then visible peer death |
| sealed peer-close IPC post failure | authenticated global exit-1 fallback | drain exact targets, then exit 1/close |
| both attestation transports fail | no fabricated frame or drain result | physical death is the only remaining terminal evidence |
| invalid shared state | invariant guard throws | no normal completion or drain claim |
| competing terminal observations | first outcome remains authoritative | exactly one terminal settlement |

## Fault matrix

| axis | boundary | contract |
|---|---|---|
| `concurrent-same-key` | stdout/stderr write versus terminal cut | one process-wide CAS writer slot; no per-stream locks |
| `torn-state` | post, committed count, active release | post-before-count commit; `finally` release; peer death clears/notifies a stranded claim only to release waiters |
| `corrupt-input` | output frame, shared word, target, sealed exit | validate once at the owning boundary; drift/extra/malformed input fails loudly |
| `provenance-lie` | exit, port close, drain completion | child seal authenticates exit; exact targets authenticate drain; close authenticates neither |
| `lossy-aggregate` | stdout and stderr completion | separate targets; a combined total cannot hide the wrong stream |
| `observable-order` | last output/diagnostic versus EOF/exit/close; cancelable error dispatch | target equality first; parent diagnostic follows exact child stderr; exit and EOF both precede close; inspect `defaultPrevented` after dispatch |
| `unbounded-read` | cut during one admitted write or peer death | `waitAsync` follows the live claim; physical death switches to finite abandon, never a deadline-based drain claim |
| `false-fallback` | missing COI/SAB/`waitAsync`; attestation transport post | capability outcome or loud throw; sealed transports cross-fallback; dual failure fabricates no settlement |
| `sibling-drift` | Node, WASI, parity, and worker-thread carriers | one kernel writer and one parent cut shape every physical Worker |
| `frozen-assumption` | stdio shape and terminal order | real-Node parity exercises pipe/ignore/inherit, content, stdin EOF, exit, then close |

## Mechanism and carrier sweep

| surface | disposition |
|---|---|
| runtime-js | `NodeProcess.stdout/stderr` adapt strings/bytes to the shared semantic writer; runtime-js never sees the SAB or raw output ports |
| runtime-wasi | fd 1/fd 2 callbacks reach the same published semantic writers; the Worker process adapter uses the same kernel lifecycle |
| parity runner | physical child/worker adapters bind the same writer; the child-process stdio case remains the Node oracle for shapes, bytes, stdin EOF, exit-before-close |
| `worker_threads` | kernel-backed Workers use `spawnWorkerThread` and the same output cut; structured-clone `parentPort` stays separate; the declared same-realm fallback has no duplicate drain authority |
| stdin | parent→child bytes plus explicit `stdin:eof` remain a separate directional protocol; stdin EOF is not output admission evidence |
| stdio plans | pipe/inherit/ignore projection stays above the kernel cut; parent output readers validate bytes and create local EOF only after terminal completion |
| sync RPC and private control | neither owns output completion: the SAB RPC ring carries request/reply exchange, while private control carries lifecycle facts |

## Consequences

- A trusted terminal drain is exact for both streams without output EOF/ack
  frames, a second ledger, timeouts, or MessagePort-close inference.
- Output write admission is deliberately process-wide. Simultaneous/re-entrant
  stdout/stderr writes fail instead of becoming an unprovable cut race.
- Abrupt peer death may preserve bytes already received but cannot claim that
  all admitted bytes arrived.
- Corrects ADR-0011's unauthenticated worker-exit wording; ADR-0038, ADR-0039,
  ADR-0122, and ADR-0157's raw output-port contracts; and specifies ADR-0326's
  final-output drain authority. ADR-0144's lack of application-level graceful
  shutdown otherwise stands.
