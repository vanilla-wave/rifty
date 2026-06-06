# ADR 0025: Toolchain dev servers run on the playground main thread

Status: Accepted (promoted from Q-2026-05-23-002). **Superseded by ADR-0043 for the Real Vite path** (2026-05-27); main-thread choice retained as the documented non-isolated fallback for the M10 Dev Mode adapter (`apps/playground/src/glue/devMode.ts`).
Date: 2026-05

**Decision (2026-05-27, ADR-0043):** Real Vite migrates to a kernel-spawned Worker realm. `startRealVite()` now requires SAB IPC, throwing `NotImplementedError` when unavailable. The M10 Dev Mode adapter (`devMode.ts`) keeps the main-thread realm documented here; it can follow Real Vite into the worker realm once Dev Mode gains a non-trivial workload (or once `WorkerOwnerResolver`/A-023 lands and the page hop disappears), at which point this ADR is fully superseded.

**Decision (2026-05-26):** A-026 (Vite in Worker) confirmed for **M11** — Real Vite moves to a kernel-spawned Worker once the cross-realm port-registry bridge in `@riftydev/net` lands (sequenced before A-023 SW→Worker). Main-thread choice remains the documented fallback for non-isolated environments.

## Context

The M10 Dev Mode and Real Vite adapters (`apps/playground/src/adapters/devMode.ts`, `apps/playground/src/adapters/realVite.ts`) host a Node-shape dev server in the playground page realm, not a dedicated Worker. Originally provisional, marked `TODO(ADR): Q-2026-05-23-002`.

Driver — the M7 contract: `@riftydev/net.dispatchToPort` and the SW preview-bridge live in the page realm; the SW posts back to the first window client, which calls into a realm-local `@riftydev/net` port registry. A Worker dev server would need a cross-realm bridge for that registry — non-trivial, touching request streaming and `Request`/`Response` transfer (already an M10 follow-up).

## Options considered

- **A — Main thread (chosen).** Zero bridge work; reuses the M7 SW↔window contract end-to-end. Cost: `installProcessGlobals()` and the `Promise.prototype.then` nextTick patch run on the page realm, observable by other main-thread code (Solid render, Monaco); UI can stutter under heavy Vite work.
- **B — Dedicated Worker + cross-realm bridge.** Isolates Node-compat globals and CPU from UI. Cost: design a port-registry bridge spanning Worker↔Window.
- **C — Run inside the existing REPL Worker.** Globals already installed there. Cost: same registry-bridge problem; mixes user REPL code with a dev-server fixture.

## Decision

Run toolchain dev servers (M10 Dev Mode, Real Vite) on the playground main thread, guarded by a one-shot `globalsInstalled` flag so `Promise.prototype.then` is never double-patched.

Option B is the right long-term answer, tracked as an M10 follow-up. Migration is local: replace `realVite.ts` with a worker-spawning version plus a registry bridge in `@riftydev/net`.

## Consequences

- `devMode.ts` and `realVite.ts` intentionally install Node globals on the page realm. The one-shot guard is mandatory for any new toolchain adapter in this set.
- UI (Solid, Monaco) shares the page event loop with Vite's CPU-heavy passes. Visible jank under load is the explicit trade-off, not a defect.
- Subsequent toolchain adapters (e.g. swc, esbuild as a dev pipeline) follow the same realm choice; a different realm requires superseding this ADR.
- Adopting Option B later is bounded: rewrite the adapter(s) + add the cross-realm port-registry bridge in `@riftydev/net`. No consumer-side change.

## Acceptance criteria

- [ ] No `TODO(ADR): Q-2026-05-23-002` markers remain (`pnpm todo:adr` clean for this Q-ID).
- [ ] `installProcessGlobals()` (or equivalent) invoked at most once per page session — second invocation is a no-op.
- [ ] OPEN_QUESTIONS.md moves Q-2026-05-23-002 to "Promoted" with this ADR as the resolution.
