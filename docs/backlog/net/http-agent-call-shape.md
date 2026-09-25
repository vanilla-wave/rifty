---
area: net
status: draft
title: "`http.Agent` / `https.Agent` called without `new` reach their named ceiling, as Node's callable constructors do"
created: 2026-09-25
why: Node's `http.Agent`/`https.Agent` are callable functions (`http.Agent()` and `util.inherits` + `Agent.call(this)` construct an agent); rifty's ES classes throw V8's bare `Class constructor Agent cannot be invoked without 'new'` there, the error class ADR-0464 §1 exists to remove
sources: [docs/adr/runtime-js/0464-named-loud-members-for-charted-unclaimed-mode-ceilings.md, docs/adr/net/0181-client-node-https-request-and-get-over-browser-fetch.md, docs/public/compat/modules.md, docs/public/compat/http.md]
code: [packages/net/src/http/agent.ts, packages/net/src/https.ts]
---

## Context

DEC-2 decision review of ADR-0464 (2026-09-25); the ES-class `http.Agent`
call/`util.inherits` NOTE of
`docs/backlog/runtime-js/reference/vitest-run-acceptance-final-green.json`.

Node v24.16.0 (`node -e`, probe 2026-09-25): `http.Agent() instanceof
http.Agent` → `true`; `function Sub(o) { http.Agent.call(this, o) }
util.inherits(Sub, http.Agent); new Sub({}) instanceof http.Agent` → `true`;
the same for `https.Agent`.

Rifty (scratch `tsx` probe of `packages/net/src/http/agent.ts` @ `5616d5a64`):
`Agent()` and `Agent.call(this)` → `TypeError: Class constructor Agent cannot
be invoked without 'new'`; `new Agent()` and `class extends Agent` →
`NotImplementedError('node:http.Agent')` (the ADR-0464 §4 edge, parity
`http/agent-shape`). `https.Agent` (`https.ts:226`) is the same ES-class shape
(code reading).

Compat ❌: `modules.md` `node:` built-ins row. The generated `http.md` row
(`tools/compat-matrix-generator/cli.js:440`) still reads "subclassable"
unqualified — qualify it at the generator.

## Next

Owner net. Fix shape: a function whose call and construct paths both throw
`NotImplementedError('node:http.Agent' | 'node:https.Agent')`, keeping Node's
name/`length`/descriptor. Parity first: the call and `util.inherits` rows in
`http/agent-shape` (Node constructs, rifty named throw on both).
