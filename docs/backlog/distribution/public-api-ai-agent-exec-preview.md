---
area: distribution
status: draft
title: Residual AI-agent sandbox exec streaming + preview URL API
created: 2026-06-12
why: ADR-0131 landed only public FS read/write; agent contract still needs streamed exec results and a normalized preview URL surface
user_story: As a dev embedding rifty as my AI-agent backend, I want `sandbox.exec()` to stream `{ stdout, stderr, exitCode }` and hand me a normalized preview URL, but today the public SDK only offers `runtime.eval()` plus events — no command-shaped streamed exec, and preview wiring stays SW/host-route specific.
sources: [docs/research/open-webcontainers-alternative-2026-06.md, ADR-0071, ADR-0131, ADR-0048, ADR-0123]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts]
---

## Context

AI-agent sandbox consumers expect `exec` streaming `{ stdout, stderr, exitCode }`
and a server-ready preview URL. Today the public SDK exposes `runtime.eval()` and
runtime events, not a command-shaped streamed exec API; preview wiring remains
service-worker/host-route specific.

## Options or Next

- Decide `sandbox.exec()` shape, cancellation, stdin, cwd/env, and event ordering.
- Decide preview URL normalization over the existing SW preview owner routing.
- Keep this separate from FS RPC and snapshot/fork; each expands public SDK API.

## Reversibility

IRREVERSIBLE when taken up — expands public `Sandbox` API. Needs its own ADR.
