---
area: playground
status: ready
title: Session data-loss guards — beforeunload + Cmd+W + Cmd+S
created: 2026-06-30
why: in memory-backend mode a reflexive Cmd+R / Cmd+W silently destroys all of a user's edits with no prompt (no beforeunload anywhere, and Cmd+W falls through to close the whole browser tab), and Cmd+S pops the browser "Save page as" dialog — a "this isn't a real editor / I lost everything" first impression.
user_story: As a dev who edited a file and reflexively hit Cmd+R, Cmd+W, or Cmd+S, I want my work protected and the standard shortcuts to do the expected thing, but today none of these are intercepted.
epic: frictionless-first-poke
blocked_by: []
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [apps/playground/src/App.tsx, apps/playground/src/glue/degraded-storage.ts, apps/playground/src/glue/editor-tabs.ts, apps/playground/src/components/EditorHost.tsx]
---

## Context

`App.tsx` onKey binds only Cmd+K + Escape (`App.tsx:2161`); a repo-wide grep finds NO `beforeunload`. `closeTab()` exists (`editor-tabs.ts`) but is wired only to the tab's X. Edits auto-persist via a 300ms debounce (`EditorHost.tsx:364-372`), and storage mode + dirty are already tracked for the save badge (`degraded-storage.ts`, `StatusBar.tsx:53-57`). So: Cmd+R / closing the tab in memory mode silently loses edits; Cmd+W closes the browser tab (kills the session); Cmd+S hits the browser save-page dialog.

## Acceptance

- A `beforeunload` listener, active ONLY when storage is memory-backed AND there are unsaved/just-debounced edits, fires the browser's standard "Leave site?" prompt (`preventDefault()` + `returnValue=''`). OPFS-backed (persistent) mode NEVER prompts.
- Cmd/Ctrl+W with an editor tab active → `preventDefault` + close the ACTIVE editor tab via the existing `closeTab()`; does not close the browser tab. With no editor tab focused, the browser default is left alone.
- Cmd/Ctrl+S → `preventDefault` (kills the save-page dialog) + flush the pending debounced write + a transient "Saved" ack (pulse the dirty chip).

## Parity cases

None — browser/editor UX. Verification = e2e: Cmd+S shows no browser dialog and a "Saved" ack; Cmd+W closes a tab not the page; a memory-mode dirty `beforeunload` fires while OPFS-mode does not.

## Out of scope

- A custom in-app "unsaved changes" modal — use the browser-native prompt.
- Autosave-policy changes (`playground/autosave-throttle-policy`); persisting memory-mode work across reload (that is the storage backend, not this guard).

## Decisions

- Reuse the existing dirty + storage-mode signals that already drive the save badge; extend the SINGLE existing capture-phase keydown handler.
- The `beforeunload` is gated on memory-mode + dirty so persistent users never see a spurious prompt.
- REVERSIBLE (playground UX, no public API) → CHANGELOG in apps/playground; no ADR.
