---
area: service-worker
status: ready
title: Preview parks forever when vite rejects the Host — diagnose + fix
created: 2026-07-05
why: with the forced `allowedHosts: true` removed, a host-check rejection parks the iframe forever instead of showing vite's real 403 — hides a lost-response bug in the chain and blocks preset-deglue's allowedHosts retirement
user_story: As a developer running real vite with MY OWN config (no rifty-forced allowedHosts), I want a host-check rejection to show vite's real 403 page in the preview, but today the request parks forever with a white iframe
epic: fault-honest-sw-preview
code: [packages/service-worker/src/route-preview.ts, packages/net/src/cross-realm/preview-port.ts, packages/net/src/http/server.ts, packages/workbench/src/workers/vite-cli-prep.ts]
---

## Context

Repro: remove the forced `allowedHosts` (4 templates + `vite-cli-prep.ts` force it today) → preview request hangs; reproducible even with a localhost Host (PR #112 evidence — untraced). Real vite answers `403 Blocked request. This host … is not allowed.` — a response EXISTS, our chain loses it. Suspect hops: vite's host-check response path through the http shim (pre-middleware `res` write our `ServerResponse` may not flush into a reply frame) or a socket destroy the shim swallows; the SW reply-await is unbounded (`route-preview.ts:108-164`) so one lost reply = forever. Diagnose per `rifty-fix`: instrument each hop (SW → page bridge → worker dispatch → shim → vite), one run, evidence picks the layer; fix where the response is lost.

## Acceptance

- E2E (RED first): vite dev server WITHOUT forced `allowedHosts`, preview request whose Host vite rejects → the iframe receives vite's real 403 (status + body), bounded time, no hang; the allowed-Host flow stays green.
- The fix lands at the layer where the 403 is lost, evidence in the PR (instrumented-run trace) — NOT a timeout that masks the lost response.
- preset-deglue's allowedHosts retirement (`net/preview-websocket-bridge` REMAINING) is unblocked by this item.

## Parity cases

- Real Node + same vite version, `server.allowedHosts` unset: request with a disallowed Host → `403` + vite's «Blocked request» body. Same project in rifty preview: same status + body reach the iframe.
- Allowed Host (localhost) → 200 document, identical in both.

## Fault matrix

- `false-fallback` × vite responds 403 pre-middleware → response relayed to the iframe verbatim (this item's bug).
- `unbounded-read` × reply frame genuinely lost → owned by `service-worker/preview-dispatch-termination-chokepoint` (backstop), not here.

## Out of scope

- Retiring forced `allowedHosts`/`host` from templates + wrapper — preset-deglue (`net/preview-websocket-bridge`) owns it; this item only unblocks.
- Generic termination backstops (worker death, channel teardown) — `service-worker/preview-dispatch-termination-chokepoint`.
- Host-header rewrite policy — PR #112 / ADR-0189 candidate, separate.

## Decisions

- Diagnosis discipline = `rifty-fix` (root cause + class analysis + RED e2e first).
- Fix at the born layer; a timeout here would convert a lost REAL response into a synthetic error — forbidden by the epic's parity-first decision.
