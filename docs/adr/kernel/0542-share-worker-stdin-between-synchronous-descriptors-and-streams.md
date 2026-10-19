# ADR 0542: Share worker stdin between synchronous descriptors and streams

Status: Accepted
Date: 2026-10-20

> A physical input pipe owns the bytes; sync RPC reads and stream readiness use it.

## Context

esbuild-upstream-twin I3 requires `fs.read(0)` and `readFileSync(0)`.
MessagePort delivery cannot wake JavaScript blocked in Atomics.wait. Copying
those messages into a second replay buffer would duplicate consumption.

## Decision

- `SpawnWorkerSpec.stdinMode: 'pull'` selects a bounded physical input pipe.
  Existing generic Workers retain their push-port contract; Node spawn owners
  select pull explicitly. `WorkerSpawnSpec` carries this transport choice.
- Kernel owns a 64 KiB pipe and one pending serialized write. Writable owns
  serialization; a write callback settles after all bytes are accepted into
  the pipe, independently of the child's stream ref flag.
- Existing SAB RPC carries bounded reads. The trusted dispatcher attachment
  selects its pipe; guest PIDs cannot select another input. MessagePort
  frames only announce readiness. EOF follows bytes; teardown rejects pending
  requests and writes.
- `KernelProcessSpec.stdio.input` supplies read/close capabilities. Runtime
  owns fd validation, Node errors, stream flow, and callback timing. fd reads
  and process.stdin consume the same buffer. The registry is still empty by
  default (ADR-0039); opting into this kernel transport installs its handler.
- Runtime captures stdio descriptor sources before guest stream replacement.
  `fs.writeSync(1)` therefore bypasses an overridden process.stdout.write,
  as Node does. Registered symbols bridge pre-entry/node-entry bundle copies.

## Consequences

No second stdin replay ledger, polling timer, or new synchronous transport.
Push-only hosts keep async input; unavailable synchronous input throws by name.
No-COI execution selection and its esbuild runtime are unchanged.

Proof: `fs-stdio-fds.spec.ts`, `worker-stdin.test.ts`, stock upstream esbuild
matrix. A partial read followed by stream consumption proves shared ownership;
EOF/close and pending-operation teardown discriminate loss and retained holds.

- 2026-10-20 — same-realm `ProcessIO.write` accepts string or Uint8Array; output events retain bytes, avoiding decode/re-encode loss. Pending input writes each reuse a WorkerReference until their callback, including Writable-queued requests; no hook into a bypassable `_write` method.
