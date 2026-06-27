---
area: net
status: draft
title: http.request loopback across Worker realms (port registry is realm-local)
created: 2026-06-12
why: loopback routing (PR #21) only reaches servers registered in the SAME Worker realm; service-to-service calls between two sandbox processes get ECONNREFUSED even though the port is live in another Worker
user_story: As a developer making service-to-service `http.request('http://localhost:3001')` calls between two sandbox processes, I want the request to reach a server listening in another Worker — but today the port registry is realm-local so it fails fast with `ECONNREFUSED` even though that port is live in a different realm.
sources: [M11, "net/http-request-loopback-own-ports (closed, PR #21)", ADR-0043]
code: [packages/net/src/registry.ts, packages/net/src/http/server.ts]
---

## Context

The port registry is a realm-global Map per Worker. `http.request('http://localhost:3001')`
in Worker A cannot see a server listening in Worker B; since PR #21's review fix it fails
fast with Node-shaped `ECONNREFUSED` (before: leaked to the HOST machine's real loopback via
`fetch`, which could silently answer). The SW preview bridge already routes browser-origin
`/preview/<port>/*` fetches cross-realm — in-sandbox client requests need an equivalent hop.

## Options or Next

- Route unresolved loopback ports through the SW / kernel broker to other realms'
  registries (reuse the ADR-0043 preview-bridge frames), keeping ECONNREFUSED only when no
  realm owns the port.
- Or: process-spawn-time port table in the kernel (single source of truth), registries
  become views.

## Reversibility

REVERSIBLE while the fallback is fail-fast ECONNREFUSED (current). The cross-realm wire
format choice will likely be IRREVERSIBLE (new ADR when picked).
