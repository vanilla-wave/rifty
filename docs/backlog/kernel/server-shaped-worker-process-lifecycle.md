---
area: kernel
status: active
title: Kernel native support for long-running (server-shaped) worker processes
created: 2026-06-08
why: installWorkerEntry tears the realm down on top-level-await resolve; servers survive only via a never-resolving-promise hack
sources: [ADR-0077, ADR-0080, PROJECT_PLAN §2]
---
## Context
`installWorkerEntry` (`packages/kernel/src/worker-entry.ts`) runs the entry then unconditionally `postMessage({type:'exit'})` → `closePorts()` → `self.close()`. Correct for run-to-completion (REPL/CLI), wrong for a long-running dev server (Vite-in-Worker, ADR-0043): its top-level `await` resolves *after* it starts listening, so the kernel kills the realm a beat later → every later request hits a dead worker (502 preview-port bridge timeout).
Worked around playground-locally: `real-vite-bootstrap` ends with `await new Promise<never>(() => {})` (ADR-0077) so the entry never resolves. TWO consumers now: ADR-0080 lazy `node_modules` remote-read also needs the worker live to answer page-explorer reads. Workaround means worker can only die via `worker.terminate()` — no graceful-shutdown hook.
## Options / Next
Provisional: keep the never-resolving-promise keep-alive (off kernel public surface). Proper fix: kernel natively supports server-shaped processes — a `spawn` flag or explicit `process`-driven exit/shutdown signal — so a server stays alive until explicit shutdown and keeps a graceful-shutdown hook. Two consumers strengthen the case; no longer a one-off.
## Reversibility
IRREVERSIBLE — kernel public behaviour. Its own ADR when taken up (records the spawn-flag-vs-shutdown-signal options + trade-offs). Milestone M11.
