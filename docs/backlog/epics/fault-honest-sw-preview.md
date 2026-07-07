---
kind: epic
status: ready
title: Fault-honest SW preview — dispatch settles on every terminal event, a hang is a bug
created: 2026-07-05
value: The preview either serves or says why — no dev-server/routing failure mode (dead worker, closed socket, misconfig) can park an iframe, an HMR socket, or a loopback http.request forever.
user_story: As a developer, I want the preview to fail loudly with a diagnosable error when routing breaks, but the bridge's termination semantics (worker death, teardown mid-request, WS upgrade) have no fault rows. (The original entry point — "a host-check rejection parks the iframe forever" — was DIAGNOSED and refuted: it was rifty `node:net` missing `isIP` throwing in vite's async host-check, not a lost response; fixed with parity `cases/net/is-ip`, and a rejected Host is unreachable through the preview path anyway since the SW stamps `Host: localhost`, ADR-0189 D3.)
items: [service-worker/preview-dispatch-termination-chokepoint, net/preview-ws-bridge-termination]
---

## Outcome

SW preview dispatch is a multi-hop path (page → SW → bridge → owner worker → http shim → dev server) where any hop dying silently parks the request — the `unbounded-read` / `false-fallback` axes (`docs/process/fault-classes.md`). This epic makes every flow over the broker settle honestly: real upstream responses relayed verbatim (parity-first), synthesized diagnosable errors ONLY where no response exists, sockets that error instead of parking. The `allowedHosts` retirement that this epic was meant to unblock ALREADY landed (via the `net.isIP` fix, not this epic) — the two live items are the general termination-honesty backstop that remains valuable regardless.

## User scenario

A developer opens a vite preset, runs the real `npm run dev`, preview goes LIVE. (1) The dev server (or its worker) dies mid-request: the iframe shows a diagnosable error page (status + failed hop + hint) within a bound; the HMR socket closes and vite's own client shows «server connection lost. polling for restart…»; after `npm run dev` again, reconnect works. (2) Their app code calls itself over loopback `http.request`/`fetch` (SSR, tests): a server death mid-response surfaces as an `ECONNRESET`-family error exactly like real Node — never a parked promise. Done when both run as fault tests + e2e. (The former scenario "a host-check rejection shows vite's real 403 in the iframe, not a white hang" is DROPPED: the hang was `net.isIP` — fixed — and the SW stamps `Host: localhost`, so a rejected Host never reaches vite through the preview iframe.)

## Items

- `service-worker/preview-dispatch-termination-chokepoint` (ready) — settle on every terminal event; ONE chokepoint, parity-first synthesized page only when no response exists; covers loopback http.request.
- `net/preview-ws-bridge-termination` (ready) — WS/HMR sockets error/close under faults, vite's own reconnect UX works.

RESOLVED + removed: `service-worker/preview-blocked-host-hang` — the "host-check rejection parks the iframe" hang was diagnosed to rifty `node:net` missing `isIP` (vite's async host-check threw a TypeError connect swallowed), fixed with real `isIP` + parity `cases/net/is-ip`; the preview-path rejected-Host it feared is unreachable (SW stamps `Host: localhost`, ADR-0189 D3). No lost-403 bug existed. Its promised unblock of preset-deglue's allowedHosts retirement is delivered.

## Decisions (epic-level, ratified at refine 2026-07-05)

- Failure UX = parity-first (user): real responses byte-verbatim; synthesized page only when no response exists.
- Scope = the two remaining broker flows (user): WS/HMR and loopback http.request termination (the iframe-HTTP host-check-403 scenario was refuted — see RESOLVED above).
- Boundary with preset-deglue (mechanism): retirement of forced options stays in `net/preview-websocket-bridge`; this epic's blocker-removal for it is already delivered (via `net.isIP`).
