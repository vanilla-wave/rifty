---
area: runtime-js
status: draft
title: A Readable never emits 'close' after 'end'; a Transform emits 'finish' before 'end', a Duplex 'finish' before 'data'
created: 2026-11-24
why: Node's autoDestroy emits `'close'` after a Readable's `'end'` (Duplex/Transform: after both sides) and a Transform's `'end'` precedes `'finish'`; rifty never emits `'close'` after `'end'` (a Writable's `'close'` after `'finish'` does fire), and a Duplex/Transform emits `'finish'` before the pending `'data'`.
sources: ["PR #433 (stream hook dispatch)", docs/public/compat/streams.md]
code: [packages/io/src/streams/duplex.ts, packages/io/src/streams/transform.ts]
---

## Context

Found by PR #433 (stream hook dispatch); its parity cases avoid this order.
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

The readable side is the general gap (PR #433 review, 2026-11-24): a plain Readable read to
`'end'` plus a Writable ended → Node `W finish,R end,W close,R close`, rifty `W finish,W close,R end`.

Code: `Readable` has no autoDestroy (no `'close'` after `'end'`); the Duplex forwards its inner writable's `'finish'` as soon as it fires; no autoDestroy joins
the two sides into one `'close'`; Transform pushes on the writable side's schedule.

Owner: runtime-js (`@riftydev/io` Duplex). Trigger: a package awaiting `'close'` on a Transform/Duplex
or ordering `'end'`/`'finish'`. Compat streams.md ⚠️ row.

## Challenge

challenge: 2026-11-24 — none (factual capture, measured vs live Node)
