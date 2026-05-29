import { describe, expect, it } from 'vitest';
import { Buffer } from '../../../packages/runtime-js/src/builtins/buffer.ts';

/**
 * Regression for the real-express run path. express pulls Buffer through
 * `safe-buffer`, which only re-exports the real `buffer` module (the one with
 * `isBuffer`) when `Buffer.from && Buffer.alloc && Buffer.allocUnsafe &&
 * Buffer.allocUnsafeSlow` are ALL present. A missing `allocUnsafeSlow` made
 * safe-buffer fall back to a shim without `isBuffer`, so `res.send` threw
 * "Buffer.isBuffer is not a function".
 */
describe('node:buffer — static surface (safe-buffer compatibility)', () => {
  it('exposes every static safe-buffer gates on, so isBuffer survives the re-export', () => {
    expect(typeof Buffer.from).toBe('function');
    expect(typeof Buffer.alloc).toBe('function');
    expect(typeof Buffer.allocUnsafe).toBe('function');
    expect(typeof Buffer.allocUnsafeSlow).toBe('function');
    expect(typeof Buffer.isBuffer).toBe('function');
    expect(Buffer.isBuffer(Buffer.from('x'))).toBe(true);
    expect(Buffer.isBuffer('x')).toBe(false);
  });

  it('allocUnsafeSlow returns a Buffer of the requested size', () => {
    const b = Buffer.allocUnsafeSlow(8);
    expect(Buffer.isBuffer(b)).toBe(true);
    expect(b.length).toBe(8);
  });

  it('isEncoding recognises supported encodings case-insensitively', () => {
    expect(Buffer.isEncoding('utf8')).toBe(true);
    expect(Buffer.isEncoding('UTF-8')).toBe(true);
    expect(Buffer.isEncoding('hex')).toBe(true);
    expect(Buffer.isEncoding('base64')).toBe(true);
    expect(Buffer.isEncoding('nope')).toBe(false);
    expect(Buffer.isEncoding(42 as unknown as string)).toBe(false);
  });
});
