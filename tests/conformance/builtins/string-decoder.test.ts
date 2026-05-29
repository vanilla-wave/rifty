import { describe, expect, it } from 'vitest';
import sd from '../../../packages/runtime-js/src/builtins/string_decoder.ts';

/**
 * Regression for the real-express body-parser path. `iconv-lite`'s
 * `InternalDecoder` does `StringDecoder.call(this, codec.enc)` then borrows
 * `StringDecoder.prototype.write`. A class throws "cannot be invoked without
 * 'new'", so the decoder must be a callable constructor.
 */
describe('node:string_decoder — callable StringDecoder', () => {
  const { StringDecoder } = sd;

  it('decodes via `new StringDecoder()` (utf-8)', () => {
    const d = new StringDecoder('utf8');
    expect(d.write(new TextEncoder().encode('hé'))).toBe('hé');
    expect(d.encoding).toBe('utf8');
  });

  it('supports the StringDecoder.call(this, enc) + prototype.write idiom', () => {
    const obj = {} as { write(b: Uint8Array): string; encoding: string };
    const ctor = StringDecoder as unknown as (this: typeof obj, enc: string) => void;
    expect(() => ctor.call(obj, 'utf-8')).not.toThrow();
    const write = (StringDecoder as unknown as { prototype: { write(b: Uint8Array): string } })
      .prototype.write;
    expect(write.call(obj, new TextEncoder().encode('{"a":1}'))).toBe('{"a":1}');
  });
});
