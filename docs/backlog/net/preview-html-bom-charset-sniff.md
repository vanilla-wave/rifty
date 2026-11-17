---
area: net
status: draft
title: Preview HTML rewrite picks its decoder from the header charset without BOM sniffing
created: 2026-11-17
why: serveCrossRealmPreview decodes html with TextDecoder(headerCharset ?? 'utf-8'), so a BOM Chromium honours over the header is mojibaked before the ws-bridge injection re-serves the page as utf-8
sources: [docs/adr/net/0189-preview-loopback-websocket-bridge.md]
code: [packages/net/src/cross-realm/preview-port.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17).
Every text/html preview body is decoded for the ADR-0189 injection:
`new TextDecoder(headerCharset ?? 'utf-8')` (`preview-port.ts:391`), `decode(raw)`
(`:403`), re-encoded UTF-8 (`:414`); `charset=utf-8` re-stamp keys on
`headerCharset` only (`:437`). No BOM check before decoder choice.

Chromium 148.0.7778.96 (playwright `page.route`, `/tmp/bomv-ws-66193/html.mjs`,
rerun 2026-11-17), body BOM + `<p>hi</p>`:
- `charset=utf-8` + `EF BB BF` → characterSet `UTF-8`, body `3c 70 3e 68`
- `charset=windows-1251` + `EF BB BF` → `UTF-8` (BOM beats header), `3c 70 3e 68`
- no charset + `FF FE` + UTF-16LE → `UTF-16LE`, `3c 70 3e 68`

rifty (`/tmp/netprobe-7DXn/preview.mts`, `serveCrossRealmPreview` +
`bridgeCrossRealmPreview` via repo `tsx`, Node v24.16.0):
- 1251 header + `EF BB BF` + utf-8 `<p>при</p>` → `charset=utf-8`, tail `п»ї<p>РїСЂРё</p>`
- `text/html` + `FF FE` + UTF-16LE `<p>hi</p>` → no charset, tail `U+FFFD U+FFFD <\0p\0>\0h\0i\0…`

utf-8 header + UTF-8 BOM: rifty strip matches Chromium (no fault).
Fault: corrupt-input (wrong decode) at the preview html-rewrite boundary.
Compat: no preview-HTML charset row in `docs/public/compat/http.md`.
Dedup: `git grep -i 'preview-port|htmlCharset|charset|sniff'` over docs/backlog,
traps.md, ADR §Declined: no match (perf preview-port items = copies/streaming;
`playground/binary-file-content-type-detection` = editor NUL sniff).

## Next

Owner net; trigger: preview of an html page whose BOM disagrees with or replaces
the header charset. Open: BOM-only sniff vs fuller HTML encoding sniffing (meta
prescan; non-utf8 meta refused loud today, `:404-413`) — pickup decides from
Chromium probes. RED first: preview-port test with the two rifty cases above →
re-served body decodes `<p>при</p>` / `<p>hi</p>`.
