---
area: runtime-js
status: draft
title: Named ESM imports of prototype builtin methods lose the receiver
created: 2026-10-01
why: ADR-0498 exports class-backed builtin prototype methods as ESM named exports UNBOUND — `import { exit } from 'node:process'; exit(7)` throws `TypeError: Cannot write private member #exitCode to an object whose class did not declare it` (interop.ts keeps the bare prototype method, `NodeProcess.exit` requires `this.#exitCode`); Node v24.16.0 exits with code 7 and empty stderr
user_story: As a user whose dependency does `import { exit } from 'node:process'` (or destructures any private-field-touching process method) I want Node's behavior — the call reaches the process instance — but today rifty throws a private-field receiver TypeError
sources: [docs/backlog/runtime-js/reference/builtin-static-names-prototype-methods-final-green.json]
code: [packages/runtime-js/src/module-loader/cjs-interop-authority.ts, packages/runtime-js/src/module-loader/interop.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

Verified 2026-10-01 by the independent Final+GREEN reviewer of
`builtin-static-names-prototype-methods` (round 2), reproduced by two
reviewers: oracle Node v24.16.0 `import { exit } from 'node:process'; exit(7)`
→ exit status 7, stderr empty; rifty → TypeError (private-field receiver).
Default-import path (`import process from 'node:process'; process.exit(7)`)
works. Outside the unit's four claimed A1 methods (`cwd`/`nextTick`/`hrtime`/
`uptime` — verified working unbound) and not on the claimed vitest path
(REV-2/3 NOTE), routed here per REV-12.

Affects every prototype method that touches private state — `exit` proven;
audit `kill`/`pushStdin`/`chdir`/`setSourceMapsEnabled` siblings at pickup.
Fix shape options: bind prototype methods to the singleton instance when
building the namespace (check Node: are `process` named exports the same
function identity as `process.exit`? `import { exit } from 'node:process';
exit === process.exit` oracle first), or make the affected methods
receiver-tolerant. Parity case must cover call-through AND identity.

## Challenge

challenge: 2026-10-01 — factual capture (no premise critic needed, README §Challenge)
