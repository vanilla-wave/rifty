---
area: service-worker
status: parked
title: No-transferable-stream realm drains an unending SSE body forever (guard the drain fallback)
created: 2026-06-08
why: packSerializedResponse's drain fallback buffers to Uint8Array — on an unending text/event-stream body in a realm without transferable streams it hangs forever, delivering SSE never and silently
user_story: As a dev whose rifty-previewed app streams Server-Sent Events (`text/event-stream`), I want it to deliver — or fail loud — in browsers without transferable `ReadableStream`s, but today `packSerializedResponse` drains the unending body to a `Uint8Array` and hangs forever, delivering SSE never and silently.
sources: [feature-07-ws-sse-bridge (T3/Risks), ADR-0055, ADR-0048]
---
## Context
SSE rides the SW→page hop: `packSerializedResponse` transfers a `ReadableStream` zero-copy when `canTransferReadableStream()` (Chromium ≥89, FF ≥103, Safari ≥16.4); otherwise it DRAINS the body to a `Uint8Array`. An SSE response (`text/event-stream`) never ends, so in a no-transferable-stream realm (older Safari / some Workers) the drain awaits an unending body and hangs forever — SSE is delivered never, silently. feature-07 names this the documented SSE ceiling (T3 pins both branches; T4 compat-matrix note must be loud).
## Options / Next
Add a guard that refuses to drain a `text/event-stream` (unending) body rather than hanging — fail loud (NotImplementedError / explicit 501-shaped response naming the ceiling) instead of silent never-delivery. feature-07 flags this as a SEPARATE ticket (do not bundle into the v3 frame-bump work). Pair with a loud compat-matrix row: SSE over page-direct = supported where transferable streams exist; unsupported (ceiling) otherwise.
## Reversibility
Reversible — a localized guard + a compat-matrix note in packages/service-worker; no cross-package API change, no ADR conflict (it documents/enforces the ceiling ADR-0055 already names). The behaviour change (refuse-to-drain) is its own small ticket, kept off the v3 path.
