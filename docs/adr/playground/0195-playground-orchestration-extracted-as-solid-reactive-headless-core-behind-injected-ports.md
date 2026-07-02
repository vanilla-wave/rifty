# ADR 0195: Playground orchestration extracted as solid-reactive headless core behind injected ports

Status: Accepted (2026-07-02)
Date: 2026-07

> TL;DR: `App()` orchestration (boot/restore, project switch, dev-server lifecycle/LIVE, preview set, preset boot) moves into `apps/playground/src/orchestration/*` modules that keep solid-js signals but import zero UI (no xterm/monaco/components/adapters — dep-cruiser-enforced); all side effects go through minimal injected ports declared by each module, subscription lifecycles are explicit `attach*/dispose` methods (App binds them with one-line effects), and those ports are the behavioral-test seam in node vitest.

## Context

App.tsx is a single ~3.6K-line component (~75 signals/effects) transitively importing browser-only xterm → unrenderable in node vitest; its contract degraded to ~395 `expect(source)` greps (epic `playground-testable-core`). The working in-repo extraction pattern (`glue/app-project-store.ts`, `glue/page-store.ts`) proves solid primitives ARE node-testable via `createRoot` — the blocker is UI imports, not solid. Fork recorded at refine: solid-reactive core vs framework-free observable core (decides the later `@riftydev/workbench` lift cost, D-002).

## Decision

1. **Solid-reactive core, not framework-free.** Extracted modules use solid `createSignal`/`createMemo` directly for state App JSX consumes reactively. Rationale: node-testable today (signals/memos work in the solid-server runtime); a hand-rolled observable layer would re-implement solid worse and double the concept count. D-002 (solid only in playground) is unviolated — modules stay in `apps/playground`. **Constraint (measured at extraction): node vitest resolves `solid-js` to the SERVER runtime, where `createEffect` never runs** — so modules must NOT own effects; subscription lifecycles are explicit `attachOwner(...)`-style methods + `dispose()`, and App binds them with one-line `createEffect`s on the owner signal. The `distribution/workbench-controllers` package lift remains its own IRREVERSIBLE decision gated on a real non-Solid consumer; porting signals→explicit observables then is mechanical, and that deferred cost is accepted here.
2. **Location + import ban.** Modules live in `apps/playground/src/orchestration/`. They must not import `monaco-editor`, `@xterm/*`, `../components/*`, `../adapters/*`, or `App.tsx` — enforced by a dep-cruiser rule in `tools/checks/arch-rules.cjs` (`no-ui-imports-in-playground-orchestration`).
3. **Ports are declared by the module (consumer-owned interfaces).** Each module exports the minimal interface of what it needs (owner surface, terminal dispatch, storage, editor host) — the `AppStoreOwner` pattern. App.tsx binds the real owner handle / terminal manager / editor API; no orchestration module reaches for globals.
4. **The port contract is the unit-test seam.** Behavioral node-vitest tests drive a module through its ports with in-test port implementations. This does NOT relax the no-mocks fidelity rule: the port is the module's whole public contract (the unit under test is the orchestration logic, not the owner), and the real page↔owner↔SW fabric stays covered by parity/conformance/e2e plus the browser-unit lane (`toolchain-build/browser-mode-unit-lane`). Port-drift risk (fake port diverges from real owner) is why e2e remains the confirmation tier.

## Consequences

- Orchestration behavior (reload/restore, dev-server lifecycle, LIVE truth, preview set) becomes provable in seconds; each extracted slice retires its `expect(source)` greps in the same PR (RED-checked).
- App.tsx shrinks toward a thin binding shell; M11 "Embeddable" untangling happens as a side effect instead of a future rewrite.
- Slices are coupled (owner handle, dev-server session ids, preset transition queue shared) — extraction order must follow the dependency spine (dev-server lifecycle → boot/restore/switch → preset boot), each slice injectable into the next via ports.
- A later workbench lift pays a signals→observables port; recorded, accepted, out of scope here.
