---
area: net
status: draft
title: WebSocket bridge text decode drops a leading BOM from messages and close reasons
created: 2026-11-17
why: upgrade-socket decodes text frames and close reasons with a BOM-stripping TextDecoder, so every bridge peer gets the string without a leading U+FEFF that ws@8.18.3 and Chromium keep
sources: [docs/adr/net/0151-http-websocket-upgrade-over-bridge.md, docs/adr/net/0189-preview-loopback-websocket-bridge.md]
code: [packages/net/src/http/upgrade-socket.ts, packages/net/src/http/server.ts, packages/net/src/ws/browser-client-script.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17).
`upgrade-socket.ts:852` `decodeFatalUtf8` = `new TextDecoder('utf-8', { fatal: true })`
(ignoreBOM false). Callers: `sendServerMessage` :350, `sendClientMessage` :619,
`parseClosePayload` :894. Bridge carries the string → page shim
`MessageEvent.data` (`browser-client-script.ts:383`), loopback peer
`_receiveBridgeMessage` re-encodes, native egress `native.send` (`server.ts:838`).

Probe (Node v24.16.0, raw TCP server sends text `EF BB BF 68 69` + close 1000
reason `EF BB BF 72`): ws@8.18.3 msg `efbbbf6869`, reason `efbbbf72`; Chromium
148.0.7778.96 `WebSocket` msg `feff 68 69`, reason `feff 72`. Node global
`WebSocket` (undici) msg `68 69` (strips). Rifty decoder on same bytes → `68 69`.
Observer fork (guest ws peer vs preview page): closed, both keep. Undici not
traced onto this bridge. Rifty end-to-end not probed.
Fault: corrupt-input (lossy decode) at the ws bridge boundary.
Compat: `docs/public/compat/http.md:12` (gen. `tools/compat-matrix-generator/cli.js:216-218`)
`server.on('upgrade')` WebSocket ✅ "RFC 6455 … real npm `ws` … tested" overclaims
text-frame/close-reason fidelity while `:852` strips; no BOM case tested
(`git grep -i 'bom|feff'` over `upgrade-socket*.ts`, `ws-package-loader.test.ts`: none).
Dedup: `git grep -i 'upgrade-socket|decodeFatal|BOM|ignoreBOM|websocket'` over
docs/backlog, traps.md, ADR §Declined: no match (ws-max-payload,
ws-permessage-deflate, preview-ws-* are other mechanisms).

## Next

Owner net; trigger: guest ws server/client sends text or close reason starting
with U+FEFF. RED first: guest `ws` server `send('\uFEFFhi')` + `close(1000, '\uFEFFr')`
over the bridge (`tests/conformance/builtins/ws-package-loader.test.ts` style) →
peer gets `feff 68 69` / `feff 72`; invalid UTF-8 still closes 1007.
