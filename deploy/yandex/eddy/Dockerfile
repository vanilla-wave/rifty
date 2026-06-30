# syntax=docker/dockerfile:1
#
# @riftydev/eddy — opt-in fast npm-install resolver (ADR-0182).
# Built from the monorepo source (no npm publish required); mirrors the
# ADR-0163 registry-proxy deploy shape but ships eddy's own code rather than a
# stock image. eddy's tsup BUNDLES its @riftydev/* deps into dist (self-
# contained), so the run stage is just Node + dist/bin.js — no node_modules and
# no runtime dep resolution (`pnpm deploy` would leave dev-src manifests that
# crash at runtime). Build from the REPO ROOT:
#
#   docker build -f deploy/yandex/eddy/Dockerfile -t riftydev-eddy .
#
# Alternatively, once @riftydev/eddy is published to npm (distribution item),
# a thin image is just: FROM node:24-alpine; RUN npm i -g @riftydev/eddy; CMD ["eddy"].

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# The repo postinstall runs `playwright install` (for local e2e); skip the
# ~400 MB browser download — the eddy build never runs Playwright.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Pin npmjs to avoid a local mirror rewriting lockfile tarball hosts. Full
# install (incl. devDeps) so tsup can bundle the @riftydev/* sources.
RUN pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
# Bundle eddy (+ its @riftydev/* deps) to a self-contained dist/.
RUN pnpm --filter @riftydev/eddy build

FROM node:24-alpine AS run
WORKDIR /app
# dist/bin.js is self-contained (only node: builtins external) — copy just dist.
COPY --from=build /repo/services/eddy/dist ./dist
ENV PORT=8788
# Set REGISTRY_BASE_URL to your upstream registry/proxy; EDDY_TTL_SECONDS to
# tune the mutable-tier TTL (0 = always recompute). Defaults: npmjs, 1800s.
EXPOSE 8788
CMD ["node", "dist/bin.js"]
