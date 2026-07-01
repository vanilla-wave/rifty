---
area: distribution
status: ready
title: Rewrite the root README for the open/auditable wedge
created: 2026-06-28
why: the README opens "Pet project; goal is deep understanding" with no GIF / MIT badge / compat table / vs-WebContainers above the fold — the named star-conversion landing undercuts the launch
user_story: As a developer landing on the repo from a launch, I want the first screen to show what rifty is (GIF), that it's MIT/open, the honest compat table, and how it differs from WebContainers, but today the README leads with "pet project" and buries the wedge in docs/public/open-runtime-position.md.
epic: open-auditable-launch
blocked_by: [playground/launch-deeplink-real-npm]
sources: [docs/public/open-runtime-position.md, docs/public/compat/http.md, docs/public/compat/incompatible-packages.md, docs/public/trust-model.md, docs/research/open-webcontainers-alternative-2026-06.md]
code: [README.md]
---

## Context

`README.md:3` opens "Pet project; goal is deep understanding of how these systems work". The vs-WebContainers content (open vs closed, $0 vs Enterprise-gated, self-host) already exists in `docs/public/open-runtime-position.md` + the research note. COOP/COEP configs are proven in `apps/playground/public/_headers`, `netlify.toml`, `vite.config`. The shared browser ceilings live in `docs/public/compat/http.md` (raw TCP/`net.Socket`, HTTP/2, `node:https` TLS), `incompatible-packages.md` (native `.node`/node-gyp, ELF/Mach-O), `git.md` (raw TCP/SSH), and `packages/runtime-js/src/builtins/null-net-stubs.ts` (`dgram`/`tls`/`http2` throws); `trust-model.md` covers only the trust posture, NOT a per-API list. This is surfacing + rewrite, not new research.

## Acceptance

Above the fold, in order: a demo GIF (the launch run), the MIT badge, a one-line wedge ("open, MIT, self-hostable Node runtime in the browser"), and the compat-status table (or a tight link to `docs/public/compat/`). Then:
- a "vs WebContainers" subsection (open vs closed; $0 vs Enterprise-gated; self-host yes vs no), condensed from `open-runtime-position.md`;
- an honest "shared browser ceilings" subsection naming the loud-throw ceilings (raw TCP / `net.Socket`, `node:tls` egress, `node:http2` server, `node:dgram`, native `.node`/node-gyp, ELF/Mach-O exec, `node:https` server) as architectural-not-bugs — each verified against its real source before listing (`compat/http.md`, `incompatible-packages.md`, `git.md`, `null-net-stubs.ts`; `trust-model.md` only for the trust posture); drop any named ceiling that lacks a documented ❌ / loud-throw;
- a copy-pasteable 3-line COOP/COEP snippet plus the "header-less hosts (e.g. GitHub Pages) cannot host rifty" caveat;
- the "pet project" framing moved below the fold;
- every compat link cited verified fresh at write time (no stale/404 anchor).

## Parity cases

None — documentation. Verification is a link-integrity pass (zero 404 anchors) + manual review.

## Out of scope

- No new competitive research (surface existing docs).
- No compat-matrix DATA changes (that is `toolchain-build/compat-matrix-test-result-sink`).
- No apps/landing changes (that is `distribution/landing-compare-page`).

## Decisions

- GIF + benchmark are sourced from the deep-link + benchmark items (hence `blocked_by`).
- vs-WebContainers framing = the `open-runtime-position.md` table, condensed.
- REVERSIBLE → CHANGELOG line; no ADR.
