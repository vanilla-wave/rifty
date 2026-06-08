---
area: vfs
status: parked
title: Lazy per-file OPFS content preload (vs eager full preload at init)
created: 2026-06-08
why: OpfsFsSync.init eagerly preloads all persisted bytes — O(total bytes) memory + O(files) reads at boot
sources: [Q-2026-06-03-307, ADR-0072]
---
## Context
ADR-0072 added a sync content cache to `OpfsFsSync` so `writeFileSync`/`readFileSync` succeed on a brand-new path without an async sync-access-handle open. To make reads synchronous *after a page reload*, `init()` preloads every indexed file's bytes from the paired async OPFS surface into the cache (`preloadContent()`) — O(total persisted bytes) memory + O(files) async reads at boot. No code marker (decision captured in ADR-0072 Consequences; marking the hot loop adds noise).

## Options / Next
- Option A (shipped): eager full preload — every post-reload `readFileSync` sync, trivially correct; heavy boot for a large persisted tree (e.g. real `node_modules`).
- Option B: lazy per-file preload, pre-warmed by an async pass the worker awaits before serving eval — bounded boot cost; needs a deterministic "warm working set before first eval" handshake to keep the *first* post-reload read sync.
Next: switch to B if measured boot is slow on a large persisted tree (measure during M10 integration).

## Reversibility
REVERSIBLE — localized to `OpfsFsSync.init`/`preloadContent`, no public-API or cross-package change. Recorded in Q-2026-06-03-307 + ADR-0072. Gate: measured slow boot on a large tree.
