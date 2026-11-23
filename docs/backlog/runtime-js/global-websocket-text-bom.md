---
area: runtime-js
status: draft
title: Guest global WebSocket strips a leading BOM from text messages, as Node's undici
created: 2026-11-17
why: rifty exposes the browser's native WebSocket as the guest global, which keeps a leading U+FEFF that Node's undici WebSocket drops
sources: [docs/backlog/net/ws-bridge-text-bom-strip.md]
code: [packages/runtime-js/src/builtins/host-async-keepalive.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17, sweep critic);
reverse direction (rifty keeps where Node strips). Probes against a raw-frame
server sending text EF BB BF 68 69 and close reason EF BB BF 72: Node v24.16.0
global `WebSocket` (undici) → message `68 69`, reason `72`; Chromium 148 native
`WebSocket` → `feff 68 69`, `feff 72`. rifty's guest global is the native
constructor (`host-async-keepalive.ts` ~:181), so guest code sees Chromium's
result. Opposite of `net/ws-bridge-text-bom-strip` (`ws` package peers keep
the bytes). Fault: sibling-drift between the guest global and Node's undici.
Dedup: git grep WebSocket over docs/backlog/runtime-js — no message-decode item.

## Next

Owner runtime-js; trigger: a claimed client comparing text messages from a
BOM-emitting server. RED first: the probe as a parity case against a local
raw-frame server (Node side undici).
