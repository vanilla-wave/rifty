---
area: runtime-js
status: draft
title: advanced IPC reports a ceiling for browser-only clone brands
created: 2026-10-02
why: browser structured clone preserves web brands where Node V8 serializes own properties
user_story: As a browser Node developer, I want fork advanced IPC to send a Blob with own properties, but rifty throws an explicit ceiling.
sources: [docs/backlog/runtime-js/reference/vitest-run-execution-evidence.md, docs/adr/runtime-js/0502-clone-the-original-ipc-graph-with-weak-buffer-side-references.md, docs/public/compat/vitest.md]
code: [packages/runtime-js/src/internal/advanced-ipc-values.ts, packages/runtime-js/src/internal/advanced-ipc-values.test.ts]
---

## Context

Actual Native V8 Blob becomes an ordinary record; browser clone preserves Blob
and omits own-property getters. Snapshot ordinary data loses uncloneable internal
brands; original-graph native authority is required for honest rejection.
Advanced fork rejects reached browser-only clone brands with
child_process.serialization.advanced.WebObject; compat ❌. Exact Vitest excludes them.
Dedup: advanced-ipc goal item covers Node-core values; no web-brand item or declined
concept matches. Owner: runtime-js; trigger: web object in advanced fork payload.
