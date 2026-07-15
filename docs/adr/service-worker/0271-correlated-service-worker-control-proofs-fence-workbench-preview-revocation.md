# ADR 0271: Correlated service-worker control proofs fence Workbench preview revocation

Status: Accepted
Date: 2026-07

> TL;DR: each service-worker control proof owns a reply `MessagePort`; Workbench
> closes a mounted preview only after a correlated post-GOODBYE proof settles.

## Context

`setupPreviewBridge` teardown posts `rifty:preview:goodbye`, then removes its
page listener. `postMessage` only enqueues the frame. A fetch immediately after
`Project.close()` could therefore reach the SW first: the SW still saw the
window as ready, sent a request to the removed listener, and waited forever.
PR #148 browser CI caught that exact third A→B→A revocation race.

The existing control proof could not fence it. PING/PONG used the shared
service-worker message stream with no correlation. A delayed readiness PONG
could satisfy a later close barrier before the SW processed GOODBYE.

## Decision

- Every control-proof attempt creates one `MessageChannel`, transfers its reply
  port with PING, and accepts PONG only on the retained port with the exact frame
  and routing versions. Controller replacement closes the old channel and
  starts a new attempt; settle, abort, and timeout close all owned ports.
- The SW replies on the transferred port when present. Zero-port PING keeps the
  source-reply behavior for existing callers. This is an additive transport
  option, so `SW_FRAME_VERSION` stays unchanged. A fresh host controlled by an
  old SW ignores its uncorrelated global PONG and waits for `controllerchange`;
  if the replacement never claims, the existing bound rejects loudly.
- Same-source messages to one controller are FIFO. Workbench route teardown
  enqueues GOODBYE, then starts the correlated proof. Its PONG therefore proves
  the controller processed the earlier revocation. If the controller changed,
  the replacement owns no stale registration and the proof targets it instead.
- Preview readiness records a successfully mounted route independently of
  teardown success. Its close tears down the route, then conditionally waits for
  the barrier. Public run close, project close, and physical run retirement all
  compose that same close. Teardown or proof failure stays loud and aggregated;
  repeated close returns one promise.
- Rejected: delay/microtask heuristics; a fetch probe that can itself enter the
  stale route; an explicit GOODBYE ACK/generation (third coordination
  mechanism); a generic SW reply timeout, which could mask a real Vite response
  and remains owned by `service-worker/preview-dispatch-termination-chokepoint`.

## Consequences

- Fulfilled project close means a later preview fetch cannot be dispatched to
  its removed page listener through stale SW readiness.
- Open/readiness proofs also stop accepting stale PONGs from prior attempts.
- A project with no mounted route pays no barrier. A routed project pays one
  bounded control round-trip; controller/protocol loss rejects close visibly.
- Already-dispatched requests and arbitrary lost replies remain outside this
  barrier and inside the existing generic termination-chokepoint backlog.
