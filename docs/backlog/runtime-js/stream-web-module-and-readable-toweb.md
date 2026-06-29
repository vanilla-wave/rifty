---
area: runtime-js
status: ready
title: Register node:stream/web + Readable.toWeb
created: 2026-06-28
why: node:stream/web is unregistered and Readable.toWeb is absent — the highest-reach WHATWG bridge gap; both are pure-JS over Chromium's WHATWG globals + the existing Readable lifecycle (ADR-0154 leaves the surface unclaimed)
user_story: As a dev running a lib that does `import { ReadableStream, TransformStream } from 'node:stream/web'` or calls `Readable.toWeb(nodeStream)` to hand a Node stream to a Web API, I want them to work, but today the module is unregistered (import throws) and toWeb is undefined.
epic: whatwg-stream-bridge
sources: [ADR-0154, ADR-0035, docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts, packages/io/src/streams/index.ts, packages/runtime-js/src/builtins/stream.ts, packages/runtime-js/src/builtins/index.ts]
---

## Context

`node:stream/web` is not in the builtin registry (`builtins/index.ts` registers `stream`, `stream/promises`, `stream/consumers`, but not `stream/web`). `Readable.fromWeb` exists and is parity-tested (`readable.ts:897`); `Readable.toWeb` is absent. Both are pure-JS: the module re-exports Chromium's WHATWG globals; `toWeb` wraps the Readable's data/end/error in a `ReadableStream` source.

## Acceptance

- `import` / `require` of `node:stream/web` resolves a module exporting the Chromium WHATWG constructors: `ReadableStream`, `WritableStream`, `TransformStream`, `ByteLengthQueuingStrategy`, `CountQueuingStrategy`, `ReadableStreamDefaultReader`, `ReadableStreamBYOBReader`, `ReadableStreamDefaultController`, `ReadableByteStreamController`, `WritableStreamDefaultWriter`, `WritableStreamDefaultController`, `TransformStreamDefaultController`, `TextEncoderStream`, `TextDecoderStream` — each `=== globalThis.<Name>` where Chromium provides it.
- `Readable.toWeb(r)` returns a real `ReadableStream`: its reader yields `r`'s chunks in order and byte-exact; `r` ending → stream close; `r` erroring → stream error (same error); `reader.cancel(reason)` → `r.destroy()`.
- A genuinely-absent WHATWG member (not provided by the host) is a loud throw at access, never an `undefined` export that lies.
An approximation that buffers the whole Readable before exposing it, or drops backpressure, fails this.

## Parity cases

- `import('node:stream/web')` keys + identities match Node's module (each present constructor is the platform global), vs real Node.
- `Readable.from(['a','b']).toWeb()` → `reader.read()` yields `'a'` then `'b'` then `{done:true}`, matching Node.
- A Readable that errors mid-stream → the web reader rejects with that error (not a generic one).
- `reader.cancel()` on the web side → the source Readable is destroyed (no further `'data'`).
- Backpressure: a slow web consumer pulls one chunk at a time; the source does not over-read (honors `highWaterMark`), matching Node's pull-driven `toWeb`.
- Object-mode Readable → `toWeb` yields the objects unchanged (Node parity).

## Out of scope

- `Writable.toWeb`/`fromWeb`, `Duplex.toWeb`/`fromWeb` — `runtime-js/stream-writable-duplex-web-bridge`.
- BYOB read into a caller-supplied buffer beyond what Chromium's `ReadableStreamBYOBReader` already provides — no custom byte-source reimplementation; rely on the platform.

## Decisions

- `node:stream/web` re-exports the host WHATWG globals (no reimplementation); registered alongside `stream`/`stream/promises`/`stream/consumers` in `builtins/index.ts` (ADR-0035 registry).
- `toWeb` source is pull-driven (honors backpressure) with `cancel` → `destroy`; lives on `Readable` in `@riftydev/io`, exported from `streams/index.ts`.
- REVERSIBLE — additive, no ADR (ADR-0154 leaves the surface unclaimed); CHANGELOG line + compat ✅ flip for the two rows.

## Reversibility

REVERSIBLE — additive pure-JS over host WHATWG globals; deletable; CHANGELOG line.
