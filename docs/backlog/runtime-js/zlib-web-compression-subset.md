---
area: runtime-js
status: parked
title: node:zlib web-compression subset
created: 2026-06-12
why: Consumer Ready roadmap calls out zlib as a high-frequency runtime wall, but node:zlib is still a loud stub
sources: [docs/ROADMAP.md, docs/research/open-webcontainers-alternative-2026-06.md]
code: [packages/runtime-js/src/builtins/null-net-stubs.ts]
---

## Context

`node:zlib` is registered, but every member throws `NotImplementedError`. That
is honest, but ordinary npm packages often touch `gzip`/`gunzip` for registry,
asset, and HTTP-style flows. The Consumer Ready roadmap names zlib as one of the
runtime walls to knock down for "real-ish projects"; the current PR does not do
that work.

## Options or Next

- Gate: identify the first real consumer path that needs zlib, then add a parity
  case for that exact method/shape.
- Prefer a small web-platform-backed subset first: `gzip`/`gunzip`; sync variants
  only if they can be implemented honestly without pretending browser async
  compression is synchronous.
- Keep unsupported members as loud `NotImplementedError('zlib.<feature>')` and
  update the compat matrix per landed method.

## Reversibility

REVERSIBLE for additive method implementations. A new dependency, broad stream
contract, or sync-compression emulation policy would be IRREVERSIBLE and needs
an ADR before implementation.
