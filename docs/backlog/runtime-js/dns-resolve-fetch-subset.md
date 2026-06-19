---
area: runtime-js
status: active
title: node:dns resolve* browser-safe fetch/DoH subset
created: 2026-06-19
why: dns.resolve* is only tracked inside the aggregate loud-stub backlog, but fetch-backed DNS lookups can unblock HTTP/WebSocket-oriented packages without pretending to provide OS resolver semantics
user_story: As a developer running a package that calls `dns.resolve4()`, `dns.resolve6()`, or `dns.promises.resolve*()` before choosing an HTTP/WebSocket endpoint, I want those DNS lookups to work in the browser, but today all non-localhost resolve calls throw `NotImplementedError`.
sources: [docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md, docs/backlog/process-meta/compat-matrix-coverage-debt.md, "subagent audit 2026-06-19"]
code: [packages/runtime-js/src/builtins/null-net-stubs.ts]
---

## Context

`dns.lookup('localhost')` is intentionally supported for Vite-style local bind
selection, while `dns.resolve*` and promise variants are loud stubs. The broad
`node-builtins-loud-stub-capability-gaps` item records the absence and says a
DoH-backed `dns.resolve` would need promotion to its own work item. This file is
that promoted item.

The target is not Node's OS resolver. Browser code cannot read `/etc/hosts`,
system resolver config, split-horizon VPN DNS, or corporate search domains.
A browser-safe subset must be explicit: likely DNS-over-HTTPS or host-provided
resolver integration over `fetch`, configured through environment/host options
per D-004, never a hardcoded external URL. The subset helps metadata/service
discovery flows that continue over HTTP/WebSocket/fetch. It does not unblock
packages whose next step is raw `net.connect`, `tls.connect`, or UDP.

## Options or Next

- Write parity/ceiling tests first for the current throw shape and the intended
  successful subset (`resolve4`, `resolve6`, `promises.resolve4/6`, maybe TXT
  or SRV only after a concrete consumer needs them).
- Pick the resolver contract: host-injected resolver callback versus configured
  DoH endpoint. A hardcoded public resolver is forbidden.
- Decide error mapping (`ENOTFOUND`, `ETIMEOUT`, invalid rrtype) against real
  Node for the covered record types.
- Keep unsupported rrtypes, OS-resolver semantics, UDP/mDNS, and raw-socket
  follow-on flows as loud gaps.
- Update compat docs so the public claim says "fetch/DoH subset", not "Node DNS".

## Reversibility

Implementation is IRREVERSIBLE if it adds a host/env resolver contract or a DoH
provider dependency, and should get an ADR before code. The backlog item is
REVERSIBLE; until the contract is chosen, current loud throws remain honest.
