---
area: net
status: parked
title: node:http server introspection surface (+ loud-throw interim responses)
created: 2026-06-20
why: Pure-JS header introspection over existing lowercased _headers map + static METHODS array directly serve the Express scenario; interim-response methods stay honestly fidelity-bounded by the fetch/SW Response bridge (one final status).
user_story: As an Express/middleware user, I want res.getHeaders()/hasHeader()/appendHeader()/getHeaderNames() + http.METHODS, but today they are absent so getHeaders-using middleware and per-verb routers break.
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §10, docs/adr/README.md (D→ADR ADR-0010/0017/0123/0154)]
code: [packages/net/src/http/response.ts, packages/net/src/http/server.ts, packages/net/src/http/status-codes.ts]
---

## Context

`ServerResponse` has `setHeader`/`getHeader`/`removeHeader` only over a lowercased `_headers` map (`response.ts:33`, written `:96`). `http` default-export barrel ships `STATUS_CODES` but not `METHODS`/`maxHeaderSize` (`server.ts:865`). Group:

| node-API (+since) | real path | anchor |
|---|---|---|
| `res.getHeaders()` v7.7 | clone `_headers` → null-proto obj | response.ts:33 |
| `res.getHeaderNames()` v7.7 | `Object.keys(_headers)` | response.ts:33 |
| `res.hasHeader(n)` v7.7 | `n.toLowerCase() in _headers` | response.ts:100 |
| `res.appendHeader(n,v)` v11.6 | array-merge into `_headers[lc]`, throw if sent | response.ts:96 |
| `http.METHODS` v0.11 | static array, barrel like STATUS_CODES | server.ts:865 |
| `http.maxHeaderSize` v11.6 | read-only const `16384`, NOT enforced (SW/fetch frames) — doc advisory | status-codes.ts |
| `writeContinue`/`writeEarlyHints`/`addTrailers` | interim 100/103 + trailers unmodelable over Response bridge → `NotImplementedError` | response.ts |

## Options or Next

Parity-first, per-feature promotable:
1. Failing parity test per introspection method vs real Node (case-insensitive lookup, array values, post-send throw, null-proto getHeaders shape) → implement REAL over `_headers`.
2. `http.METHODS` array (copy Node's) + barrel export beside STATUS_CODES; router-reads-METHODS parity.
3. `http.maxHeaderSize` const + compat-matrix note "advisory, not enforced" — never claim framing enforcement.
4. `writeContinue`/`writeEarlyHints`/`addTrailers` → `NotImplementedError('http.<m>')` + compat ❌; loud, never fake-ack the interim/trailer.

## Reversibility

REVERSIBLE — recorded in this backlog item. Loud-throw interim methods follow existing NotImplementedError + compat-❌ convention (no new public-API commitment).
