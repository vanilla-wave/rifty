---
area: net
status: draft
title: Real-ws Autobahn-style interop pass + mutation-check for the RFC6455 upgrade frame guards
created: 2026-06-18
why: the table-driven parseFrame/parseClosePayload rejection suite is unit-level (hand-built bytes into the socket classes); the originally-scoped real-ws Autobahn-style interop pass and per-guard mutation-check were not delivered
sources: [PR#42 ws-honesty-audit ws-frame-protocol-untested, PR#53 review rfc6455-interop-and-mutation-check-dropped]
---
## Context
`upgrade-socket.test.ts` now pins every RFC6455 rejection branch (RSV→1002, unmasked client→1002, invalid UTF-8 text/close-reason→1007, reserved/1-byte close→1002, oversized/fragmented control→1002, mid-fragment data→1002, maxPayload→1009) as unit tests feeding `encodeTestFrame` bytes into `WebSocketUpgradeSocket`/`WebSocketClientSocket`. This closes the thin-coverage gap behind the compat ⚠️ claim. Not yet delivered (split out of the closed `ws-rfc6455-frame-parity-suite`): a real npm `ws` peer emitting boundary frames across the bridge and observing rifty's loud close (size classes, UTF-8, close codes — Autobahn-style), plus a mutation-check confirming each guard is load-bearing.

## Options / Next
Add a conformance pass where a real `ws` client/server emits boundary frames (size classes incl. 126/127 extended lengths, UTF-8 validity, full close-code matrix) and asserts the faithful close/echo across the bridge. Mutation-check each parseFrame/parseClosePayload guard (revert → test reds). Note: the bridge re-encodes msg/close via encodeServerFrame/encodeClientFrame and never carries raw untrusted bytes through parseFrame, so a pure external-fuzz harness needs the native-egress path, not the same-origin bridge.

## Reversibility
REVERSIBLE — test-only.
