---
area: net
status: draft
title: node:net framed-socket fallback decodes the whole response write buffer as UTF-8
created: 2026-11-17
why: a guest net.createServer writing raw HTTP gets non-UTF-8 body bytes turned into U+FFFD and a latin1 header byte thrown as a ByteString TypeError, where Node passes the bytes through
sources: [docs/adr/net/0017-net-scope-and-streaming-rewrite.md]
code: [packages/net/src/net.ts, packages/net/src/register-builtins.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17).
Path: guest `require('node:net').createServer(h).listen(p)` (`register-builtins.ts:59-82`)
→ `Server.listen` registers a port handler (`net.ts:161-204`); any port dispatch
(preview, `http.get` loopback `http/server.ts:610`) runs it. No prod code emits
`'response'` on `HttpFramedSocket`, so socket `end` → `UTF8_DECODER.decode(all)`
(`net.ts:33`, `:184`) over head+body → hand parse → `new Response(bodyStr, …)`
(`:200`) re-encodes body UTF-8. ADR-0017:33 says the socket "carries HTTP-shape frames, not raw bytes"; no line declares lossy header/body decode.

Probe (`/tmp/netprobe-7DXn`, Node v24.16.0; rifty = src via repo `tsx`): server
writes `HTTP/1.1 200 OK\r\nX-L: caf<E9>\r\nContent-Length: 3\r\n…\r\n\r\n` + body
`ff 00 80`, from a `setTimeout` after `'data'`.
- Node `net` + `http.get`: 200, `x-l` `63 61 66 e9`, body `ff0080`.
- rifty `dispatchToPort`: guest `s.end()` throws `TypeError: Cannot convert argument
  to a ByteString … value of 65533` (`Headers.set`, `net.ts:198`); dispatch never settles.
- rifty, `X-L` dropped: 200, body `efbfbd00efbfbd` (7 bytes under `Content-Length: 3`).

Code read, not probed: `headers.set` (`:198`) collapses duplicate header lines
(`Set-Cookie` ×2 → 1); leading `EF BB BF` before the status line is stripped and
still parses 200 (Node client outcome not probed).
Separate mechanism: sync writes inside `'data'` dropped —
`net-framed-socket-sync-data-write-dropped`.
Fault: corrupt-input (lossy decode) at the node:net framed-response boundary.
Compat: no `node:net` row in `docs/public/compat/` (only `net.Server.address()`, `http.md:20`).
Dedup: `git grep -i 'HttpFramedSocket|UTF8_DECODER|net\.ts|node:net|raw http'` over
docs/backlog, traps.md, ADR §Declined: only perf codec-singleton lines
(`perf/none-items-quick-wins.md`) and `net/server-address-full-shape` — other mechanisms.

## Next

Owner net; trigger: guest net server serving binary/latin1-header responses.
Open: byte-level head parse (latin1 head, raw body slice) vs reuse of an existing
HTTP response parser — pickup decides. RED first: parity case Node vs rifty with
the probe bytes above.
