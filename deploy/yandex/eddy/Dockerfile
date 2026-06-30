# syntax=docker/dockerfile:1
#
# @riftydev/eddy — opt-in fast npm-install resolver (ADR-0182).
# Built from the monorepo source (no npm publish required); mirrors the
# ADR-0163 registry-proxy deploy shape but ships eddy's own code rather than a
# stock image. Build from the REPO ROOT:
#
#   docker build -f deploy/yandex/eddy/Dockerfile -t riftydev-eddy .
#
# Alternatively, once @riftydev/eddy is published to npm (distribution item),
# a thin image is just: FROM node:24-alpine; RUN npm i -g @riftydev/eddy; CMD ["eddy"].

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# Pin npmjs to avoid a local mirror rewriting lockfile tarball hosts.
RUN pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
# Build eddy + its workspace dependency chain (npm-client, vfs, io).
RUN pnpm --filter @riftydev/eddy... build
# Produce a portable, prod-only deploy dir (flattened node_modules + dist).
RUN pnpm --filter @riftydev/eddy deploy --prod /out

FROM node:24-alpine AS run
WORKDIR /app
COPY --from=build /out .
ENV PORT=8788
# Set REGISTRY_BASE_URL to your upstream registry/proxy; EDDY_TTL_SECONDS to
# tune the mutable-tier TTL (0 = always recompute). Defaults: npmjs, 1800s.
EXPOSE 8788
CMD ["node", "dist/bin.js"]
