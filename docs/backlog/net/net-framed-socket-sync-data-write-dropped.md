---
area: net
status: draft
title: node:net framed socket keeps writes made synchronously inside the first 'data' event
created: 2026-11-17
why: a guest net server that answers inside its 'data' callback loses the write/end and the port dispatch never settles; Node answers 200
sources: [docs/backlog/net/net-framed-socket-utf8-response-decode.md]
code: [packages/net/src/net.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), split from
`net-framed-socket-utf8-response-decode`. In `net.ts` the port handler pushes
the request bytes (`socket.push(head)` :171, body :172) before it attaches the
`'write'`/`'end'` listeners (:176-178); a guest `'data'` handler that writes
synchronously emits before anyone listens. Probe (`/tmp/netprobe-7DXn`, Node
v24.16.0 vs rifty src via `tsx`): `net.createServer((s) => s.once('data', () => s.end(rawHttp200)))`
→ Node `http.get` 200; rifty `dispatchToPort` unsettled after 1 s. Fault:
observable-order (listener readiness after first delivery) at the framed
socket. Compat: no `node:net` row. Dedup: as the sibling draft (no match).

## Next

Owner net; trigger: a guest raw `net` server answering in its `'data'`
handler (the common minimal HTTP-over-net example). RED first: the probe as a
parity case.
