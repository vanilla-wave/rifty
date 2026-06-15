---
area: playground
status: draft
title: New templates as whole-stack e2e consumers (Hono/Koa, WebSocket chat, CLI demo, markdown-SSG)
created: 2026-06-12
why: express demo norm — ~5-7 stack bugs per new real consumer; after ADR-0130 a third template is a data change, so each template is a near-free e2e consumer of the whole stack
user_story: As a developer in the playground, I want to pick a Hono/Koa, WebSocket-chat, CLI, or markdown-SSG starter, but today only the express demo template exists so those stack styles (`ctx`/middleware, WS bridge, run-to-completion exit code, fs-heavy SSG) are unreachable.
sources: [ADR-0130, ADR-0078, fullstack-demo feedback 2026-06-12]
code: [apps/playground/src, tests/e2e/fullstack-demo.spec.ts]
---
## Context
ADR-0130 wired `preset.templateId` and made node-server templates data ("third template = data change for real this time"). The express demo surfaced 7 runtime bugs en route — the expected norm for any new real consumer. Each candidate template targets a stack axis nothing currently covers:
- **Hono or Koa** — different server style (ctx/middleware vs express); exercises `node:http` surface differently; cheapest (pure data change).
- **WebSocket chat** — consumes ADR-0147's default cross-realm WebSocket bridge
  with app-level bidirectional messages, not just dev-server HMR.
- **CLI demo** — run-to-completion worker path through the playground: servers live forever; exit-with-code (terminal showing exit status, no preview) is never exercised end-to-end. Flip side of `kernel/server-shaped-worker-process-lifecycle`.
- **markdown-SSG** — fs-intensive (read/write/walk many files), then static preview of output.

## Options / Next
Order by gap-value vs cost: Hono first (data change, immediate worker-realm load) → CLI demo (needs run-to-completion UX decision: what does preview pane show, where does exit code surface) → WebSocket chat (ADR-0147 bridge consumer) → markdown-SSG. Each green template pinned with an e2e spec per `tests/e2e/fullstack-demo.spec.ts` pattern. Expect bugs; budget per-template fix time, file findings to owning areas.

## Progress 2026-06-27
- Landed `hono-api`, `cli-report`, and `markdown-ssg` playground presets with
  focused Chromium e2e specs.
- Added `node-cli` runtime for run-to-completion entries; preview pane is
  intentionally absent, terminal surfaces stdout + exit code.
- Hono found and fixed `global`, `createServer(options, listener)`,
  `IncomingMessage.host/rawHeaders`, preview host:port synthesis,
  `node:http2` class surface, and `Readable.toWeb` gaps. The standard
  `@hono/node-server` adapter now backs the shipped template.
- Landed `koa-api` with real `koa` + `@koa/router`, focused on Koa ctx cookies,
  router params, JSON body reads, `app.callback()` through `node:http`, and
  iframe preview traffic.
- Rebased onto the current playground template model (`apps/playground/src/templates/*`, owner-driven boot lines, explicit `npm install && ...` for from-scratch presets).
- WebSocket chat remains open in `docs/backlog/playground/websocket-chat-template-cross-realm.md`; Socket Lab is coverage, not closure.

## Reversibility
REVERSIBLE per template (data change per ADR-0130). WebSocket bridge transport is already ratified by ADR-0147; this item only adds consumers. CLI run-to-completion may pull the kernel lifecycle item — IRREVERSIBLE there, not here.
