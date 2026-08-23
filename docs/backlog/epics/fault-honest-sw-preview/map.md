# Map — fault-honest-sw-preview

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

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

## Open questions

(none — all three slices are specifiable)

## Out of scope

- Forced-option retirement itself stays in `net/preview-websocket-bridge` (preset-deglue); this goal only removes its blocker.
