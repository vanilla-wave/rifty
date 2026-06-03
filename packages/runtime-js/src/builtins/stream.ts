/**
 * Re-export shim — stream primitives live in `@riftydev/io` per ADR-0012.
 * Consumers that import this path (relative `./stream.ts` or
 * `@riftydev/runtime-js/builtins`) continue to work bit-identically.
 */

import {
  Buffer,
  Duplex,
  PassThrough,
  Readable,
  Stream,
  Transform,
  Writable,
  finished,
  pipeline,
} from '@riftydev/io';

export {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  Stream,
  pipeline,
  finished,
  type ReadableOptions,
  type WritableOptions,
  type TransformOptions,
} from '@riftydev/io';

// `require('stream')` in Node IS the legacy `Stream` constructor with the
// modern classes attached as statics (and `Stream.Stream === Stream`). Match
// that shape so `util.inherits(X, require('stream'))` works (e.g. `send`).
const stream = Object.assign(Stream, {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
  finished,
  Stream,
});
export default stream;

// ───────────────────────────── stream/consumers ─────────────────────────────
// Node's `node:stream/consumers`: drain a stream (or async iterable, or web
// ReadableStream) into a single value. opencode reaches `buffer`/`text` (child
// stdout in `util/process.ts`, `cli/cmd/providers.ts`, `lsp/server.ts`); the
// full set is implemented for parity. Faithful: each accumulates the chunks then
// coerces, exactly like Node's implementation (which is `for await` over the
// stream).

type ConsumableStream =
  | AsyncIterable<unknown>
  | { getReader(): { read(): Promise<{ done: boolean; value?: unknown }> } };

function chunkToBuffer(chunk: unknown): Buffer {
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (Buffer.isBuffer(chunk)) return chunk as Buffer;
  if (chunk instanceof Uint8Array)
    return Buffer.from(chunk.buffer as ArrayBuffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  if (ArrayBuffer.isView(chunk))
    return Buffer.from(chunk.buffer as ArrayBuffer, chunk.byteOffset, chunk.byteLength);
  // objectMode-ish/loose values: coerce to string like Node does on a non-binary
  // chunk rather than dropping it.
  return Buffer.from(String(chunk), 'utf8');
}

async function consume(source: ConsumableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  if (typeof (source as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
    for await (const chunk of source as AsyncIterable<unknown>) chunks.push(chunkToBuffer(chunk));
  } else if (typeof (source as { getReader?: unknown }).getReader === 'function') {
    // Web ReadableStream that is not async-iterable in this realm: drain it via
    // a reader so Node's "accepts a web stream too" contract still holds.
    const reader = (
      source as { getReader(): { read(): Promise<{ done: boolean; value?: unknown }> } }
    ).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) chunks.push(chunkToBuffer(value));
    }
  } else {
    throw new TypeError('The "stream" argument must be an async iterable or a ReadableStream.');
  }
  return Buffer.concat(chunks);
}

export const streamConsumers = {
  buffer(source: ConsumableStream): Promise<Buffer> {
    return consume(source);
  },
  async arrayBuffer(source: ConsumableStream): Promise<ArrayBuffer> {
    const b = await consume(source);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  async text(source: ConsumableStream): Promise<string> {
    return (await consume(source)).toString('utf8');
  },
  async json(source: ConsumableStream): Promise<unknown> {
    return JSON.parse((await consume(source)).toString('utf8'));
  },
  async blob(source: ConsumableStream): Promise<Blob> {
    return new Blob([await consume(source)]);
  },
};
