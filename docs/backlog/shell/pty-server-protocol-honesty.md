---
area: shell
status: active
title: pty-server silently swallows wired protocol cases — pty:resize no-op + exec() on a missing session
created: 2026-06-16
why: two PageToOwner frames are wired client→protocol→owner but the owner handler silently does nothing — a happy-path lie (AGENTS.md §Fidelity — no gap hidden behind a passing path). pty:resize is a wired no-op recorded only as an inline comment (no backlog/TODO/compat ❌/test); exec() on an unknown session returns without emitting pty:exit, so the page run promise never settles (silent hung terminal line)
user_story: As a dev who resizes the terminal mid-run I want SIGWINCH/re-render to actually reach the running process (or a loud "not implemented"), not a silent ignore; and when a protocol-order bug drops a session I want a loud error / synthetic exit, not a terminal line that hangs forever.
sources: [ADR-0146, ADR-0150]
code: [apps/playground/src/workers/pty-server.ts, apps/playground/src/glue/pty-client.ts, apps/playground/src/glue/pty-protocol.ts]
---

## Context

Re-derived at HEAD `805aa45f`. Both are fully-wired frames whose owner handler is a silent no-op:

- **`pty:resize` wired no-op.** `PtyClient.resize()` (`pty-client.ts`) posts a real `pty:resize` frame; the protocol type + `isPageToOwner` validator accept it (`pty-protocol.ts`); the owner handler (`pty-server.ts:178-180`) `return`s with only an inline comment "Dims are per-exec in v1; live resize is a follow-up." It is NOT in ADR-0146's deferred-follow-ups list, has no backlog item, no `TODO(backlog)`, no compat ❌, no test. A page that resizes the terminal mid-run is silently ignored (no SIGWINCH / re-render). The API advertises a capability the system does not deliver.
- **`exec()` missing-session silent hang.** `pty-server.ts:118-119` `const session = sessions.get(sid); if (!session) return;` — on an unknown session it returns WITHOUT emitting `pty:exit`, so the page's run promise for that `rid` never settles (silent stuck terminal line) instead of a loud error. Defensive against an open-before-exec ordering violation, but the failure mode is invisible.

## Options or Next

- **resize:** implement live resize (push cols/rows to the running process / SIGWINCH on the resident shell), OR throw `NotImplementedError('pty.resize')`, OR drop the wired `client.resize()` + `PtyResize` frame until implemented. Until one ships, this item + the at-site `TODO(backlog)` marker make the gap explicit.
- **exec():** emit `pty:exit{code:1,error}` (or throw) on a missing session so a protocol-order violation surfaces instead of hanging.
- Add a test pinning the chosen behavior for each.

## Reversibility

REVERSIBLE — handler behavior + a test; no wire-format change (both frames already exist).
