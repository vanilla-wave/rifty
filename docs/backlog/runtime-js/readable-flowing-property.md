---
area: runtime-js
status: draft
title: "`readable.readableFlowing` and `readable.isPaused()` report Node's flow state"
created: 2026-11-17
epic: node-streams-as-in-node
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

## Goal unit

Unit 2 of goal `node-streams-as-in-node` (map item 2, I2) is wider than this title. It covers:

- constructor option validation as Node's `ReadableState`/`WritableState` (`highWaterMark`,
  `readableHighWaterMark`/`writableHighWaterMark`, `signal`, `encoding`, `defaultEncoding`);
- `write(chunk, '', cb)` taking the default encoding;
- `readableFlowing` and `isPaused()`, `writableNeedDrain` (`writable-sync-dispatch-state`);
- `[Symbol.asyncDispose]`.

Matrices: the goal's `reference/results/m2-core-members.txt` and `m8-constructor-options.txt`.

## Next

Owner runtime-js. Trigger: a consumer reading `readableFlowing` (stream
adapters, `child_process` stdio callers). Parity first: `null` → `true` on
`'data'`/`resume()`, `false` on `pause()`/`unpipe()`.
