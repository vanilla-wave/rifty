---
area: distribution
status: ready
title: Publish + deploy @riftydev/eddy (npm + Docker)
created: 2026-06-28
why: eddy must be self-hostable to keep the speedup a property of the OPEN stack (the wedge vs closed competitors) — a published npm package + a Docker image deployed alongside the Caddy proxy, with self-host docs
user_story: As a self-hoster I want to run my own eddy next to my registry proxy with one npm/Docker command, but today there is no package, image, or deploy recipe.
epic: fast-install-resolver
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/adr/npm-client/0163-yandex-cloud-streaming-npm-registry-proxy.md]
code: [services/eddy/package.json, services/eddy/tsup.config.ts, deploy/yandex/eddy/docker-compose.yml, tools/checks/arch-rules.cjs]
---

## Context

`@riftydev/eddy` (the `npm-client/eddy-resolver-service` engine) ships two ways, mirroring the Caddy proxy (ADR-0163): a published npm package (`npx @riftydev/eddy` / library) and a Docker image deployed on rifty.dev alongside the registry proxy. It imports `@riftydev/npm-client`, so it sits OUTSIDE the browser layer graph — `services/eddy/` with an arch-rules carve-out (`eddy → npm-client` allowed; no browser-layer package may import `eddy`). rifty.dev's eddy URL is wired via env-config (D-004), like the registry URL. The actual deploy + first npm publish are outward, operator-owned actions → confirm-first; the package, image, recipe, and docs land here.

## Acceptance

- `@riftydev/eddy` is publish-ready: builds to ESM `dist/` (a library `index` entry + a `bin` CLI entry) via `tsup`; `pnpm --filter @riftydev/eddy build` is green; `package.json` declares `bin: { eddy }` + a `publishConfig` mirroring the other `@riftydev/*` packages.
- `npx @riftydev/eddy` (the `bin`) starts the resolver: reads `PORT` / `REGISTRY_BASE_URL` / `EDDY_TTL_SECONDS` from env and listens.
- A Dockerfile (`deploy/yandex/eddy/Dockerfile`) builds eddy + its workspace deps from source and runs `node dist/bin.js`; a `docker-compose.yml` deploys it alongside the registry proxy with the env knobs, mirroring the ADR-0163 deploy shape.
- Self-host docs cover deploy steps, the operator TTL/`prefer` knobs, and the trust boundary: `docs/public/hosting-eddy.md` + a `docs/public/hosting-domains.md` row + the eddy section of `docs/public/trust-model.md`.
- Arch enforcement covers `services/`: `check:arch` (and the `arch-boundaries` sweep) scan it; the `no-browser-imports-eddy` rule forbids any browser-layer import of eddy; `eddy → npm-client` stays allowed (eddy kept out of `TIERS`).

## Parity cases

N/A — packaging/infra item, no Node-observable behavior. The resolver's + client's behavioral parity were owned by the now-delivered engine + client-opt-in items (their parity tests live in `services/eddy/tests/` + `packages/npm-client`).

## Out of scope

- The actual `npm publish` of `@riftydev/eddy` (wiring it into `release.yml`'s OIDC publish + the first release) — confirm-first/outward; the package is publish-READY here.
- The actual rifty.dev VM deploy of the eddy image — confirm-first/outward (operator infra); the recipe + compose land here, the `yc ... --docker-compose-file` run does not.
- Integrating eddy into `tools/publishing/sync-publish-config.mjs` (the packages/* generator) — the hand-authored `tsup.config.ts` stands until then; folding it in is a follow-up, not a blocker.
- A `tools/registry/`-style live smoke wired into CI (the proxy has one) — listed in the doc as a manual `curl` smoke; CI wiring waits on a deployed eddy.

## Decisions

- Package at `services/eddy/` (new top-level) + the `no-browser-imports-eddy` arch carve-out; eddy NOT in `TIERS` so its upward `eddy → npm-client` import stays allowed. Workspace/arch/backlog tooling extended to scan `services/`. (ADR-0182; this item)
- `tsup.config.ts` hand-authored (eddy is outside the packages/* publish generator); `index` + `bin` entries, `@riftydev/*` + `node:` external. REVERSIBLE.
- Docker image built from monorepo source (multi-stage + `pnpm deploy --prod`), so it works pre-publish; a thin `npm i -g @riftydev/eddy` image is the post-publish alternative (documented). REVERSIBLE.
- Upstream registry via `REGISTRY_BASE_URL` env-config, default npmjs (Node-tool convention, cf. `bake-dep-snapshots`); the rifty.dev compose points it at the registry proxy so eddy + proxy share one upstream + trust boundary (ADR-0163).
- Deploy + first publish are confirm-first/outward (recipe in-repo; the action is a separate authorized step).
