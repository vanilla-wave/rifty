---
kind: epic
status: ready
title: Fault-honest SW preview — dispatch settles on every terminal event, a hang is a bug
created: 2026-07-05
value: The preview either serves or says why — no dev-server/routing failure mode (dead worker, closed socket, misconfig) can park an iframe, an HMR socket, or a loopback http.request forever.
user_story: As a developer, I want the preview to fail loudly with a diagnosable error when routing breaks, but today a host-check rejection reproducibly parks the iframe forever (untraced) and the bridge's termination semantics (worker death, teardown mid-request, WS upgrade) have no fault rows.
items: [service-worker/preview-blocked-host-hang, service-worker/preview-dispatch-termination-chokepoint, net/preview-ws-bridge-termination]
---

## Outcome

SW preview dispatch is a multi-hop path (page → SW → bridge → owner worker → http shim → dev server) where any hop dying silently parks the request — the `unbounded-read` / `false-fallback` axes (`docs/process/fault-classes.md`). This epic makes every flow over the broker settle honestly: real upstream responses relayed verbatim (parity-first), synthesized diagnosable errors ONLY where no response exists, sockets that error instead of parking. Side payoff: unblocks preset-deglue's `allowedHosts` retirement (blocked today by the untraced hang).

## User scenario

A developer opens a vite preset, runs the real `npm run dev`, preview goes LIVE. (1) They bring their OWN `vite.config` without `allowedHosts`: a host-check rejection shows vite's REAL 403 «Blocked request» page in the iframe — byte-parity with curl against real vite — not a white hang. (2) The dev server (or its worker) dies mid-request: the iframe shows a diagnosable error page (status + failed hop + hint) within a bound; the HMR socket closes and vite's own client shows «server connection lost. polling for restart…»; after `npm run dev` again, reconnect works. (3) Their app code calls itself over loopback `http.request`/`fetch` (SSR, tests): a server death mid-response surfaces as an `ECONNRESET`-family error exactly like real Node — never a parked promise. Done when all three run as fault tests + e2e and the allowedHosts retirement in preset-deglue is unblocked.

## Items

- `service-worker/preview-blocked-host-hang` (ready) — planned Contract+RED diagnosis + repair of the lost Vite 403; unblocks preset-deglue's allowedHosts retirement.
- `service-worker/preview-dispatch-termination-chokepoint` (ready, blocked_by the diagnosis) — settle on every terminal event; ONE chokepoint, parity-first synthesized page only when no response exists; covers loopback http.request.
- `net/preview-ws-bridge-termination` (ready) — WS/HMR sockets error/close under faults, vite's own reconnect UX works.

## Decisions (epic-level, ratified at refine 2026-07-05)

- Failure UX = parity-first (user): real responses byte-verbatim; synthesized page only when no response exists.
- Scope = all three broker flows (user): iframe HTTP, WS/HMR, loopback http.request.
- Boundary with preset-deglue (mechanism): retirement of forced options stays in `net/preview-websocket-bridge`; this epic only removes its blocker.
