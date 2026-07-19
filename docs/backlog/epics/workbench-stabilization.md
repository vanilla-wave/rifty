---
kind: epic
status: ready
title: Workbench mainline stabilization — actionable edits and original-source diagnostics
created: 2026-07-19
value: The ordinary edit-and-run loop preserves both versions when a terminal tool changes an open file and points configuration errors to the developer's original source.
user_story: As a developer iterating on a real Node project, I want editor conflicts to offer a safe next action and startup errors to name my source, but today ordinary terminal edits lead to a repeating toast and generated ESM diagnostics point at a temporary module.
items: [playground/editor-conflict-recovery, runtime-js/plain-esm-inline-source-map-fidelity]
---

## Outcome

The normal Workbench loop is actionable without fault injection. When a terminal formatter, generator, or Git command changes a file already open in Monaco, the editor retains both byte sequences and offers Reload, Compare, and CAS-protected Replace. When an ordinary Node tool generates plain ESM with an inline source map, a thrown configuration error names the original source and line rather than Rifty's generated module.

Vite is the first real acceptance consumer for diagnostics, not a production branch condition. The implementation remains generic module-loader behavior and introduces no Vite field, cache, wire shape, or cross-tool contract.

## User scenario

A developer opens the real Vite Starter, edits `src/main.ts` in Monaco, then runs `npx prettier --write src/main.ts` from the terminal. Workbench keeps the local draft and exact formatted bytes, then lets the developer Reload, Compare, or explicitly Replace against the displayed remote version. No choice silently discards either version.

They introduce a runtime error in `vite.config.ts` and run the real `npm run dev`. Vite's ordinary bundle-config path emits a plain ESM module with an inline map; terminal and preview diagnostics point to `vite.config.ts` and the original line. After the developer fixes that source, the project reaches LIVE.

## Items

- `playground/editor-conflict-recovery` (draft) — expose Reload, Compare, and CAS-protected Replace without discarding either version.
- `runtime-js/plain-esm-inline-source-map-fidelity` (draft) — preserve generic inline-map source identity and prove it through unmodified Vite config loading.

## Scope boundaries

- `workbench-fault-honesty` owns delayed/lost mutation terminals, persistence faults, and failed preview teardown. Those branches require explicit fault injection and are not completion criteria here.
- `vite-knowledge-boundary` owns package-specific knowledge direction. Vite may appear in acceptance evidence, never in generic source-map production behavior.
- `runtime-js/process-module-loader-surface` owns public source-map enable APIs; `runtime-js/worker-stack-remap-error-overlay` owns worker/runtime-phase propagation and overlay UI.
- Successful project switching already performs a full old-session stop before a fresh open. Failed teardown during that transition belongs to `workbench-fault-honesty`.
- `playground/node-server-restart-on-edit` is the next mainline candidate, deliberately outside this wave: it adds watch/restart capability rather than repairing an existing flow, and its premise predates the Workbench migration — re-audit before refine.
