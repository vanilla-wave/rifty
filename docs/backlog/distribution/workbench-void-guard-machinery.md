---
area: distribution
status: draft
title: Workbench workers drop guard machinery whose fault class or producer no longer exists
created: 2026-09-27
why: a duplicate-request ledger guards a MessagePort boundary whose model excludes duplicate delivery, and a pty `beforeRun` gate has had no producer since the sealed-workbench extraction — both survive the class-kill and simplicity rules by being old
sources: [ADR-0263, ADR-0326, docs/process/rules/fault-classes.md, docs/backlog/npm-client/reference/shadow-registry-retro-intake-evidence.md]
code: [packages/workbench/src/workers/playground-session-tools-owner.ts, packages/workbench/src/workers/pty-server.ts, packages/workbench/src/workers/workbench-project-runtime.ts]
---

## Context

Two findings, one sweep (observed on `99fdf6c91`):

1. `playground-session-tools-owner.ts:147` keeps `const seenRequestIds = new
   Set<string>()` and rejects a frame whose `requestId` was seen (:452-457,
   `TypeError('Playground session tools duplicate request id …')`). The frames
   arrive over the page↔owner MessagePort; fault-classes §Boundary failure
   models lists duplicate message delivery as physically excluded there. The
   only producer is first-party page code. The retro review of the
   shadow-substitution series (2026-08-04) flagged it as the replay-ledger
   class the series' deletion pass declared impossible for same-realm ports
   (and which the retired `budget.mjs` matched by regex); the repo-wide
   class-kill sweep did not reach it (code from 2026-07-16). Pickup decides
   by §Class-kill inventory: void replay-ledger (delete, boundary model is the
   proof) or corrupt-input validation of own code (then the invariant belongs
   to the page-side request-id allocator, one owner, not a Set that grows for
   the session).
2. `pty-server.ts:148` declares `beforeRun?: (emit) => void | Promise<void>`
   and awaits it before each command (:412-419); `createPtyServer` in
   `workbench-project-runtime.ts:386-393` — the only production constructor —
   does not pass it (`grep -rn beforeRun packages apps | grep -v test` →
   declaration and use site only; the other hits are pty-server tests). Its consumer, the "restoring project dependencies…" terminal
   line, was removed by `7f725b31c` (2026-07-23, sealed workbench extraction);
   the sealed workbench opens the project before the terminal accepts
   commands (readiness binary at the stamp — declined-concepts row 2026-09-01)
   and the page shows `project-open-progress`. Hook is dead, gate-free path is
   the only path.

Expected: each mechanism either restates its forcing constraint (§Class-kill
"ported = added") or is deleted with its tests; no replacement mechanism.
Behavior-preserving on the only reachable path; CHANGELOG line per package.

Dedup: no title/`code:`/map/declined match; `distribution/workbench-controllers`
owns the package outcome, not this sweep.

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->
