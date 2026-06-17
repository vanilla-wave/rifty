---
area: vfs
status: active
title: OPFS persistence — write→reload round-trip in a real browser session
created: 2026-06-08
why: M4 open acceptance — sync backend + conformance exist; the OpfsFsSync init→preload→read round-trip across a real reload is now covered via the owner shell path (P5); a direct vfs-level e2e remains nice-to-have
user_story: As a developer with a rifty app on OPFS, I want edits to `/workspace/*` to survive a `page.reload()` in a `crossOriginIsolated` tab — covered through the owner shell; a non-shell direct write→reload assertion is the residual.
sources: [TASKS M4, ADR-0013, ADR-0072, A-004, ADR-0143]
---
## Context
M4 open-acceptance item: OPFS persistence (write→reload round-trip in a real browser session). The sync backend (`OpfsFsSync`, ADR-0013/0072) and 25 conformance cases existed. **Doc-drift corrected (2026-06-15):** the previously-claimed `tests/e2e/m0-boot.spec.ts` reload assertion does NOT reload — it is a same-session `echo > f && cat f` round-trip (the `persist-…` marker is just a unique name). So the OpfsFsSync init→preload→read round-trip across a real `page.reload()` was unverified until P5.

## Covered (2026-06-15, P5 of ADR-0143 "D")
`tests/e2e/owner-persistence-reload.spec.ts` exercises it end-to-end where `OpfsFsSync` actually runs — the workspace owner Worker: `await initBackend()` (selects `'opfs'`), a shell `echo > /workspace/persist.txt` write-through persists, `page.reload()` terminates + re-boots the owner (fresh `OpfsFsSync.init` → `preloadContent`), and `cat` returns the bytes (fails on the memory backend, so honest).

## Residual / Next
The covered path goes through the owner shell. A thin direct-vfs e2e (write via the in-Worker OPFS VFS API, reload, read back — no shell) would pin the `OpfsFsSync` round-trip independent of the shell layer. Low priority now that the owner path proves it.

## Reversibility
REVERSIBLE — verification/test work; no public-API change. Backed by ADR-0013 (OPFS-primary VFS) + ADR-0072 (content cache + write-through).
