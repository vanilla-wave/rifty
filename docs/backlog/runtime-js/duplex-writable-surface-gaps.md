---
area: runtime-js
status: draft
title: Duplex lacks Writable's cork/uncork/setDefaultEncoding and the per-side objectMode options
created: 2026-11-24
why: A Node Duplex/Transform inherits every Writable method and takes `readableObjectMode`/`writableObjectMode`; rifty's Duplex has no `cork`/`uncork`/`setDefaultEncoding`/`writableCorked` (TypeError) and ignores the per-side objectMode options (HWM and mode wrong, silently).
sources: [docs/backlog/runtime-js/stream-subclass-hooks-ignored.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/duplex.ts, packages/io/src/streams/callable-constructor.ts]
---

## Context

Found by `runtime-js/stream-subclass-hooks-ignored` (PR #433) while proving Duplex `_writev`.
Repro 2026-11-24, same program in Node v24.16.0 and the rifty parity runner at `c957fbe43`:

```js
const d = new Duplex({ read() {}, write(c, e, cb) { cb(); } });
['cork', 'uncork', 'setDefaultEncoding'].map((k) => typeof d[k]); d.writableCorked;
const t = new Transform({ writableObjectMode: true, transform(c, e, cb) { cb(null, String(c)); } });
[t.writableObjectMode, t.writableHighWaterMark];
new PassThrough({ readableObjectMode: true }).readableObjectMode;
```

| | Node | rifty |
|---|---|---|
| Duplex `cork`/`uncork`/`setDefaultEncoding` | function ×3, `writableCorked` 0 | undefined ×3, `writableCorked` undefined |
| Transform `writableObjectMode: true` | `writableObjectMode` true, `writableHighWaterMark` 16 | false, 65536 |
| PassThrough `readableObjectMode: true` | true | false |

`d.cork()` throws `TypeError: d.cork is not a function`. `writableNeedDrain` is
`runtime-js/writable-sync-dispatch-state`.

Owner: runtime-js (`@riftydev/io` Duplex). Trigger: a package corking a Duplex/socket-like stream, or
one relying on per-side objectMode. Compat streams.md ⚠️ row.

## Challenge

challenge: 2026-11-24 — none (factual capture, measured vs live Node)
