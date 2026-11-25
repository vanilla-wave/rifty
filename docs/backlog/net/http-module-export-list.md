---
area: net
status: draft
title: The browser hosts' node:http lacks half of Node's exports, silently (validateHeaderName is undefined)
created: 2026-11-25
why: "`require('http').validateHeaderName(…)` throws `TypeError: … is not a function` in the Workbench/browser runtime; Node v24.16.0 and the isolate guest export it — a missing member reads `undefined`, no named gap"
sources: ["PR #449 external review (manager-relayed, 2026-11-25)", packages/isolate-guest/src/guest/egress-http.ts]
code: [packages/net/src/http/index.ts, packages/net/src/register-builtins.ts]
---

## Context

Observed 2026-11-25. Keys of `require('http')`:

- Node v24.16.0 (`node -e "console.log(Object.keys(require('http')).sort().join())"`): `Agent,
  ClientRequest, CloseEvent, IncomingMessage, METHODS, MessageEvent, OutgoingMessage,
  STATUS_CODES, Server, ServerResponse, WebSocket, _connectionListener, createServer, get,
  globalAgent, maxHeaderSize, request, setGlobalProxyFromEnv, setMaxIdleHTTPParsers,
  validateHeaderName, validateHeaderValue`.
- rifty `packages/net/src/http/index.ts` default export (the module `register-builtins.ts`
  registers as `http`; `tsx` import, same tree): `Agent, IncomingMessage, METHODS,
  STATUS_CODES, Server, ServerResponse, createServer, get, maxHeaderSize, request`;
  `typeof validateHeaderName` → `undefined`.

Missing: `ClientRequest`, `OutgoingMessage`, `globalAgent`, `validateHeaderName`,
`validateHeaderValue`, `setMaxIdleHTTPParsers`, `setGlobalProxyFromEnv`,
`_connectionListener`, `WebSocket`, `CloseEvent`, `MessageEvent` — each a silent `undefined`
(AGENTS §Fidelity: a gap is a named loud member), not a `NotImplementedError`. The isolate
guest has Node's export list (`egress-http.ts`, real validators; compat isolate-host.md
"Loading `node:http`…"). Live Workbench page (PR #449 review round 2, reviewer's
measurement): `Object.keys(require('http'))` = the same 10 names (Node 21),
`'validateHeaderName' in h` → `false`. Dedup: no backlog, trap or declined-concept match
(`net/http-agent-call-shape` is `Agent` call shape; compat http.md lists no export-list row).

## Challenge

challenge: 2026-11-25 — finding capture; no premise critic (README §Challenge)
