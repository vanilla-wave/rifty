---
area: vfs
status: active
title: VFS change events on the write path (replace explorer bounded poll)
created: 2026-06-08
why: "@riftydev/vfs emits no change events; playground file explorer falls back to a 1.5s poll of expanded dirs"
sources: [ADR-0075]
code: [apps/playground/src/components/FileExplorer.tsx:152]
---
## Context
`@riftydev/vfs` exposes no change events. Playground `FileExplorer` refreshes via (1) an action-triggered nonce and (2) a 1.5s `setInterval` poll of *expanded* dirs, gated on Explorer view visible + page foregrounded. Live TODO(backlog: vfs/vfs-change-events) marker at the poll `setInterval` in `FileExplorer`. Correct fix lives in a lower layer (the VFS write path) so consumers stop polling.

## Options / Next
Provisional (shipped): bounded poll, reversible — tune interval or swap for events later. Proper fix: emit change events from the VFS write path (every write/mkdir/rm/rename) so explorer (and any consumer) subscribes instead of polling. Cross-package surface on `@riftydev/vfs` → needs its own ADR before landing.

## Reversibility
Poll itself REVERSIBLE. The fix — adding a change-event surface to `@riftydev/vfs` (lower layer, cross-package public API) — is IRREVERSIBLE; record a new ADR when taken up.
