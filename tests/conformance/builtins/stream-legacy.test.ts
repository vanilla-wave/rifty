import { describe, expect, it } from 'vitest';
import stream, { Readable, Writable } from '../../../packages/runtime-js/src/builtins/stream.ts';
import util from '../../../packages/runtime-js/src/builtins/util.ts';

/**
 * Regression for the real-express run path: `send/index.js` does
 * `util.inherits(SendStream, require('stream'))` then `Stream.call(this)`.
 * Node's `require('stream')` is the legacy callable `Stream` base (a function
 * inheriting EventEmitter) with the modern classes attached. We collapse the
 * Readable→Stream→EventEmitter chain, but the stream module must still BE that
 * callable base or `util.inherits` throws "expects constructors".
 */
describe('node:stream — legacy callable Stream base', () => {
  it('default export is a callable function with the modern classes attached', () => {
    expect(typeof stream).toBe('function');
    const s = stream as unknown as Record<string, unknown>;
    expect(s.Readable).toBe(Readable);
    expect(s.Writable).toBe(Writable);
    expect(s.Stream).toBe(stream);
  });

  it('util.inherits(Child, require("stream")) + Stream.call(this) inits EventEmitter state', () => {
    const Stream = stream as unknown as (this: unknown) => void;
    function SendLike(this: unknown) {
      Stream.call(this);
    }
    expect(() => util.inherits(SendLike, Stream)).not.toThrow();
    expect((SendLike as unknown as { super_: unknown }).super_).toBe(stream);

    const inst = new (
      SendLike as unknown as new () => {
        on(e: string, l: (...a: unknown[]) => void): unknown;
        emit(e: string, ...a: unknown[]): boolean;
      }
    )();
    let got: unknown;
    inst.on('data', (v) => {
      got = v;
    });
    inst.emit('data', 42);
    expect(got).toBe(42);
  });
});
