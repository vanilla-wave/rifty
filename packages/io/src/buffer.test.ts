import { describe, expect, it } from 'vitest';
import { Buffer } from './buffer.ts';

describe('Buffer.write', () => {
  it('honors `length` (truncation)', () => {
    const b = Buffer.alloc(10);
    const n = b.write('hello', 0, 3);
    expect(n).toBe(3);
    expect(Array.from(b)).toEqual([0x68, 0x65, 0x6c, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('honors `encoding` (utf16le)', () => {
    const b = Buffer.alloc(10);
    const n = b.write('ab', 0, 4, 'utf16le');
    expect(n).toBe(4);
    expect(b.toString('hex', 0, 4)).toBe('61006200');
  });

  it('honors `encoding` (hex)', () => {
    const b = Buffer.alloc(4);
    const n = b.write('deadbeef', 0, 'hex');
    expect(n).toBe(4);
    expect(b.toString('hex')).toBe('deadbeef');
  });

  it('honors `encoding` (ascii)', () => {
    const b = Buffer.alloc(4);
    b.write('ABCD', 'ascii');
    expect(b.toString('ascii')).toBe('ABCD');
  });

  it('honors `encoding` (base64)', () => {
    const b = Buffer.alloc(6);
    const n = b.write('aGVsbG8h', 0, 'base64');
    expect(n).toBe(6);
    expect(b.toString('utf8')).toBe('hello!');
  });

  it('rejects offset > length', () => {
    const b = Buffer.alloc(4);
    expect(() => b.write('x', 5)).toThrow(/offset.*out of range/);
  });

  it('rejects length > buffer length', () => {
    const b = Buffer.alloc(4);
    expect(() => b.write('x', 0, 99)).toThrow(/length.*out of range/);
  });

  it('rejects negative length', () => {
    const b = Buffer.alloc(4);
    expect(() => b.write('x', 0, -1)).toThrow(/length.*out of range/);
  });

  it('truncates write to remaining buffer when length exceeds available space', () => {
    const b = Buffer.alloc(10);
    const n = b.write('helloworld', 5, 6);
    expect(n).toBe(5);
    expect(b.toString('utf8', 0, 5)).toBe('\x00\x00\x00\x00\x00');
    expect(b.toString('utf8', 5)).toBe('hello');
  });
});

describe('Buffer.alloc', () => {
  it('tile-fills bytes from `fill` string under default utf8', () => {
    const b = Buffer.alloc(6, 'abc');
    expect(b.toString('utf8')).toBe('abcabc');
  });

  it('tile-fills under utf16le encoding', () => {
    const b = Buffer.alloc(8, 'a', 'utf16le');
    expect(b.toString('hex')).toBe('6100610061006100');
  });

  it('tile-fills under hex encoding', () => {
    const b = Buffer.alloc(4, 'AB', 'hex');
    expect(b.toString('hex')).toBe('abababab');
  });

  it('truncates the last tile to fit', () => {
    const b = Buffer.alloc(5, 'ab');
    expect(b.toString('utf8')).toBe('ababa');
  });

  it('numeric fill ignores encoding', () => {
    const b = Buffer.alloc(4, 0xaa);
    expect(b.toString('hex')).toBe('aaaaaaaa');
  });
});

describe('Buffer.read/writeFloat / Double', () => {
  it('roundtrips Float32 BE', () => {
    const b = Buffer.alloc(4);
    b.writeFloatBE(1.5, 0);
    expect(b.readFloatBE(0)).toBe(1.5);
  });

  it('BE != LE', () => {
    const be = Buffer.alloc(4);
    be.writeFloatBE(1.5, 0);
    const le = Buffer.alloc(4);
    le.writeFloatLE(1.5, 0);
    expect(be.toString('hex')).not.toBe(le.toString('hex'));
    expect(be.readFloatBE(0)).toBe(le.readFloatLE(0));
  });

  it('roundtrips Float64 (Double) BE/LE', () => {
    const be = Buffer.alloc(8);
    be.writeDoubleBE(Math.PI, 0);
    expect(be.readDoubleBE(0)).toBe(Math.PI);

    const le = Buffer.alloc(8);
    le.writeDoubleLE(Math.PI, 0);
    expect(le.readDoubleLE(0)).toBe(Math.PI);
  });

  it('writeFloat returns post-write offset', () => {
    const b = Buffer.alloc(8);
    expect(b.writeFloatBE(0.5, 0)).toBe(4);
    expect(b.writeDoubleBE(0.5, 0)).toBe(8);
  });
});

describe('Buffer.indexOf / lastIndexOf / includes', () => {
  it('finds a single byte int', () => {
    const b = Buffer.from([1, 2, 3, 2, 1]);
    expect(b.indexOf(2)).toBe(1);
    expect(b.lastIndexOf(2)).toBe(3);
    expect(b.includes(2)).toBe(true);
    expect(b.indexOf(99)).toBe(-1);
    expect(b.includes(99)).toBe(false);
  });

  it('finds a string needle (utf8 default)', () => {
    const b = Buffer.from('hello world hello');
    expect(b.indexOf('hello')).toBe(0);
    expect(b.lastIndexOf('hello')).toBe(12);
    expect(b.includes('orl')).toBe(true);
  });

  it('honors byteOffset', () => {
    const b = Buffer.from('aaa');
    expect(b.indexOf('a', 1)).toBe(1);
    expect(b.indexOf('a', 5)).toBe(-1);
  });

  it('finds a sub-buffer needle', () => {
    const b = Buffer.from([0, 1, 2, 3]);
    const needle = Buffer.from([2, 3]);
    expect(b.indexOf(needle)).toBe(2);
  });

  it('respects encoding for string needle', () => {
    const b = Buffer.from('AAAA', 'hex'); // bytes: aa aa
    expect(b.indexOf('AA', 0, 'hex')).toBe(0);
  });
});

describe('Buffer.fill', () => {
  it('fills with a number byte', () => {
    const b = Buffer.alloc(4);
    b.fill(0xab);
    expect(b.toString('hex')).toBe('abababab');
  });

  it('tile-fills with a string under default utf8', () => {
    const b = Buffer.alloc(6);
    b.fill('ab');
    expect(b.toString('utf8')).toBe('ababab');
  });

  it('honors offset/end range', () => {
    const b = Buffer.alloc(8, 0);
    b.fill(0xff, 2, 6);
    expect(b.toString('hex')).toBe('0000ffffffff0000');
  });

  it('honors encoding (utf16le)', () => {
    const b = Buffer.alloc(8, 0);
    b.fill('a', 'utf16le');
    expect(b.toString('hex')).toBe('6100610061006100');
  });

  it('returns the buffer for chaining', () => {
    const b = Buffer.alloc(2);
    expect(b.fill(0xaa)).toBe(b);
  });

  it('throws on out-of-range', () => {
    const b = Buffer.alloc(4);
    expect(() => b.fill(0, -1)).toThrow(/Out of range/);
    expect(() => b.fill(0, 0, 99)).toThrow(/Out of range/);
  });
});

describe('Buffer.copy', () => {
  it('copies a slice into target', () => {
    const src = Buffer.from('hello');
    const dst = Buffer.alloc(10, 0x2e); // '.'
    const n = src.copy(dst, 2);
    expect(n).toBe(5);
    expect(dst.toString('utf8')).toBe('..hello...');
  });

  it('honors sourceStart and sourceEnd', () => {
    const src = Buffer.from('hello');
    const dst = Buffer.alloc(10, 0x2e);
    const n = src.copy(dst, 0, 1, 4); // 'ell'
    expect(n).toBe(3);
    expect(dst.toString('utf8', 0, 3)).toBe('ell');
  });

  it('truncates when target lacks space', () => {
    const src = Buffer.from('hello');
    const dst = Buffer.alloc(3);
    const n = src.copy(dst, 0);
    expect(n).toBe(3);
    expect(dst.toString('utf8')).toBe('hel');
  });

  it('returns 0 when sourceEnd <= sourceStart', () => {
    const src = Buffer.from('hello');
    const dst = Buffer.alloc(10);
    expect(src.copy(dst, 0, 3, 1)).toBe(0);
  });
});
