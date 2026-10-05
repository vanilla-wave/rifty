---
area: runtime-js
status: draft
title: advanced IPC reports a ceiling for shared-backed views
created: 2026-10-02
why: Node copies shared-backed view bytes at each value visit; browser clone shares memory
user_story: As a browser Node developer, I want fork advanced IPC to send a Buffer backed by SharedArrayBuffer, but rifty throws an explicit ceiling.
sources: [docs/adr/runtime-js/0503-reject-shared-backed-advanced-ipc-values-before-send.md, docs/backlog/runtime-js/reference/vitest-ipc-sab-ceiling-decision.md, docs/public/compat/vitest.md]
code: [packages/runtime-js/src/internal/advanced-ipc-values.ts]
---

## Context

Actual Node v24.16.0: later getter mutates shared Buffer1→2; V8 sends1.
Browser clone + postclone copy sends2. Earlier getter requires2; entry copy fails.
Advanced fork now throws child_process.serialization.advanced.SharedArrayBuffer
for every reached shared-backed view, including Buffer. Thread clone is separate.
Compat ❌; exact Vitest scenario excludes this payload, goal unchanged.
Dedup: existing advanced-ipc goal item covers ordinary Node-core payloads;
stream-byte-chunk-kinds/parallel-worker-threads do not own V8 snapshot observation.
No matching declined concept. Owner: runtime-js; trigger: shared-backed fork payload.
