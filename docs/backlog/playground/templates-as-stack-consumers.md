---
area: playground
status: active
title: New templates as whole-stack e2e consumers (Hono/Koa, WebSocket chat, CLI demo, markdown-SSG)
created: 2026-06-12
why: express demo norm — ~5-7 stack bugs per new real consumer; after ADR-0130 a third template is a data change, so each template is a near-free e2e consumer of the whole stack
sources: [ADR-0130, ADR-0078, fullstack-demo feedback 2026-06-12]
code: [apps/playground/src, tests/e2e/fullstack-demo.spec.ts]
---
## Context
ADR-0130 wired `preset.templateId` and made node-server templates data ("third template = data change for real this time"). The express demo surfaced 7 runtime bugs en route — the expected norm for any new real consumer. Each candidate template targets a stack axis nothing currently covers:
- **Hono or Koa** — different server style (ctx/middleware vs express); exercises `node:http` surface differently; cheapest (pure data change).
- **WebSocket chat** — forces `net/cross-realm-websocket-bridge` (parked, "no current consumer" — this IS the consumer).
- **CLI demo** — run-to-completion worker path through the playground: servers live forever; exit-with-code (terminal showing exit status, no preview) is never exercised end-to-end. Flip side of `kernel/server-shaped-worker-process-lifecycle`.
- **markdown-SSG** — fs-intensive (read/write/walk many files), then static preview of output.

## Options / Next
Order by gap-value vs cost: Hono first (data change, immediate worker-realm load) → CLI demo (needs run-to-completion UX decision: what does preview pane show, where does exit code surface) → markdown-SSG → WebSocket chat (gated on the bridge, or pulled forward as its driving consumer). Each green template pinned with an e2e spec per `tests/e2e/fullstack-demo.spec.ts` pattern. Expect bugs; budget per-template fix time, file findings to owning areas.

## Reversibility
REVERSIBLE per template (data change per ADR-0130). WebSocket bridge transport itself IRREVERSIBLE — own ADR when taken (already noted in `net/cross-realm-websocket-bridge`). CLI run-to-completion may pull the kernel lifecycle item — IRREVERSIBLE there, not here.
