# ADR 0003: Playground UI on SolidJS, isolated from core (D-002)

Status: Accepted
Date: 2026-05

Decision D-002: Solid is used only in `apps/playground/`; every `packages/` module stays framework-agnostic TypeScript.

## Rationale

- Fine-grained reactivity fits our update shapes: streaming stdout, FS events, process-tree changes.
- Small runtime — we already ship Monaco and heavy WASM.
- JSX is familiar; shallow learning curve.

## Isolation rules

- Biome/ESLint `no-restricted-imports` bans `solid-js` and `solid-js/web` outside `apps/playground/**`.
- The only core↔UI bridge is `apps/playground/src/adapters/`.
- Cross-boundary events are plain TS callbacks or async iterables, never Solid signals.

## Consequences

- Swapping the UI (VSCode extension, headless harness) is an `apps/playground/` rewrite, not a project-wide migration.
- Runtime stays testable from Node, independent of any UI framework.
