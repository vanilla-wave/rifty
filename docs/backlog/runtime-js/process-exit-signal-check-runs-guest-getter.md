---
area: runtime-js
status: draft
title: "Telling rifty's exit signal from a guest error reads the error's `code` through its getters"
created: 2026-11-23
why: A guest error with an accessor on `code` runs that getter when it is thrown fatally (stdout `RAN`), where Node never reads it; every host
sources: [docs/public/compat/process.md, docs/backlog/epics/node-file-entry-parity/ledger.md]
code: [packages/runtime-js/src/builtins/process-lifecycle-events.ts, packages/runtime-js/src/builtins/node-entry.ts]
---

## Context

PR #421 internal verify, round 7 (2026-11-23, isolate probe vs live `node -e`):
`try { require('./nope') } catch (e) { Object.defineProperty(e, 'code', { get() { console.log('RAN'); return 'X' } }); throw e }`
→ Node: stdout '', the report shows `code: [Getter]`; rifty: the report text
matches Node's but stdout has `RAN`. The fatal report itself reads `code` by
descriptor (PR #421); the remaining read is main's `isRiftyProcessExit`
(`process-lifecycle-events.ts`, also `node-entry.ts`): `value.code ===
RIFTY_PROCESS_EXIT` on every thrown value the lifecycle sees. Fix candidate: a
brand (WeakSet or private symbol) for rifty's own exit signal instead of a
`code` read. Acceptance: the probe's stdout equals Node's on every host.
Owner: runtime-js (process lifecycle); trigger: next lifecycle change.

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
