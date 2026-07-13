# ADR 0161: Vite 8 disables HMR pending socket parity

Status: Accepted
Date: 2026-06

> TL;DR: The Vite 8 template disables HMR until the native socket/HMR path is
> re-proven against Rolldown's WASI worker pool.

> Correction 2026-07-13 (ADR-0174): Vite 8's visible seeded
> `vite.config.js` owns `server.hmr: false`; the retired `ProjectSpec.hmr` field
> no longer carries this policy. The HMR-off decision is unchanged.

## Context

ADR-0145 requires Real-Vite HMR to be Vite-owned through native `server.ws`
over rifty's HTTP WebSocket upgrade bridge. That remains the target shape.

The Vite 8 bump changes the forcing consumer: Vite now pulls Rolldown's
`@rolldown/binding-wasm32-wasi` pthread worker pool and LightningCSS. This
branch is scoped to boot/install/serve prerequisites for that stack; sockets/HMR
are explicitly out of scope for the Vite 8 cut.

## Decision

- `VITE_TEMPLATE.hmr.enabled` is `false` for the Vite 8 template.
- No rifty-synthesized HMR payloads or reload-only fallback are reintroduced.
- Vite-owned HMR remains deferred until the Vite 8 Rolldown path has a browser
  SAB/kernel-worker test harness that also exercises native `server.ws`.

## Consequences

- The default Vite 8 path is honest: it does not claim HMR while sockets/HMR
  are out of scope.
- ADR-0145 is corrected only for the Vite 8 template default; its "Vite owns HMR"
  architecture still stands when HMR is re-enabled.
- `tests/e2e/m10-hmr.spec.ts` and the browser-HMR backlog stay opt-in/future
  coverage, not evidence for this Vite 8 support branch.
