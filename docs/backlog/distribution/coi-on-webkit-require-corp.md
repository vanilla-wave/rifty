---
area: distribution
status: draft
title: COI on WebKit by serving COEP require-corp instead of credentialless (D-001)
created: 2026-09-27
why: WebKit ignores `COEP: credentialless` → `crossOriginIsolated` false, no SharedArrayBuffer, so the COI tier is ❌ on every Safari/iOS by hosting policy, not by engine; `require-corp` yields COI+SAB on WebKit 26.4 (probed 2026-09-16, all three engines, 127.0.0.1 and localhost)
sources: [ADR-0002, ADR-0375, ADR-0469, docs/backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md]
code: [apps/playground/vite.config.ts]
---

## Question

Whether any deployment should supersede D-001 (`ADR-0002`: `credentialless` chosen so third-party assets load without CORP headers). Share at stake: Safari ≈ 15.9 % worldwide / 5.9 % RU of all traffic (StatCounter 2026-08, research §4; RU desktop 1.5 %). Switching admits Safari 16.4+ to COI (persistence still Safari 26 via `createWritable`) at the cost of CORP/CORS on every cross-origin subresource of that deployment. ADR-0375 already names the shared-memory-free tier the destination for hosts that cannot ship COI; the playground is the only COI deployment. Outside the closed browser-support-floor goal (ADR-0469; closure `docs/backlog/distribution/reference/browser-support-floor-closure.md`) — user 2026-09-27 "2a" (record only). Trigger: a host needing `execSync`/SAB features on WebKit.

## User scenario

A developer opens the playground in Safari 26: today `crossOriginIsolated === false` → `Workbench requires cross-origin isolation`; with `require-corp` the COI workbench boots, provided every cross-origin asset carries CORP.

## Out of scope

Per-engine header switching (UA sniffing — ADR-0007 forbids engine branches); non-COI tier changes.

## Decisions

- 2026-09-27 — recorded as question; playground stays `credentialless` — user "2a"
