# ADR 0025: Toolchain dev servers run on the playground main thread

Status: Accepted (promoted from Q-2026-05-23-002). **Superseded by ADR-0043 for the Real Vite path** (2026-05-27); main-thread choice retained as the documented non-isolated fallback for the M10 Dev Mode adapter (`apps/playground/src/glue/devMode.ts`).
Date: 2026-05

**Decision (2026-05-27):** ADR-0043 lands the Real Vite migration to a kernel-spawned Worker realm. `startRealVite()` now requires SAB IPC and throws `NotImplementedError` when unavailable. The M10 Dev Mode adapter (`devMode.ts`) keeps the main-thread realm as documented here. Once Dev Mode acquires a non-trivial workload (or once `WorkerOwnerResolver`/A-023 lands and the page hop disappears), it can follow Real Vite into the worker realm — at which point this ADR is fully superseded.

**Decision (2026-05-26):** A-026 (Vite in Worker) confirmed for **M11**. Real Vite migrates out of the page realm into a kernel-spawned Worker once the cross-realm port-registry bridge in `@riftydev/net` lands (sequenced before A-023 SW→Worker). This ADR's main-thread choice remains the documented fallback for non-isolated environments.

## Context

The M10 "Dev Mode" and "Real Vite" adapters (`apps/playground/src/adapters/devMode.ts`, `apps/playground/src/adapters/realVite.ts`) host a Node-shape dev server in the playground page realm rather than in a dedicated Worker. This was originally a provisional choice, marked `TODO(ADR): Q-2026-05-23-002`.

The driver is the M7 contract: `@riftydev/net.dispatchToPort` and the Service Worker preview-bridge live in the page realm; the SW posts back to the first window client, which expects to call into a `@riftydev/net` port registry local to its realm. Running the dev server in a Worker would require a cross-realm bridge for that registry — a non-trivial design touching request streaming and `Request`/`Response` transfer (already listed as an M10 follow-up).

## Options considered

- **A — Main thread (chosen).** Zero bridge work; reuses the M7 SW↔window contract end-to-end. Cost: `installProcessGlobals()` and the `Promise.prototype.then` nextTick patch run on the page realm and are observable by other main-thread code (Solid render, Monaco). UI can stutter under heavy Vite work.
- **B — Dedicated Worker + cross-realm bridge.** Isolates Node-compat globals and CPU from the UI. Cost: design a port-registry bridge spanning Worker↔Window.
- **C — Run inside the existing REPL Worker.** Globals are already installed there. Cost: same registry-bridge problem; mixes user REPL code with a dev-server fixture.

## Decision

Run toolchain dev servers (M10 Dev Mode, Real Vite) on the playground main thread, guarded by a one-shot `globalsInstalled` flag so `Promise.prototype.then` is never double-patched.

A future move to Option B remains the right long-term answer and is tracked as an M10 follow-up; the migration path is local — replace `realVite.ts` with a worker-spawning version plus a registry bridge in `@riftydev/net`.

## Consequences

- The two adapter files (`devMode.ts`, `realVite.ts`) intentionally install Node globals on the page realm. The one-shot guard is mandatory whenever a new toolchain adapter joins this set.
- UI components (Solid, Monaco) share the page event loop with Vite's CPU-heavy passes. Visible jank under load is expected; this is the explicit trade-off, not a defect.
- Subsequent toolchain adapters (e.g. swc, esbuild as a dev pipeline) follow the same realm choice. Picking a different realm requires superseding this ADR.
- Adopting Option B later is bounded work: rewrite the adapter(s) and add a cross-realm port-registry bridge in `@riftydev/net`. No consumer-side change.

## Acceptance criteria

- [ ] No `TODO(ADR): Q-2026-05-23-002` markers remain in the repo (`pnpm todo:adr` clean for this Q-ID).
- [ ] `installProcessGlobals()` (or equivalent) is invoked at most once per page session — second invocation is a no-op.
- [ ] OPEN_QUESTIONS.md moves Q-2026-05-23-002 to the "Promoted" section with this ADR as the resolution.
