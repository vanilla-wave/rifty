---
area: runtime-js
status: draft
title: A Transform keeps accepting writes while its readable buffer is full
created: 2026-11-24
why: Node holds a Transform's `_transform` callback while the readable side is at its high-water mark, so `write()` returns `false` and writes queue; rifty calls back at once, `write()` always returns `true` and the readable buffer grows without bound.
sources: [docs/backlog/runtime-js/stream-subclass-hooks-ignored.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/transform.ts]
---

## Context

Found by `runtime-js/stream-subclass-hooks-ignored` (PR #433) while deciding whether its compat
`Transform` row may be ✅. Repro 2026-11-24, same program in Node v24.16.0 and the rifty parity
runner (branch `t3/stream-subclass-hooks`, after the hook-dispatch fix):

```js
const t = new Transform({ highWaterMark: 2, objectMode: true, transform(c, e, cb) { cb(null, c); } });
const rets = []; for (let i = 0; i < 8; i++) rets.push(t.write(i));
setTimeout(() => console.log(rets.join(','), t.readableLength, t.writableLength), 10);
```

Node: `true,true,false,false,false,false,false,false 2 7`; rifty: `true,true,true,true,true,true,true,true 8 0`.
Code: `Transform.prototype._write` calls its callback right after `_transform` pushes; Node stores it
and releases it from `_read` when the consumer drains. Applies to PassThrough and every Transform
subclass (zlib `Gzip` too).

Owner: runtime-js (`@riftydev/io` Transform). Trigger: a slow consumer behind a Transform (pipe of a
large file through a Transform, memory growth). Compat streams.md `Transform` / `PassThrough`
backpressure ⚠️ row.

## Challenge

challenge: 2026-11-24 — none (factual capture, measured vs live Node)
