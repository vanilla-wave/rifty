# ADR 0144: Kernel server-process model: persistent worker processes (serve) replacing the keep-alive hack

Status: Accepted (2026-06-14)
Date: 2026-06

> TL;DR: The kernel gains a `serve` spawn flag. A worker whose entry finishes setup WITHOUT throwing is NOT reaped (no `self.close()`) — it stays alive (its open ports/timers keep the realm live) until the parent terminates it (or it throws / `process.exit`s during setup). This replaces the `await new Promise<never>(() => {})` keep-alive hack and is the **P1 gate for ADR-0143 "D"** (the owner-worker execution model) — the kernel server-process model ADR-0077 deferred.

## Context

`worker-entry.ts` `installWorkerEntry` runs the entry and then UNCONDITIONALLY posts `{type:'exit'}` + `closePorts()` + `self.close()` the instant the entry's top-level await resolves (worker-entry.ts:277-281). Correct for a run-to-completion CLI; fatal for a long-lived server. The only long-lived worker today — the real-vite preview owner — survives ONLY via `await new Promise<never>(() => {})` (real-vite-bootstrap.ts:503), a never-resolving promise that parks the top-level await so `self.close()` never fires. ADR-0077 introduced that keep-alive, called it a workaround, and deferred "the kernel should natively support server-shaped processes" as a follow-up (it rejected fixing worker lifetime then as IRREVERSIBLE + broad).

ADR-0143 "D" makes the shell/bin/`execSync` execution live under a **persistent owner-worker** (holds `node_modules`, supervises execution, PAGE = viewer). That requires a worker the kernel keeps alive deliberately — not a userland never-promise. This ADR is ADR-0143's named P1 gate.

> Correction 2026-06-23: the original text said the owner "runs CLIs in-realm." Later P6a moved `.bin` commands to supervised child workers over owner remote-fs so the owner stays responsive; `execSync` node-entry routing remains a separate residual.

The keep-alive hack is also load-bearing and fragile: a SECOND consumer (`serveNodeModulesReads`, node-modules-port.ts:94-96) depends on it; if the entry ever resolves (a refactor awaits wrong, an exception escapes), the kernel reaps the realm and every served port dies.

## Decision

Add `serve?: boolean` to `WorkerSpawnSpec` (kernel) and `SpawnWorkerSpec` (the caller-facing spawn subset); `spawnKernelWorker` forwards it into the init spec.

In `installWorkerEntry`, the post-entry teardown is extracted into a pure, exported `finalizeWorkerEntry(target, spec, outcome)`:
- `serve === true` AND the entry resolved WITHOUT throwing → **return early**: no exit message, no `closePorts`, no `self.close()`. The realm stays alive on its own open MessagePorts/timers until the parent terminates it.
- otherwise (run-to-completion, OR a `serve` entry that THREW during setup — including `process.exit` → `RIFTY_PROCESS_EXIT`) → post `{type:'exit', code}` + `closePorts` + `self.close()` exactly as before.

Hard kill is unchanged: `WorkerProcessHandle.kill()` → `worker.terminate()` reaps a `serve` worker regardless (the never-promise was always irrelevant to teardown).

Canonical consumer migrated: real-vite drops the keep-alive promise (real-vite-bootstrap.ts) and `realVite.ts` spawns with `serve: true` — behavior-equivalent (never-resolving await ↔ kernel keeps the realm), minus the hack.

### Alternatives

- **Status quo — userland `await new Promise<never>(() => {})`.** Rejected: the ADR-0077 hack; fragile (a stray resolve reaps the realm), load-bearing on a second consumer, and every future owner reinvents it. The kernel, not userland, should own "this process is long-lived".
- **A distinct `spawnServer` API / new `WorkerEntryDescriptor` kind.** Rejected: heavier surface. `serve` is orthogonal to entry kind (a `url` or `source` entry can be a server) and to the existing spawn flow — one boolean on the spec is the minimal honest model.
- **Thread `serve` into `KernelProcessSpec` (the runtime-js process shim).** Deferred: the close decision needs `serve` only in worker-entry; no shim consumer needs it in v1. Add when graceful shutdown (below) needs the shim to observe it.

### Scope (v1) + follow-ups

- v1 = stay-alive + **hard kill only**. Acceptable: the owner is memory-backed today (no OPFS on the kernel-worker path), so there is nothing to flush on teardown.
- **Graceful stop** (drain stdio, run a shutdown hook, flush) lands with ADR-0143 **P5** (OPFS persistence), when teardown has durable state to protect.
- **In-worker self-exit after setup** (a `serve` owner calling `process.exit` while handling a later command, not inside the awaited entry) is NOT wired in v1 — a `serve` owner exits via parent terminate, exactly like the real-vite owner does today. Wire when the shell needs an in-owner `exit`.

## Consequences

- (+) Removes the keep-alive hack and its fragility — a stray entry resolve no longer kills a server realm; the kernel models long-lived processes explicitly.
- (+) Unblocks ADR-0143 P1: a persistent owner-worker the kernel keeps alive and the parent owns via `handle.kill()`.
- (+) `finalizeWorkerEntry` is pure + exported → the reap/serve decision is unit-testable without a Worker realm (the full `onMessage` SAB path still needs COI, as today).
- (−) Hard-kill only in v1 (no graceful drain) — a `serve` worker with in-flight work loses it on terminate; fine while memory-backed, revisited at P5.
- (−) Lifecycle ownership is the caller's: a `serve` worker never terminated leaks a realm (real-vite already owns this via `handle.kill()` on mode-leave/close).
- Follow-ups: ADR-0143 P2 (terminal → thin client over the kernel stdio ports) builds directly on this; graceful stop at P5.

## Reversibility

IRREVERSIBLE — adds public kernel behavior + `WorkerSpawnSpec`/`SpawnWorkerSpec` API. The ADR-0077 follow-up it invited (does not supersede ADR-0077 — that keep-alive shipped; this retires its hack). Relates: ADR-0143 (P1 gate), ADR-0077, ADR-0011, ADR-0039.
