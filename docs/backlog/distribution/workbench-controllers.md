---
area: distribution
status: ready
title: "@riftydev/workbench — headless session controllers lifted from the playground"
created: 2026-06-08
why: the embed scenario's logic (sandbox boot, pty, npm-shell, editor↔VFS sync, HMR/preview bridge) is framework-free but locked inside apps/playground — no package a SaaS can import
user_story: As a SaaS developer embedding rifty with my own UI, I want headless controllers from `@riftydev/workbench` to drive boot/terminal/install/preview/editor-sync, but today that glue lives only inside the Solid playground app.
epic: embeddable-dev-loop
sources: [DD-3, ADR-0003 (D-002)]
code: [apps/playground/src/glue, apps/playground/src/orchestration]
---

## Context

`apps/playground/src/glue/*` + `src/orchestration/*` are already framework-free (explicit attach/dispose, no createEffect dependence) but app-internal. Lift the embed-relevant core into `@riftydev/workbench` (layer: above sdk/runtime packages, below any UI binding). Playground-specific presentation prefs (layout-store, splitter-size, fonts, terminal-theme, launcher-prefs, preset-deep-link) stay in the app. Boundary vs the parked SDK API items (`public-api-ai-agent-*`): those are sandbox-level headless APIs (exec/snapshot for agents); workbench is the UI-session layer above the sdk.

## Acceptance

- `@riftydev/workbench` published (sync:publish SPEC, lockstep 0.x); public API sufficient to drive the epic scenario end-to-end with zero `apps/playground` imports: session boot/teardown (project files in, capabilities/degraded-storage surface out), pty terminal session (attach/write/resize/dispose), shell command run incl. `npm install` + dev-server launch, preview binding (LIVE state + URL, SW round-trip proven), editor↔VFS sync (open/dirty/save → HMR), file-tree model (list/watch/create/rename/delete).
- Framework-free public API: plain methods + subscribe callbacks + explicit `dispose()`; no solid-js in the package (D-002 sharpened: solid stays in bindings/app).
- Bundler-agnostic: plain ESM, zero vite-specific imports/plugins/`import.meta.env`; every asset URL (worker, sw, wasm) and the registry endpoint are host-injected config (D-004).
- Playground repointed to consume `@riftydev/workbench` for every lifted module — no second copy left in the app (kills `sibling-drift` structurally); existing glue/orchestration unit tests move with the code.
- `pnpm check:arch` rules updated: layer position enforced, no reverse imports from workbench into playground, no foreign `src/internal/*`.
- Second session boot on one page throws loudly (kernel/SW singletons — single instance per page).

## Parity cases

None — no new Node-API surface; runtime behavior stays in the existing `@riftydev/*` packages. The drift oracle is structural: playground consumes the package (same code paths), moved unit suites stay green, playground e2e lanes stay green.

## Out of scope

- UI components of any kind (→ `distribution/react-bindings`).
- Multi-sandbox per page — second boot = loud throw, documented.
- SSR/Node usage of controllers — browser-only; constructing a session without DOM/Worker throws loudly.
- Lifting playground presentation prefs (layout, fonts, themes, deep-links) — stays in-app.
- TS language service controller (heavy owner-spawn relay) — stays in-app this pass, named residual in `distribution/react-bindings`.

## Decisions

- DD-3 (package justified) is the decision; implementer records it as the ADR at track start (`pnpm adr:new distribution "…"`) — content pre-resolved here: package name `@riftydev/workbench`, layer position, framework-free API shape, single-instance rule. No open forks.
- API style: explicit attach/dispose + subscribe callbacks (matches existing orchestration modules) — no reactive-framework primitives in the public surface.
- Registry endpoint: required explicit config, no default URL (D-004; self-host recipes already in `docs/public/hosting-*`).
- Verified host = Vite only this epic; design stays bundler-agnostic, other bundlers honestly "not verified" in `docs/public/embedding.md` (user call 2026-07-10).

## Fault matrix

| axis × operation | honest outcome |
|---|---|
| `quota-perm-fail` × session boot on non-COI host page | loud: boot rejects with `COI_REQUIRED_MESSAGE`; capabilities surface exposed so the host renders its own fallback — never a hung mount |
| `provenance-lie` × preview LIVE state | LIVE only after real SW round-trip proof; SW registration/scope failure → loud preview error state, never optimistic LIVE |
| `unbounded-read` × npm install via host registry endpoint | stalled/hung proxy → bounded fetch chokepoint (ADR-0201) → install fails loudly in the terminal |
| `false-fallback` × missing/malformed registry config | loud validation error at session init — install capability never silently absent |
| `quota-perm-fail` × OPFS persist during session | OPFS unavailable (private mode) → visible degraded-storage state (memory-only), embedder-observable; quota fail mid-write → loud error event, tree never trusted as durable |
| `torn-state` × teardown (unmount/navigation) mid-run | dispose kills workers/pty and revokes preview routes; no orphan SW handlers claiming LIVE |
| `concurrent-same-key` × second session boot on one page | loud throw at boot (documented single-instance) — never two writers on kernel/SW singletons |
| `sibling-drift` × playground vs workbench copies | killed structurally: playground repointed to consume the package, lifted modules deleted from the app |
