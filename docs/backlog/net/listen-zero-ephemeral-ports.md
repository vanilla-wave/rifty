---
area: net
status: active
title: Virtual ephemeral ports for server.listen(0)
created: 2026-06-19
why: Node programs and parity cases rely on `listen(0)` to allocate a free port, but rifty registers port 0 literally and has no virtual ephemeral allocator
user_story: As a developer or parity test binding a server with `server.listen(0)`, I want rifty to allocate an unused virtual port and expose it via `server.address().port`, but today port 0 is not a real allocation path and the only backlog mention is a parity-flake option.
sources: [docs/backlog/net/parity-http-fixed-ports.md, "subagent audit 2026-06-19"]
code: [packages/net/src/registry.ts, packages/net/src/http/server.ts, packages/net/src/net.ts]
---

## Context

The port registry is virtual, so rifty can allocate an unused port without OS
socket access. Today `listen(0)` is not modelled as Node's "choose any free
port"; server code stores/registers the numeric port it receives. The only
existing backlog mention is inside `net/parity-http-fixed-ports`, where
`listen({ port: 0 })` is one possible way to remove hardcoded Node-side parity
ports. That is not a standalone runtime feature tracker.

This should cover `node:http` and `node:net` server surfaces consistently:
`listen(0)`, `listen({ port: 0 })`, and `server.address().port` should reflect
the chosen virtual port until `close()` unregisters it.

## Options or Next

- Add a registry helper that allocates from a deterministic virtual ephemeral
  range and skips ports already registered in the current realm.
- Preserve explicit fixed-port behaviour and existing EADDRINUSE semantics.
- Add parity/conformance tests before implementation for `listen(0)`,
  `listen({ port: 0 })`, `address().port`, close/relisten, and collision
  avoidance.
- Decide whether the parity runner should consume this runtime feature or keep
  a separate injected-port harness path; either way remove the duplicate option
  from `net/parity-http-fixed-ports` once resolved.
- Update the HTTP compat matrix from `listen(port)` to include the ephemeral
  port subset.

## Reversibility

REVERSIBLE. This is additive virtual-registry behaviour; it does not require OS
sockets and does not change the raw TCP ceiling.
