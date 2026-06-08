---
area: vfs
status: active
title: OPFS persistence — write→reload round-trip in a real browser session
created: 2026-06-08
why: M4 open acceptance — sync backend + conformance exist, but real-browser write→reload persistence is unverified end-to-end
sources: [TASKS M4, ADR-0013, ADR-0072, A-004]
---
## Context
M4 open-acceptance item: OPFS persistence (write→reload round-trip in a real browser session). The sync backend (`OpfsFsSync`, ADR-0013/0072) and 25 conformance cases exist, and A-004 added an e2e reload assertion (`tests/e2e/m0-boot.spec.ts` writes `/workspace/persist.txt` → `page.reload()` → asserts survival). The remaining gap: a full real-browser persistence round-trip across a session exercising the OPFS path under cross-origin isolation (not just the bootstrap smoke), confirming edits survive reload via the OPFS content cache + write-through.

## Options / Next
Next: a Playwright e2e in a crossOriginIsolated browser that writes through the in-Worker OPFS VFS, reloads, and reads back — covering the OpfsFsSync init→preload→read path end-to-end (beyond the existing m0-boot smoke). Confirm `detectVfsBackend()` selects `'opfs'` and the round-trip holds.

## Reversibility
REVERSIBLE — verification/test work; no public-API change. Backed by ADR-0013 (OPFS-primary VFS) + ADR-0072 (content cache + write-through).
