---
area: npm-client
status: active
title: Live registry roundtrip manual smoke (registry.npmjs.org via Vite proxy)
created: 2026-06-08
why: mock-based install pipeline verified; live registry.npmjs.org-through-Vite-proxy path needs a manual smoke, not captured done anywhere
user_story: As a developer running `npm install` against live `registry.npmjs.org` through the dev `/npm-registry` proxy, I want confidence metadata + tarballs actually resolve that way, but currently only the opt-in Fetcher live tests are recorded — the Vite-proxy roundtrip itself has no captured smoke.
sources: [TASKS Follow-ups, D-004, ADR-0005]
---
## Context
The npm-client install pipeline (resolve→tarball→unpack→link→lockfile) is verified against offline mocks/vendored fixtures. The dev proxy (D-004 / ADR-0005: Vite `server.proxy` → `registry.npmjs.org`, `/npm-registry/:pkg` metadata + `/npm-registry/:pkg/-/:file.tgz` tarballs) is wired but the *live* end-to-end roundtrip (real registry.npmjs.org through the Vite proxy) has only the opt-in express/vite live tests (`RIFTY_LIVE_REGISTRY`) — a standalone manual smoke of the dev-proxy path itself is not recorded as done.
## Options / Next
Run a manual smoke: `pnpm dev`, install a package through the Vite-proxied `/npm-registry` against live registry.npmjs.org, confirm metadata+tarball both resolve and the install completes. Record result (network-gated, not CI). The opt-in `*-live-run.opt-in.test.ts` suites already exercise the live registry but via the client's Fetcher, not the dev Vite proxy specifically.
## Reversibility
Reversible — verification/smoke only, no code change. Network-gated (cannot run in sandboxed CI); manual or opt-in.
