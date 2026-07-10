---
area: playground
status: draft
title: Compatibility inspector for preflight and observed gaps
created: 2026-07-09
why: Compatibility truth is split between public Markdown, stderr, and disconnected runtime telemetry, so users cannot distinguish a browser ceiling, known rifty gap, incompatible package, divergence, or unclassified failure in context.
user_story: As a developer whose project hits a rifty limitation, I want the IDE to explain exactly what is known and link to evidence, but today I must search external matrices and terminal output myself.
epic: honest-compatibility-in-the-ide
blocked_by: [playground/project-compatibility-preflight, playground/compatibility-event-bridge, playground/compatibility-diagnostics-adapter, playground/structured-execution-diagnostics]
sources: [M11, docs/public/compat/README.md]
code: [apps/playground/src/components/BottomPanel.tsx, apps/playground/src/components/StatusBar.tsx, packages/runtime-js/src/telemetry/divergence-sink.ts]
---

## Context

Combine the preflight report with observed owner-authoritative events and relevant retained diagnostics for the active project/run. Runtime `NotImplementedError` and divergence records arrive through `playground/compatibility-event-bridge`; structured install/native and unclassified failures arrive through `playground/structured-execution-diagnostics` and the diagnostics hub. Preserve categories: browser ceiling, known rifty gap, incompatible package, known divergence, and unclassified failure. Each entry names whether it is predicted or observed, the feature/package, affected run, status/caveat, and direct matrix/test evidence where one exists.

The inspector must not parse stdout/stderr, infer that silence means compatibility, merge generic exceptions into known gaps, or produce a project score. Raw terminal output remains available; this surface is a compatibility-specific projection over producer records while the diagnostics hub owns retention, resolution, and deduplication.

## Reversibility

REVERSIBLE UI composition once its inputs exist; any new public compatibility catalog/event interface follows the decisions in its blocking items.
