# ADR 0003: Playground UI on SolidJS, isolated from core (D-002)

Status: Accepted
Date: 2026-05

Summary of decision D-002. Solid is used only inside `apps/playground/`. Every package under `packages/` is framework-agnostic TypeScript.

## Rationale

- Fine-grained reactivity matches our updates well: streaming stdout, file-system events, process-tree updates.
- Small runtime; we already ship Monaco and WASM-heavy payloads.
- JSX is familiar, learning curve is shallow.

## Isolation rules

- ESLint/Biome rule `no-restricted-imports` bans `solid-js` and `solid-js/web` everywhere except `apps/playground/**`.
- The only place ratiocinating between core and UI is `apps/playground/src/adapters/`.
- All cross-boundary events are plain TypeScript callbacks or async iterables, never Solid signals.

## Consequences

- Swapping the UI (e.g. for a VSCode extension or a headless harness) is a `apps/playground/` rewrite, not a project-wide migration.
- The runtime stays testable from Node, independent of any UI framework.
