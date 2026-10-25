---
area: playground
status: draft
title: Serialize editor writes per owner path
created: 2026-07-15
why: two flushes for the same editor path can be in flight together, so an older completion can overwrite newer bytes in the owner VFS
user_story: As a developer editing a real Node project, I want the newest text I flushed for one file to remain in the project, but today a slower older write can land after the newer write and silently restore stale code.
blocked_by: []
sources: [PR-145-scope-audit-2026-07-15]
code: [apps/playground/src/components/editor-host-core.ts]
---

## Context

This defect predates PR #145 and was found while separating that PR's Save-transition work from generic editor hardening. editor-host-core tracks one in-flight promise per path, but a second flush replaces the map entry instead of waiting for the first owner write. If v1 is still pending, the model changes to v2, and another flush starts, both onFileWritten(path, content) calls can execute concurrently. When the v2 request completes first and v1 completes last, the owner VFS ends with stale v1 while the editor may already appear clean.

The PR #145 host-commit coordinator and its Save lease do not own this general debounce/flush ordering bug: ordinary edits, explicit flushes, close/rename preparation, and future non-Save callers all reach the same per-path writer. Refinement must enumerate those callers, define the single serialization owner, and pin the out-of-order completion as RED before choosing an implementation.

2026-10-25 — retirement pending proof landing: editor writes route `onFileWritten` → `project.documents.write` (`playground-app.tsx:1636`) → per-path FIFO `enqueue` in `createPlaygroundDocumentWriter` (`apps/playground/src/adapters/playground-project-view.ts:456`, `:493`, `write` `:564`). Proof test written, not landed: PR #158 previous head `1533ea589`, `apps/playground/src/adapters/playground-project-view.contract.test.ts:394-446` ("serializes same-path writes so a slower first save cannot restore stale bytes"; green on main, red when `write` bypasses `enqueue`). Port it as a small reviewed unit (needs a REV-8 landing verdict), then delete this item with a `tools/refs/check.mjs` tombstone + `docs/adr/README.md` removed-list entry.
