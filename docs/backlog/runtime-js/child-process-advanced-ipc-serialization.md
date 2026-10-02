---
area: runtime-js
status: ready
title: `child_process.fork` with `serialization: 'advanced'` round-trips structured-clone values
created: 2026-09-15
why: vitest's default forks pool calls `fork(entry, [], { env, execArgv, stdio: 'pipe', serialization: 'advanced' })`; rifty throws `NotImplementedError('child_process.serialization.advanced')` at spawn, so the default pool cannot start
user_story: As a real test runner running in the browser shell, I want to fork my worker entry with `serialization: 'advanced'` and exchange rich values over IPC like on my machine, but today the fork itself throws and the pool never starts
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/internal/node-ipc-serialization.ts, packages/runtime-js/src/builtins/process.ts]
ready-verdict: 2026-10-02 — Contract+RED @ <pending>
---

## User scenario

Goal I4: vitest's default forks pool calls `fork(entry, [], { env, execArgv,
stdio: 'pipe', serialization: 'advanced' })` (evidence §I4); today:
`NotImplementedError: child_process.serialization.advanced` at spawn — the
pool cannot start (main 51440931a).

## Context

Oracle (Node v24.16.0, evidence §Oracle): `fork(child, [], { serialization:
'advanced', stdio: 'pipe' })` round-trips `Date`, `Map`, `[undefined]`,
`Uint8Array` with types intact, and `send(() => {})` throws
`TypeError/ERR_INVALID_ARG_TYPE` (host oracle run 2026-10-02, see Parity
cases). Browser twin of the v8 serializer is structured clone; the kernel
channel already carries structured-clone frames. The child side switches by
launch kind (`process.ts` `#jsonIpc`), the parent side JSON round-trips every
message (`node-ipc-serialization.ts`) and refuses the option at spawn.

## Acceptance

1. `fork(child, [], { serialization: 'advanced', stdio: ['ignore','ignore','ignore','ipc'] })`
   starts the child; structured-clone values (`Date`, `Map`, `[undefined]`,
   `Uint8Array`, bigint) cross child→parent and parent→child with types
   intact (`→ scenario`).
2. Under `'advanced'`, `child.send(() => {})` throws
   `TypeError/ERR_INVALID_ARG_TYPE` — functions never cross the channel
   (`→ scenario`).
3. Fork lifecycle semantics are unchanged from the JSON path: disconnect then
   kill ends the child with `{ code: null, signal }`; `child.kill()` returns
   `true` (`→ scenario`).
4. The JSON default is untouched: existing `child_process/public-ipc-json`
   parity case stays green without edits (`→ scenario`, baseline).

## Parity cases

Real Node v24.16.0 (executed oracle run 2026-10-02, physical run-in-node):
probe/roundtrip all true (`Date(0)`, `Map`, `[undefined]`, `Uint8Array`,
bigint; parent `Map`→child→parent keeps `Date(5)` inside), `fnSend`
`TypeError/ERR_INVALID_ARG_TYPE`, `killed true`, exit
`{ code: null, signal: 'SIGUSR2' }`. RED target:
`child_process/public-ipc-advanced.case.ts` — fails today on the rifty side:
`fork` throws `NotImplementedError` at spawn, no worker is constructed
(runner physical-worker guard: constructed 0).

## Out of scope

- The kernel channel framing, ordering and disconnect coordination — the
  JSON path owns them and stays untouched (no new mechanism).
- Worker threads IPC — owned by the worker-threads units.
- Unrecognized `serialization` values (Node throws `ERR_INVALID_ARG_VALUE`,
  host probe 2026-10-02; rifty silently accepts) — adjacent gap, routed to
  backlog, not this unit.

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| unsupported value over channel | `child.send(() => {})` under `'advanced'` | loud `TypeError/ERR_INVALID_ARG_TYPE` — carried by the parity case |
| JSON path regression | default fork round-trip incl. circular-send rejection | unchanged — carried by `child_process/public-ipc-json.case.ts` |

## Decisions

- ready-verdict: 2026-10-02 — Contract+RED @ <pending>
- 2026-10-02 — agent (PICKUP): same channel, `serialization: 'advanced'`
  means pass frames through structured clone instead of the JSON
  round-trip; child switches on launch kind (`#jsonIpc=false`), parent on
  the option. Ordering/disconnect semantics untouched — no new coordination
  mechanism (Class-kill).