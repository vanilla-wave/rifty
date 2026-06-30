---
area: playground
status: draft
title: Wire from-scratch presets to eddy fast install
created: 2026-06-28
why: from-scratch presets (snapshotUrl undefined, honest install) pay the full cold install; pinning them exact + lockfile makes eddy's bundle a perpetual immutable cache hit, and a sandbox toggle exposes fast mode
user_story: As a first-time visitor clicking a from-scratch preset I want the install to finish in ~0.6s, but today those presets run the full ~4s cold install while instant presets are already snapshot-backed.
epic: fast-install-resolver
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/adr/playground/0135-sandbox-setup-kinds-instant-vs-from-scratch.md]
code: [apps/playground/src/glue/resolver-config.ts, apps/playground/src/glue/npm-shell-command.ts, apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

Instant presets already use ADR-0135 baked snapshots (lockfile + extracted tree, zero network). Eddy serves the OTHER two cases: from-scratch presets (`snapshotUrl: undefined`, intentional visible install) and user-authored `package.json`.

**Already built (the env-config seam):** the playground's visible `npm install` now threads an env-config `resolverUrl` (`apps/playground/src/glue/resolver-config.ts` `getResolverUrl()` → `VITE_RIFTY_RESOLVER_URL`, default OFF, D-004) into `install()` (`npm-shell-command.ts`), and the install line reports `via eddy (fast)` when the eddy path produced the tree. So the moment a resolver URL is configured, from-scratch presets (which run the visible install) use the fast path with auto-fallback; instant presets (baked snapshots, no install call) are untouched. This is inert/byte-identical when unset (covered by `npm-shell-command.test.ts` + the client-opt-in fallback matrix).

**What remains is deploy-gated + product:** the live ~0.6s demo, the per-preset committed-lockfile exact-pin "perpetual cache hit", a UI toggle, and the re-pin cadence all need a *deployed* eddy (a real `VITE_RIFTY_RESOLVER_URL`) — which is confirm-first/outward (`distribution/eddy-package-and-deploy`). They cannot be meaningfully decided or verified until eddy is live, so they stay open here.

## Open forks (resolve once a deployed eddy exists)

- Per-preset opt-in + the sandbox-toggle UX (default-on per preset vs a user switch) — a product decision once there's a live eddy to toggle. The env-config seam is global today; a UI toggle layers on top.
- Exact-version pins + a committed `package-lock.json` per opted-in from-scratch preset (top-level exact ≠ whole-tree deterministic, so the committed lockfile is what pins the closure → a perpetual immutable cache hit).
- A deliberate re-pin / re-bake CADENCE so pinned templates don't rot (no auto patch uptake) — owner + frequency.
- Reconcile with the ADR-0135 instant-preset path (eddy must not regress or duplicate baked snapshots).
- The real-browser ~0.6s measurement is owned by `perf/eddy-http3-cold-validation` (also deploy-gated).
