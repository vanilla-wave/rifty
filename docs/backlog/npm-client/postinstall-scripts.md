---
area: npm-client
status: parked
title: Postinstall (lifecycle) scripts in npm-client
created: 2026-06-08
why: postinstall execution unimplemented; deferred — most packages don't need it, no verified consumer need
sources: [TASKS Follow-ups]
---
## Context
npm-client does not run package lifecycle scripts (postinstall/preinstall/install). Named as a follow-up; deferred because most packages in scope don't require them, and running arbitrary install scripts in-browser is itself constrained by the no-process-spawn ceiling (a postinstall that shells out to a native build would hit the same wall as the opencode tool-ceiling).
## Options / Next
Parked until a verified consumer needs it. When picked up: decide which lifecycle scripts to honour and how (in-realm JS-only postinstall vs the spawn ceiling for native build steps); a native-build postinstall is fundamentally blocked (ADR-0006 native-bindings limit / spawn ceiling), so scope would be JS-only lifecycle hooks.
## Reversibility
Gated — no work until a real need appears. Likely reversible at first (a JS-only hook runner), but interacts with the process-spawn ceiling for native builds (which is a hard platform limit, not patchable).
