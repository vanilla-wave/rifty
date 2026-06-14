---
area: kernel
status: parked
title: Kernel native support for long-running (server-shaped) worker processes
created: 2026-06-08
why: installWorkerEntry tears the realm down on top-level-await resolve; servers survive only via a never-resolving-promise hack
user_story: As a developer running a long-lived dev server (Vite-in-Worker) in rifty, I want my worker to keep listening after setup and shut down gracefully on kill, but today `installWorkerEntry` posts `exit` + `self.close()` the moment top-level await resolves so the realm dies a beat after `listen()` — every later request hits a dead worker (502) unless I add a never-resolving promise hack.
sources: [ADR-0077, ADR-0080, PROJECT_PLAN §2]
---
## Context

`installWorkerEntry` (`packages/kernel/src/worker-entry.ts`) runs the entry then unconditionally `postMessage({type:'exit'})` → `closePorts()` → `self.close()`. Correct for run-to-completion (REPL/CLI), wrong for a long-running dev server (Vite-in-Worker, ADR-0043): its top-level `await` resolves *after* it starts listening, so the kernel kills the realm a beat later → every later request hits a dead worker (502 preview-port bridge timeout).

The current workaround stays playground-local: `real-vite-bootstrap` ends with `await new Promise<never>(() => {})` (ADR-0077) so the entry never resolves. ADR-0080's lazy `node_modules` remote-read is a second consumer of that live worker. That is sufficient for the current consumer-ready surface because Real Vite preview and page-explorer reads stay alive without changing kernel public behavior.

The remaining gap is a kernel-native lifecycle contract: the worker can only die via `worker.terminate()` today, so there is no graceful-shutdown hook or explicit server-process exit protocol.

## Options / Next

Parked until a kernel ADR chooses the public contract:

- `SpawnWorkerSpec` / `WorkerSpawnSpec` flag that marks an entry as server-shaped.
- Explicit process-driven shutdown/exit signal from the worker realm.
- Graceful teardown hook ordering before `{ type: 'exit' }`, stdio close, dispatcher detach, and `self.close()`.
- Tests proving a server-shaped entry can resolve setup without posting exit, remains in `ProcessManager.list()`, and exits on explicit kill/shutdown.
- Removal of the playground keep-alive only after native lifecycle exists.

## Reversibility

IRREVERSIBLE when taken up - kernel public behaviour and exported worker-spawn types. Needs its own ADR. Parked for future kernel lifecycle work.
