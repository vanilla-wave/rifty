---
kind: epic
status: ready
title: Fault-honest SW preview — dispatch settles on every terminal event, a hang is a bug
created: 2026-07-05
value: The preview either serves or says why — no dev-server/routing failure mode (dead worker, closed socket, misconfig) can park an iframe, an HMR socket, or a loopback http.request forever.
user_story: As a developer, I want the preview to fail loudly with a diagnosable error when routing breaks, but today a host-check rejection reproducibly parks the iframe forever (untraced) and the bridge's termination semantics (worker death, teardown mid-request, WS upgrade) have no fault rows.
tier: robust
---

## Outcome

SW preview dispatch is a multi-hop path (page → SW → bridge → owner worker → http shim → dev server) where any hop dying silently parks the request — the `unbounded-read` / `false-fallback` axes (`docs/process/fault-classes.md`). This epic makes every flow over the broker settle honestly: real upstream responses relayed verbatim (parity-first), synthesized diagnosable errors ONLY where no response exists, sockets that error instead of parking. Side payoff: unblocks preset-deglue's `allowedHosts` retirement (blocked today by the untraced hang).

## User scenario

A developer opens a vite preset, runs the real `npm run dev`, preview goes LIVE. (1) They bring their OWN `vite.config` without `allowedHosts`: a host-check rejection shows vite's REAL 403 «Blocked request» page in the iframe — byte-parity with curl against real vite — not a white hang. (2) The dev server (or its worker) dies mid-request: the iframe shows a diagnosable error page (status + failed hop + hint) within a bound; the HMR socket closes and vite's own client shows «server connection lost. polling for restart…»; after `npm run dev` again, reconnect works. (3) Their app code calls itself over loopback `http.request`/`fetch` (SSR, tests): a server death mid-response surfaces as an `ECONNRESET`-family error exactly like real Node — never a parked promise. Done when all three run as fault tests + e2e and the allowedHosts retirement in preset-deglue is unblocked.

## Invariants

<!-- Each false on `046e92330`, one line of evidence per statement:
     I1 — `io/src/preview-protocol.ts:38` records the hang; the integration
          tests still force `allowedHosts: true`; `Blocked request` appears
          nowhere outside backlog docs.
     I2 — `service-worker/src/route-preview.ts:108` awaits the reply with no
          timer, no reject, no `onmessageerror`, through EOF at :165.
     I3 — no `connection lost` / `polling for restart` string in any `.ts`.
     I4 — `ECONNRESET` exists only in the errno table (`runtime-js/src/builtins/
          os.ts:212`) and in `services/eddy`; nothing on the preview/loopback
          broker produces it.
     I5 — today a real 403 exists upstream and is lost, so "verbatim wherever a
          response exists" is false. I5 closes ONLY on its own proof: in each of
          the three flows, a real upstream response arrives byte-verbatim AND a
          no-response case still yields the synthesized page. I1's 403 test
          alone does not close it. -->

1. I1. With the developer's own `vite.config` and no forced `allowedHosts`, a
   host-check rejection shows vite's real `403 Blocked request` page in the
   preview iframe — byte-identical to curl against the same real vite.
2. I2. A dev server (or its worker) dying mid-request ends that request with a
   diagnosable page naming status, failed hop, and next step, within a stated
   bound. No request over the broker parks forever.
3. I3. On the same death the HMR socket closes, vite's own client shows «server
   connection lost. polling for restart…», and a fresh `npm run dev` reconnects.
4. I4. A loopback `http.request`/`fetch` whose server dies mid-response rejects
   with an `ECONNRESET`-family error like real Node — never a parked promise.
5. I5. Wherever an upstream response exists the user sees its bytes verbatim;
   synthesized diagnostics appear only where no response will ever come.

## Items

1. `service-worker/preview-blocked-host-hang` — **blocked-host-diagnosis** —
   Contract+RED diagnosis + repair of the lost Vite 403 (I1); its hop evidence
   decides where terminal events are observable, so it leads.
2. `service-worker/preview-dispatch-termination-chokepoint` — **termination-chokepoint** —
   settle on every terminal event (I2, I4, I5); ONE chokepoint, parity-first
   synthesized page only when no response exists; covers loopback
   `http.request`. Blocked by the diagnosis.
3. `net/preview-ws-bridge-termination` — **ws-termination** — WS/HMR sockets
   error/close under faults and vite's own reconnect UX works (I3); reuses the
   chokepoint's terminal-event reporting where the broker overlaps.

## Decisions (epic-level, ratified at refine 2026-07-05)

- invariants-signoff: 2026-07-30 — user (I1–I5 drafted from this epic's
  ratified scenario, each checked false on `14b0dad99`).

- Failure UX = parity-first (user): real responses byte-verbatim; synthesized page only when no response exists.
- Scope = all three broker flows (user): iframe HTTP, WS/HMR, loopback http.request.
- Boundary with preset-deglue (mechanism): retirement of forced options stays in `net/preview-websocket-bridge`; this epic only removes its blocker.
- `tier: robust` (2026-07-30): every reachable hop × termination axis owes an
  honest outcome + fault test, but no invariant spans crash/reload — the preview
  is re-established by a fresh run, so `production` would buy nothing here.

## Budget

- scope implemented outside `ready` items: 0
- ready-contract edits after pickup: 0
- new coordination mechanisms: 0 — the chokepoint reuses the existing broker
  correlation; a second timer family per hop is the named anti-pattern
- generated globs: `docs/public/compat/**`, `**/generated/**`

| slice | band |
|---|---|
| blocked-host-diagnosis | 300–800 |
| termination-chokepoint | 800–2000 |
| ws-termination | 400–1000 |
