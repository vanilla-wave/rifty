---
area: net
status: parked
title: Unify the 3 WS bridge-frame interfaces + share channel-name constants in ws/channel.ts
created: 2026-06-17
why: one BroadcastChannel wire protocol is modeled by 3 diverging types (WebSocketBridgeFrame + 2x BridgeFrame); a field added to one path (opcode/key) is invisible to the others — a cohesion/interop hazard since http/server.ts and ws/in-process.ts both subscribe to the same port-discovery channel
user_story: As a rifty maintainer evolving the WS bridge frame, I want a single canonical frame type and single source for the channel-name constants so a new field can't silently desync the http and ws parsers — can't yet, the type is forked across upgrade-socket.ts, ws/bridge.ts, ws/in-process.ts and the `rifty:ws:`/`websocket-port.local`/`__rifty_ws` literals are re-typed in the injected browser script.
sources: [PR#42 review architecture/bridge-frame-type-dup, architecture/wsmessage-type-source-coupling, architecture/channel-derivation-dup]
---
## Context
`packages/net/src/http/upgrade-socket.ts:WebSocketBridgeFrame` is the superset (adds `opcode`/`url`/`key`/`protocols`/`protocol`); `ws/bridge.ts:BridgeFrame` and `ws/in-process.ts:BridgeFrame` redeclare a narrower shape (no `opcode`/`key`). All three consume off the same BroadcastChannel — an `HttpServer.on('upgrade')` and a ws `WebSocketServer` on the same port both resolve the identical port-discovery channel name. Not a runtime bug today (BroadcastChannel carries all fields regardless of TS shape; the ws layer legitimately ignores `key`/`opcode`), and not an arch-layer violation — a cohesion gap. `WsMessage` also lives in the `ws/in-process.ts` impl module yet is imported type-only by http/upgrade-socket.ts.

## Options / Next
`ws/channel.ts` is import-free and already imported by both http/server.ts and the ws layer — promote the canonical `WebSocketBridgeFrame` and `WsMessage` there; have bridge.ts/in-process.ts import instead of redeclaring `BridgeFrame`, removing upgrade-socket.ts's reach into ws/in-process.ts. Optionally export `CHANNEL_PREFIX`/`__rifty_ws`/`websocket-port.local` from channel.ts and interpolate them into the injected browser-client-script string so even the unavoidable cross-realm copy has a single source.

## Reversibility
REVERSIBLE — internal type/constant consolidation, no public API or wire change.
