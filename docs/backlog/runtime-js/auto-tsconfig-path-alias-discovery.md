---
area: runtime-js
status: parked
title: Automatic tsconfig discovery for path aliases (vs explicit paths option)
created: 2026-06-08
why: ADR-0066 ships explicit caller-supplied paths; auto-discovery deferred until a consumer needs zero-wiring
sources: [Q-2026-06-01-305, ADR-0066]
---
## Context
ADR-0066 added tsconfig-style path aliases via an explicit `paths` option on `ModuleLoaderOptions`; resolver does pure pattern matching, caller (opencode harness) reads `tsconfig.json` `compilerOptions.paths` and supplies the resolved map. Open: should the runtime ALSO auto-discover — locate `tsconfig.json`, follow the `extends` chain (opencode extends `@tsconfig/bun`), interpret `baseUrl`, apply `paths` with no caller map. No provisional code; deferral recorded in ADR-0066 Reversibility (no TODO(backlog) marker to clean).
## Options / Next
Chosen (provisional): A — explicit `paths` only; B (auto-discovery in runtime) deferred until a concrete consumer (e.g. playground "open a TS project") needs zero-wiring. B is purely additive over A (computes the same map), so deferring costs nothing and keeps the core resolver minimal/Node-faithful. Promote B to its own ADR when a consumer needs it — no superseding of ADR-0066.
## Reversibility
Reversible — additive over A, no contradiction with ADR-0066. Gate: a real "open a TS project" consumer. `extends`-chain/`baseUrl`/comment-tolerant parse risk subtle tsc deviations, so write a parity check when taken up.
