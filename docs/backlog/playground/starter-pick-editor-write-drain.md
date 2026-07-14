---
area: playground
status: draft
title: Drain outgoing editor writes before Starter paint
created: 2026-07-15
why: picking a Starter from a named Project resets editor models before the workspace switch drains their debounced writes, so a just-typed Project edit can be canceled
user_story: As a developer leaving a named Project for a new Starter, I want my latest Project edit to reach its owner before the editor changes context, instead of disappearing because its debounce timer was cleared.
blocked_by: []
sources: [PR-145-scope-audit-2026-07-15]
code: [apps/playground/src/orchestration/preset-boot.ts, apps/playground/src/App.tsx, apps/playground/src/components/editor-host-core.ts, apps/playground/src/orchestration/workspace-lifecycle.ts]
---

## Context

The Starter-pick flow paints first: `paintStarterUi` resets initial editor files, and `editor-host-core` disposes the outgoing models while clearing their write timers. A later named-Project → Scratch workspace switch drains editor writes, but the pending debounce has already been canceled. Refinement must place the outgoing-owner drain before any editor-context reset, cover timer-pending and owner-ACK-in-flight edits plus drain failure, and prove the new Starter cannot receive a stale outgoing write.

This is distinct from `editor-same-path-write-serialization`: that item orders concurrent writes for one live model; serialization cannot recover a write canceled by lifecycle disposal before the drain begins.
