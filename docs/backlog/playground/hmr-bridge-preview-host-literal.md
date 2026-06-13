---
area: playground
status: active
title: Wire apps/playground hmr-bridge.ts to PREVIEW_LOCAL_HOST instead of inlining `preview.local`
created: 2026-06-13
why: ADR-0036 exported PREVIEW_LOCAL_HOST for a one-line swap, but hmrBridgeUrl still inlines the host, so it sits outside the SW_ROUTING_VERSION pin (ADR-0040) and a host rename would silently desync the HMR WS URL from SW routing.
sources: [ADR-0036, ADR-0040]
code: [apps/playground/src/glue/hmr-bridge.ts, packages/io/src/preview-protocol.ts, apps/playground/src/glue/hmr-bridge.test.ts]
---

## Context

hmr-bridge.ts:58 (`return `ws://preview.local:${port}/__hmr${suffix}``) is the only non-test production source besides preview-protocol.ts itself still containing the literal. @riftydev/io exports PREVIEW_LOCAL_HOST (re-exported io/index.ts:50) but the playground never imports it. ADR-0036 names this exact follow-up: 'PREVIEW_LOCAL_HOST is exported to make it a one-line swap when the HMR adapter graduates from the playground.' ADR-0040 states SW_ROUTING_VERSION pins 'the synthetic host literal' and must bump on changes to it — but this copy is outside that pin, so renaming preview.local would silently desync without tripping the version-mismatch path. The other cited follow-up site (realVite.ts Host: preview.local) no longer exists. There is no protocol/ backlog folder; the code lives in playground.

## Options or Next

Import PREVIEW_LOCAL_HOST from @riftydev/io in hmr-bridge.ts and build the URL as `ws://${PREVIEW_LOCAL_HOST}:${port}/__hmr${suffix}` (io is the lowest layer, import is allowed top-down). Update hmr-bridge.test.ts to assert against the imported constant rather than a hardcoded literal so a host rename in io propagates. One-line swap + test wiring as ADR-0036 promised.

## Reversibility

REVERSIBLE — backlog item; behavior-preserving import swap.
