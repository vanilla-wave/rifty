---
area: distribution
status: parked
title: EPIC C — @riftydev/workbench headless UI controllers (C1-C3)
created: 2026-06-08
why: playground glue/* is already framework-agnostic but locked inside the app; lifting it into a package would let non-Solid consumers reuse the logic (DD-3) — deferred until a non-Solid consumer is concretely pulled
sources: [M11, DD-3, EPIC C, ADR-0003 (D-002)]
---
## Context
`apps/playground/src/glue/*` (sync-mirror-vfs, hmr-bridge, npm-shell-command, preview-bridge-wiring, devMode, registry-fetch, …) is already framework-free but DOM-aware. EPIC C lifts it into `@riftydev/workbench` (L2). depends-on EPIC B (loosely). DD-3: justified now — non-Solid consumers are foreseen; makes the playground a thin shell and sharpens the D-002 boundary (solid-js stays in the binding layer only).

## Options / Next
- C1: move `glue/*` → `@riftydev/workbench`; verify NO upward imports into playground (size M, accepted per DD-3).
- C2: controller APIs `createEditorSync`, `createPreviewBinding`, `createRuntimeSession` — stable headless contracts (M, accepted).
- C3: repoint playground `adapters/use*` to consume workbench → playground becomes a thin binding (M, idea).
- Pull when a second (non-Solid) consumer is real (the reason for C), or when the playground refactor to a thin shell is worth doing on its own.

## Reversibility
IRREVERSIBLE: new package + public controller API (cross-package surface) → needs its own ADR (promote DD-3 to ADR when the track starts). Gate: a foreseen non-Solid consumer; parked until then. The no-upward-imports check (C1) protects the D-002 / no-reverse-imports hard rule.
