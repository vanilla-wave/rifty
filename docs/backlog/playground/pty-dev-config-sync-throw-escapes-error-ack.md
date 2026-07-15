---
area: playground
status: draft
title: PTY dev-config sync throw must become an error ACK
created: 2026-07-15
why: a synchronous onDevConfig failure escapes handleFrame instead of producing the protocol's pty:dev-config-ready error response
user_story: As a browser terminal client changing dev configuration, I want every rejected request to settle through its protocol ACK, but today a synchronous owner validation failure can escape the dispatcher and leave the request unresolved.
blocked_by: []
sources: [PR-136-workbench-runtime]
code: [apps/playground/src/workers/pty-server.ts]
---

## Context

`createPtyServer` evaluates `onDevConfig` before passing its result to `Promise.resolve`. A synchronous throw therefore bypasses the existing rejection-to-`pty:dev-config-ready { error }` mapping. Promise-returning handlers behave correctly. Refine the callback contract and add sibling cases for synchronous throw, rejected promise, and success before changing the shared dispatcher.
