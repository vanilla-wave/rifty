---
area: runtime-js
status: draft
title: Preserve fetch keepalive through Response.clone lifecycle
created: 2026-08-11
why: The keepalive Body wrapper retains the original internal stream while native Response.clone tees and replaces it, so later read/cancel can target a locked stale source.
user_story: As a finite Node child using a dependency that clones a fetched Response before reading it, I want both branches to retain native Chromium body and event-loop lifecycle instead of a stale-stream error or premature drain.
sources: [ADR-0158, tests/e2e/fetch-keepalive-webassembly-streaming.spec.ts]
code: [packages/runtime-js/src/builtins/fetch-keepalive.ts]
---

## Context

No matching backlog item was found by title/code/epic search. The final PR-122
review isolated this path on the real keepalive wrapper:

```ts
const response = await fetch(url);
const clone = response.clone();
const reader = response.body!.getReader();
await reader.cancel();
```

Chromium's native clone tees the internal body and both resulting branches keep
their own valid lifecycle. The installed wrapper has already captured the old
public source; clone locks that source, then wrapper cancellation releases the
keepalive ref but rejects with an invalid-state/locked-stream error. An
untracked Response clone remains native, and the realm-wide WebAssembly
streaming ceiling is independent of this Body-wrapper defect.

The unresolved fork is ownership: supporting clone may require one exact Body
authority shared by Body mixins, public streams, clone branches, and borrowed
primordials; a tracked-only loud ceiling must also close borrowed clone escapes.
Do not implement either mechanism until this draft is refined and Contract+RED
pins direct/borrowed clone, both branch consumption orders, cancellation/error,
metadata, and drain lifecycle.
