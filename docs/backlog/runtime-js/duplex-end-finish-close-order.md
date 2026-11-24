---
area: runtime-js
status: draft
title: A Transform emits 'finish' before 'end', a Duplex 'finish' before 'data', and neither emits 'close' after both sides end
created: 2026-11-24
why: Node's Duplex/Transform emit `'close'` once both sides are done (autoDestroy) and a Transform's `'end'` precedes `'finish'`; rifty emits `'finish'` before the pending `'data'` (and a Transform's `'end'`) and never `'close'`.
sources: [docs/backlog/runtime-js/stream-subclass-hooks-ignored.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/duplex.ts, packages/io/src/streams/transform.ts]
---

## Context

Found by `runtime-js/stream-subclass-hooks-ignored` (PR #433); its parity cases avoid this order.
Repro 2026-11-24, same program in Node v24.16.0 and the rifty parity runner at `c957fbe43`:

```js
const t = new Transform({ transform(c, e, cb) { L.push('T'); cb(null, c); }, flush(cb) { L.push('F'); cb(); } });
for (const ev of ['prefinish', 'finish', 'end', 'close']) t.on(ev, () => L.push(ev));
t.on('data', () => L.push('data')); t.end('x');
const d = new Duplex({ read() { this.push('r'); this.push(null); }, write(c, e, cb) { cb(); } });
// listeners finish/end/close + data; d.end('x')
```

| | Node | rifty |
|---|---|---|
| Transform | `T,data,F,prefinish,end,finish,close` | `T,F,prefinish,data,finish,end` |
| Duplex | `data,finish,end,close` | `finish,data,end` |

Node's Duplex also emits `'finish'` before `'end'`; the Duplex gap is `'finish'` before `'data'` and the missing `'close'`.

Code: the Duplex forwards its inner writable's `'finish'` as soon as it fires; no autoDestroy joins
the two sides into one `'close'`; Transform pushes on the writable side's schedule.

Owner: runtime-js (`@riftydev/io` Duplex). Trigger: a package awaiting `'close'` on a Transform/Duplex
or ordering `'end'`/`'finish'`. Compat streams.md ⚠️ row.

## Challenge

challenge: 2026-11-24 — none (factual capture, measured vs live Node)
