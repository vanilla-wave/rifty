---
area: net
status: parked
title: Real-TCP net.Socket semantics (current Socket is HTTP-only)
created: 2026-06-08
why: No raw TCP socket behavior — Socket only backs the HTTP path; M7 open acceptance
sources: [TASKS M7, ADR-0017, A-024]
---
## Context
M7 open acceptance row: rifty's `net.Socket` is HTTP-only; there is no raw TCP socket behavior. ADR-0017 records the intent — `net.Socket` gains a full TCP-shape surface — but where TCP semantics can't be faithfully emulated in the browser (e.g. `localAddress` selection), the TSDoc declares the limitation final (scope ceiling). No raw socket transport exists in the browser/SW model; the bridge carries HTTP request/reply, not byte-stream sockets.

## Options / Next
Next: widen `net.Socket` toward a faithful TCP-shape surface for the emulable parts; mark non-emulable parts (localAddress, half-open nuance) as final-limitation TSDoc per ADR-0017. Gate: only when a target package needs raw `net.Socket` beyond the HTTP path. No silent stubs — unemulable members throw `NotImplementedError` with a compat entry.

## Reversibility
REVERSIBLE for additive Socket-shape members; the non-emulable ceiling is recorded as final in ADR-0017. Parked — M7 open acceptance, no current consumer beyond HTTP.
