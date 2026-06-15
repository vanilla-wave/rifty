---
area: playground
status: draft
title: WebSocket chat template needs preview-page WebSocket reachability
created: 2026-06-14
why: A chat template needs an iframe client to connect to a Worker-hosted WebSocket server over normal app-surface `WebSocket`; Socket Lab shows real `ws` local server/client support, but a plain preview page native WebSocket still does not reach the Worker port without bridge injection.
user_story: As a developer trying a WebSocket chat starter in the playground, I want the iframe client and Worker server to talk over the normal WebSocket API, but today the honest app-surface path is still a known ceiling.
sources: [docs/backlog/playground/templates-as-stack-consumers.md, docs/adr/net/0147-default-cross-realm-websocket-bridge.md, docs/adr/net/0151-http-websocket-upgrade-over-bridge.md, apps/playground/src/templates/socket-lab.ts]
code: [packages/net/src/ws, apps/playground/src/glue/hmr-bridge.ts]
---
## Context
The Hono, Koa, CLI, and markdown-SSG templates are additive data/runtime work. A
WebSocket chat template is different: a truthful version must prove preview
iframe client → Worker server connectivity with ordinary `WebSocket` /
`WebSocketServer` app code.

Socket Lab is the current capability probe. It proves real `ws` local upgrade and
documents the `browser-preview-websocket` ceiling; that is coverage, not closure.
Fetch-polling or BroadcastChannel-only chat would hide the exact ecosystem gap
this backlog item is meant to expose.

## Next
Use this template as the acceptance consumer when the preview-page WebSocket path
can be made honest. The template should use standard `WebSocket` /
`WebSocketServer` code at the app surface and keep any bridge substitution below
that API.

## Reversibility
REVERSIBLE for the playground template. Depends on preview-page WebSocket
reachability; do not ship a fetch-polling or app-level BroadcastChannel
substitute as closure.
