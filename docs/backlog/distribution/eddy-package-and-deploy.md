---
area: distribution
status: draft
title: Publish + deploy @riftydev/eddy (npm + Docker)
created: 2026-06-28
why: eddy must be self-hostable to keep the speedup a property of the OPEN stack (the wedge vs closed competitors) — a published npm package + a Docker image deployed alongside the Caddy proxy, with self-host docs
user_story: As a self-hoster I want to run my own eddy next to my registry proxy with one npm/Docker command, but today there is no package, image, or deploy recipe.
epic: fast-install-resolver
blocked_by: [npm-client/eddy-resolver-service]
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/adr/npm-client/0163-yandex-cloud-streaming-npm-registry-proxy.md]
code: [deploy/yandex/npm-registry/docker-compose.yml, tools/checks/arch-rules.cjs]
---

## Context

`@riftydev/eddy` (the `npm-client/eddy-resolver-service` engine) ships two ways, mirroring the Caddy proxy (ADR-0163): a published npm package (`npx @riftydev/eddy` / library) and a Docker image deployed on rifty.dev alongside the registry proxy. It imports `@riftydev/npm-client`, so it sits OUTSIDE the browser layer graph — `services/eddy/` with an arch-rules carve-out allowing `eddy → npm-client`. rifty.dev's eddy URL is wired via env-config (D-004), like the registry URL.

## Open forks (resolve to reach ready)

- Package layout: `services/eddy/` (new top-level) + `tools/checks/arch-rules.cjs` carve-out (eddy may import npm-client; eddy is not imported by any browser-layer package). Confirm depcruise scans/ignores `services/` correctly.
- Docker image + compose recipe (extend `deploy/yandex/npm-registry/` or a sibling); rifty.dev deployment alongside Caddy; the eddy URL env-config wiring.
- Self-host docs (`docs/public/`): deploy steps, the operator TTL/`prefer` knobs, and the `trust-model.md` boundary.
- Confirm-first: actually deploying eddy on rifty.dev infra is an outward action (operator-owned infra) — recipe lands here; the deploy itself is a separate confirm-first step.
