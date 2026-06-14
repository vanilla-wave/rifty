---
area: net
status: active
title: HttpServer.listen options-object overload — confirm and promote to ADR
created: 2026-06-08
why: Shipped Node-parity widening still carries a TODO(backlog: net/http-listen-options-overload) marker; needs confirm→promote, not new work
user_story: As a maintainer, I want the shipped `server.listen({port,host}, cb)` options-overload widening (the `@effect/platform-node` silent-bind fix) backed by a ratified decision — can't close it out, it still rides a live `net/http-listen-options-overload` TODO marker at server.ts:52 awaiting confirm-then-promote.
sources: [Q-2026-05-30-101, feature-05-effect-http-bridge T1, ADR-0054]
code: [packages/net/src/http/server.ts:52]
---
## Context
`@effect/platform-node` `NodeHttpServer.layer` always calls `server.listen({port,host}, cb)`. rifty `HttpServer.listen` only accepted a bare number; options object was assigned verbatim as `this.port` → registry keyed on non-number → unroutable 502 while `'listening'` still fired (silent-bind trap). Widened to Node's full overload `listen(port|options, hostOrCb?, cb?)`; bare-number path byte-for-byte unchanged, `host` ignored (loopback-only). Shipped + tested, additive. Marker live at server.ts:52.

## Options / Next
Decision taken (Q-101 Option A): widen existing `node:http` surface, no new cross-package export. Rejected: (b) separate Effect-only adapter export = new cross-package API (IRREVERSIBLE rule 1); (c) shadow-registry shim on the call site (brittle). Next: confirm at M12 DoD → promote to ADR via `pnpm adr:new net` (manual), re-anchor the `TODO(backlog: net/http-listen-options-overload)` marker. Not undone work — implemented + parity-justified, just awaiting promotion.

## Reversibility
REVERSIBLE (checklist rule 4: revert <30 lines / 1 file; only widens accepted inputs of an exported method, no new export/dep). The backlog item is this file (Q-2026-05-30-101); confirm→promote to a fresh ADR.
