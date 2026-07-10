# ADR 0217: Separate worker control, runtime IPC, and stdin capability

Status: Accepted
Date: 2026-07

> TL;DR: Worker specs declare stdin/runtime-IPC capabilities; kernel frames stdin EOF and keeps internal control distinct from Node IPC on one transport.

## Context

ADR-0045/0211 gave every Worker one raw MessagePort beside stdio. Callers then
treated port presence as Node IPC: every spec-seeded `process` gained `send`,
while playground control also travelled as public `ipc:message`. Separately,
generic `child_process` forwarded stdin but its bootstrap inferred “unavailable”
from the unrelated `serve` lifecycle flag; parent close had no EOF frame.

Real Node exposes child IPC only when requested and stdin data/EOF are one
stream contract. Internal owner/preview/worker-thread control must survive a
public `process.disconnect()` and retain structured-clone payloads.

## Decision

1. `SpawnWorkerSpec` carries `WorkerProcessCapabilities`: stdin is `forwarded`
   or `unavailable`; runtime IPC is enabled or disabled. Kernel fills an
   explicit default (`unavailable`, disabled) into `KernelProcessSpec`.
2. One physical MessagePort remains. Kernel owns two logical frame lanes:
   `control:message` for internal structured-clone control and `ipc:*` for the
   higher runtime. `WorkerProcessHandle.sendControl` / `'control'` are the only
   parent control interface; `send` / `'message'` remain runtime IPC.
3. Runtime-js publishes child-realm `process.send`, `disconnect`, `connected`,
   and `channel` only when runtime IPC is enabled. A parent `ChildProcess`
   always retains Node's `connected` boolean but gains the other IPC fields only
   for fork. Disconnect closes that logical lane, not internal control.
   `channel` is a Node-shaped facade, never the raw
   `MessagePort`; until channel lifecycle ref-counting is parity-proven its
   `ref()` / `unref()` methods throw directed `NotImplementedError`s. Node JSON
   shaping remains only on `ipc:*` (ADR-0211).
4. Parent stdin sends `stdin:data` and exactly one `stdin:end`; the child adapter
   alone maps them to `Readable.push(data)` / `push(null)`. The terminal-only
   loud guard keys on the declared stdin capability, never `serve`.
5. Playground owners, preview/dev children, TS-LS, and `worker_threads` migrate
   to control. Generic `spawn` declares forwarded stdin; only fork declares
   runtime IPC.

## Consequences

- Plain `spawn` matches Node IPC shape; fork JSON semantics stay isolated from
  structured-clone control and worker_threads.
- IPC channel presence is truthful, while unsupported `process.channel` /
  `subprocess.channel` ref/unref lifecycle control stays loud.
- Data and EOF cross one tested stdin seam; pipe/inherit cannot drift.
- Public kernel surface grows by one capability object and `sendControl`; all
  internal callers migrate in the same change.
- Unsupported terminal stdin remains a loud `NotImplementedError`.
