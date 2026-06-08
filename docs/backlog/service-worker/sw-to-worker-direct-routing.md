---
area: service-worker
status: parked
title: SW→Worker direct preview routing (flip default owner to WorkerOwnerBinding)
created: 2026-06-08
why: SW-fetch for /preview/<port>/* still resolves to the first window client; the worker-realm direct path is built but not the default — gated on a triggering consumer
sources: [A-023, Q-2026-05-27-002, ADR-0046, ADR-0011, ADR-0043, TASKS M7, TASKS M10]
---
## Context
Today `installPreviewInterceptor` routes preview fetches to the first window client (FirstWindowOwnerBinding) — the bridge terminates in the main-thread realm, not the worker owning the registered port. ADR-0046 promoted Q-2026-05-27-002 into the PreviewOwnerBinding seam (window+worker owners, 'gone' outcome, port-keyed routing); `owner-binding-worker.ts` / WorkerOwnerBinding already exist. A-023 = the remaining swap so SW→Worker is direct, not SW→main-thread.
## Options / Next
Flip `installPreviewInterceptor` default owner FirstWindowOwnerBinding → WorkerOwnerBinding: SW posts to the worker owning the process registered for the URL, reusing the same MessagePort registry. Dependency chain: ADR-0011 phases 1-3 (done) → A-026 Vite-in-Worker (done, ADR-0043) → this swap. Verify the seam isn't already wired before scheduling (ADR-0046 built WorkerOwnerBinding; only the default-binding flip remains). Next consumer of the cross-realm bridge primitive; deferred awaiting a triggering use case (opencode-in-Worker / real-vite-in-Worker preview).
## Reversibility
Public SW routing behaviour (which owner the interceptor binds by default) — the binding swap itself is config-shaped within the ADR-0046 seam, but it changes observable preview routing. Gate: a real consumer that owns a port from the worker realm. Not a stop; record-and-continue when the gate fires.
