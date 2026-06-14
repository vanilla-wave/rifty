---
area: playground
status: parked
title: Transient wrong-port window when switching presets across templates
created: 2026-06-12
why: useMode.loadPreset flips realVitePort to the new template's port before the old server stops; UI rebinds to a dead port for seconds
user_story: As a playground developer switching the vite↔express preset (`5174↔3210`), I want the preview to stay live until the new server is listening, but today `loadPreset` flips `realVitePort` eagerly so for seconds the preview tab and open-link hand out a dead 503 port while the old worker is still restarting.
sources: [ADR-0130 review]
code: [apps/playground/src/adapters/useMode.ts, apps/playground/src/App.tsx]
---

## Context

On a vite↔express preset switch (ports 5174↔3210), `loadPreset` sets `realVitePort` synchronously while the OLD worker keeps serving until `restartDevServer` finishes (seconds + npm install). During the window: snapshot subscription + node_modules bridge detach from the live worker, `previewUrl()`/open-tab hand out a 503 port, keyed PreviewPanel remounts to a not-yet-listening port, mode chip shows new name with old status. Self-heals when the restart completes (status passes 'stopped', effects re-run). Newly REACHABLE because ADR-0130 wired `preset.templateId`; the code path itself predates it.

## Options or Next

Defer `setRealVitePort` to boot completion — `runViteCommand` already calls `machine.setRealVitePort(handle.port)`; drop the eager set in `loadPreset` and re-check the effects keyed on the port. Needs care: PreviewPanel keying + initial boot ordering.

## Reversibility

REVERSIBLE (UI sequencing; recorded here + ADR-0130 follow-ups).
