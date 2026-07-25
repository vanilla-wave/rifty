---
kind: epic
status: ready
title: Open/auditable launch — the discovery event
created: 2026-06-28
value: A first-time visitor discovers rifty as the open, MIT, self-hostable WebContainers alternative running real Express + npm install in a browser tab — and converts instead of bouncing.
user_story: As a developer who has never heard of rifty, I want a launch link that lands me zero-click on a real npm-install→preview moment and a README that shows it's open/MIT and how it differs from WebContainers, but today there is no demo deep-link, no measured number to quote, and the README opens "pet project".
---

## Outcome

rifty's bottleneck is presence, not capability — real Express + Vite + npm install already run in the tab, but the project is absent from HN/Reddit/awesome-lists. This epic is the one-shot discovery event that turns a zero-presence faithful runtime into something developers find, trust, and install. The wedge is OWNERSHIP/auditability (open vs proprietary), never raw capability — those ceilings are shared with WebContainers. Mission anchor: more developers running real Node software in the browser, openly.

## User scenario

A first-time visitor opens the launch deep-link → lands zero-click on the real-vite preset → watches `npm install` scroll, then the Vite dev server responds, in a measured <5s cold start → reads the README: a GIF of exactly that run, the MIT badge, the honest compat table, a "vs WebContainers" (open vs closed, $0 vs Enterprise-gated, self-host yes vs no) section, and an honest "shared browser ceilings" section → runs `npm i @riftydev/sdk` (and the now-published `@riftydev/git`, `@riftydev/ts-language-service`) → stars. The maker fires ONE Show HN led by the open/auditable wedge with the measured benchmark + GIF, sits in the thread citing compat-matrix links and a copy-paste COOP/COEP snippet (pre-empting the COI question as a shared web-platform constraint), and opens awesome-wasm PRs. Done when the launch fires on a demo that survives scrutiny — zero forced retractions on any benchmark or compat claim.

The launch acts themselves (the Show HN post, the awesome-wasm/aggregator PRs, sitting in comments) are OUTBOUND/confirm-first execution, not repo deliverables — they are this scenario, not items below.

## Items

- `playground/launch-deeplink-real-npm` — the zero-click demo URL (the launch points AT this). Blocking.
- `distribution/readme-open-auditable-rewrite` — the star-conversion landing reframed to the wedge (blocked on the deep-link demo above; the ONE measured number now lives in `perf/benchmarks.json` — the cold-start + npm-install benchmark item is delivered and closed).
- `distribution/publish-git-and-ts-language-service` — make the two flagship differentiators npm-installable (shared with the compare-slot epic).

Out of scope for this epic (downstream of HN success, NOT prerequisites): `distribution/create-rifty-template`, `distribution/workbench-controllers`, `distribution/framework-bindings-kit`, `distribution/public-api-ai-agent-exec-preview`, `distribution/public-api-ai-agent-contract-snapshot-restore`. The wedge is open/auditable ownership; the audience self-selects into hand-wiring.
