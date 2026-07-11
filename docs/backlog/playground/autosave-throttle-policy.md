---
area: playground
status: draft
title: Named-project autosave throttle/cadence policy
created: 2026-06-21
why: ADR-0165 says named projects autosave with no Save button, but the trigger/cadence is unspecified — every keystroke would thrash OPFS, never saving would lose work on a crash
user_story: As a user editing a named project, I want my edits durable without a Save button (ADR-0165) and without the IDE hammering disk on every keystroke, but the autosave trigger is currently undefined.
sources: [ADR-0165, ADR-0072]
code: [apps/playground/src/App.tsx, packages/workbench/src/glue/workspace-archive-port.ts]
---

## Context

ADR-0165 §7: named projects autosave (no Save button, no dirty state, subtle `Autosaved · <name>` toast). Edits flow as owner file-writes into `/projects/<id>/` (already durable on OPFS write-through). So "autosave" here is mostly INDEX metadata (`editedAt` bump) + ensuring the owner flush lands — but the toast/`editedAt` cadence is unspecified. Naive options: bump on every `onFileWritten` (toast spam + index write thrash) vs on-idle/on-blur/beforeunload (cleaner, slight loss window).

## Options or Next

- Pick a throttle: debounce `editedAt`/index writes + the `Autosaved` toast to on-idle (e.g. ~1–2s after last write) + a `beforeunload`/`visibilitychange` flush.
- Decouple file durability (immediate OPFS write-through) from metadata cadence (throttled) — document that file bytes are already durable; the throttle is for index/UX only.
- Define the toast frequency (once per idle burst, not per file).

## Reversibility

REVERSIBLE — a tuning constant + debounce, recorded here. No public API change; file durability is unaffected (already write-through).
