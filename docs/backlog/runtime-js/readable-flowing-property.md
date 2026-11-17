---
area: runtime-js
status: draft
title: "`readable.readableFlowing` and `readable.isPaused()` report Node's flow state"
created: 2026-11-17
why: rifty's Readable has neither `readableFlowing` nor `isPaused()`, so code branching on the flow state reads `undefined` or throws `TypeError: r.isPaused is not a function` (no loud gap)
sources: [PR #400 alias-identity sweep]
code: [packages/io/src/streams/readable.ts]
---

## Context

REV-12 discovery of the `on === addListener` alias unit (PR #400). Parity
runner, Node v24.16.0 vs rifty, scratch CJS case: `const r = new
Readable({ read() {} }); EventEmitter.prototype.on.call(r, 'data', fn);
r.push('y');` then `console.log(r.readableFlowing, 'readableFlowing' in r)`
after 10 ms → Node `null true`, rifty `undefined false`; after
`r.on('data')` Node `true`, rifty `undefined`. The internal state exists
(`_readableState.flowing`). `isPaused` is absent from `packages/` (`git grep`),
so `r.isPaused()` throws `TypeError` where Node returns `false` after
`resume()` and `true` after `pause()`.

## Next

Owner runtime-js. Trigger: a consumer reading `readableFlowing` (stream
adapters, `child_process` stdio callers). Parity first: `null` → `true` on
`'data'`/`resume()`, `false` on `pause()`/`unpipe()`.
