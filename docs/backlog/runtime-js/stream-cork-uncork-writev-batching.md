---
area: runtime-js
status: ready
title: Writable cork/uncork batching + real _writev (re-add writev option)
created: 2026-06-28
why: cork/uncork batching is absent and the lying writev? option was correctly REMOVED (no-silent-stub); a Writable that corks to batch writes drains per-chunk today — re-add writev? wired to a real _writev when cork/uncork land
user_story: As a dev running a lib that calls `w.cork()` / `w.uncork()` (or `w.write()` between them) to batch writes into one `_writev`, I want the batching to actually defer + flush via `_writev`, but today cork/uncork are absent and writes drain one-by-one.
epic: whatwg-stream-bridge
sources: [ADR-0034, docs/public/compat/streams.md]
code: [packages/io/src/streams/writable.ts]
---

## Context

`cork`/`uncork` are absent; `drainBuffer` always calls `_write` per chunk. The `writev?` option was a type-only placeholder used NOWHERE and was REMOVED as a silent lie (`writable.ts:20-23` comment) — to be re-added FOR REAL when cork/uncork land (they need `_writev` working, so they ship together).

## Acceptance

- `w.cork()` defers buffered writes (no `_write`/`_writev` while corked); `w.uncork()` flushes the buffered chunks in ONE `_writev(chunks, cb)` call if `_writev` is defined, else falls back to sequential `_write`.
- Nested cork/uncork: drain happens only when the cork counter returns to 0 (Node semantics).
- `writev?` is re-added to `WritableOptions` and wired so a Writable constructed with `{ writev }` (or a subclass overriding `_writev`) receives the batched chunk array; the option is NOT accepted unless it is honored (no re-introduced lie).
- A corked stream still reports backpressure (`write()` → `false` past `highWaterMark`) and emits `'drain'` after uncork flushes.
An implementation that accepts `writev` but still drains per-chunk, or ignores the cork counter, fails this.

## Parity cases

- `w.cork(); w.write('a'); w.write('b'); w.uncork()` with a `_writev` → exactly one `_writev` call with `[{chunk:'a'},{chunk:'b'}]` (Node shape: `{chunk, encoding}` entries), vs real Node.
- Same without `_writev` → two sequential `_write` calls (fallback), preserving order.
- Nested `cork(); cork(); write('x'); uncork(); /* still corked */ uncork()` → flush only after the second uncork.
- `process.nextTick`-deferred implicit uncork (Node auto-uncorks on next tick if writes happened while corked) — matches Node's auto-uncork timing.
- Backpressure + `'drain'` across a cork/uncork cycle matches Node.

## Out of scope

- `_writev` for object-mode streams beyond Node's own behavior — follow Node, no extra semantics.
- WHATWG `WritableStream` batching (`Writable.fromWeb`) — `runtime-js/stream-writable-duplex-web-bridge`.

## Decisions

- `writev?` is re-added to `WritableOptions` ONLY together with a working `_writev` path (Fidelity — never the removed type-only lie).
- Auto-uncork on next tick follows Node's timing (cork/uncork batching contract).
- REVERSIBLE — additive Writable batching, no ADR; CHANGELOG line + compat ✅ flip.

## Reversibility

REVERSIBLE — additive cork/uncork + `_writev` on Writable; CHANGELOG line.
