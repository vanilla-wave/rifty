---
kind: epic
status: draft
title: Fault-honest SW preview — dispatch settles on every terminal event, a hang is a bug
created: 2026-07-05
value: The preview either serves or says why — no dev-server/routing failure mode (dead worker, closed socket, misconfig) can park an iframe forever.
user_story: As a developer, I want the preview to fail loudly with a diagnosable error when routing breaks, but today a dispatch without `allowedHosts` reproducibly hangs forever (untraced) and the SW bridge's termination semantics (worker death, connection teardown mid-request, WS upgrade) have no fault rows.
items: []
---

## Outcome

Service-worker preview dispatch is a multi-hop path (page → SW → bridge → owner http-shim → dev server) where any hop dying silently parks the request — the unbounded-read / false-fallback axes (`docs/process/fault-classes.md`). Entry point: diagnose the known allowedHosts hang to root cause (`rifty-fix` — real vite answers 403 «Blocked request», so a silent park is a fidelity gap in our shim, not «allowedHosts magic»), then a settle-on-every-terminal-event chokepoint + fault rows for the whole bridge.

## Candidate boundaries (items carved at refine)

- dispatch hang without `allowedHosts` (preset-deglue residue) — root cause first, then the fix
- dispatch termination chokepoint: settle on response / connection teardown / worker exit / abort; bounded timeout as backstop only
- HMR / asset / WS-upgrade paths through the bridge — same axes

## Items

(to be carved by `rifty-refine`)
