import { describe, expect, it } from 'vitest';
import { Buffer } from '../../../packages/runtime-js/src/builtins/buffer.ts';

describe('node:buffer Buffer', () => {
  it('from(string).toString() roundtrips utf-8', () => {
    expect(Buffer.from('hello').toString()).toBe('hello');
    expect(Buffer.from('Привет').toString('utf8')).toBe('Привет');
  });
  it('alloc fills with byte', () => {
    const b = Buffer.alloc(4, 0x41);
    expect(b.toString('utf8')).toBe('AAAA');
  });
  it('concat joins buffers', () => {
    const out = Buffer.concat([Buffer.from('hi '), Buffer.from('there')]);
    expect(out.toString()).toBe('hi there');
  });
  it('byteLength counts bytes (not chars)', () => {
    expect(Buffer.byteLength('Привет', 'utf8')).toBeGreaterThan(6);
  });
  it('toString("hex")', () => {
    expect(Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString('hex')).toBe('deadbeef');
  });
  it('toString("base64") encodes/decodes', () => {
    const b64 = Buffer.from('hi!').toString('base64');
    expect(b64).toBe('aGkh');
    expect(Buffer.from(b64, 'base64').toString()).toBe('hi!');
  });
  it('isBuffer recognises our tagged Uint8Array', () => {
    expect(Buffer.isBuffer(Buffer.from('x'))).toBe(true);
    expect(Buffer.isBuffer(new Uint8Array(2))).toBe(false);
  });
  it('equals compares content', () => {
    expect(Buffer.from('abc').equals(Buffer.from('abc'))).toBe(true);
    expect(Buffer.from('abc').equals(Buffer.from('abd'))).toBe(false);
  });
});

describe('node:buffer Buffer — integer read/write', () => {
  it('readUInt8 / writeUInt8 roundtrip', () => {
    const b = Buffer.alloc(2);
    b.writeUInt8(0x12, 0);
    b.writeUInt8(0xff, 1);
    expect(b.readUInt8(0)).toBe(0x12);
    expect(b.readUInt8(1)).toBe(0xff);
  });
  it('readInt8 / writeInt8 sign-extend correctly', () => {
    const b = Buffer.alloc(1);
    b.writeInt8(-1, 0);
    expect(b.readInt8(0)).toBe(-1);
    expect(b.readUInt8(0)).toBe(0xff);
  });
  it('readUInt16BE / LE differ by byte order', () => {
    const b = Buffer.from([0x12, 0x34]);
    expect(b.readUInt16BE(0)).toBe(0x1234);
    expect(b.readUInt16LE(0)).toBe(0x3412);
  });
  it('readUInt32BE / LE differ by byte order', () => {
    const b = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    expect(b.readUInt32BE(0)).toBe(0xdeadbeef);
    expect(b.readUInt32LE(0)).toBe(0xefbeadde);
  });
  it('readInt32BE handles negatives', () => {
    const b = Buffer.alloc(4);
    b.writeInt32BE(-1, 0);
    expect(b.readInt32BE(0)).toBe(-1);
    expect(b.readUInt32BE(0)).toBe(0xffffffff);
  });
  it('readBigUInt64BE / LE roundtrip', () => {
    const b = Buffer.alloc(8);
    const value = 0x0123456789abcdefn;
    b.writeBigUInt64BE(value, 0);
    expect(b.readBigUInt64BE(0)).toBe(value);
    const b2 = Buffer.alloc(8);
    b2.writeBigUInt64LE(value, 0);
    expect(b2.readBigUInt64LE(0)).toBe(value);
    expect(b2.readBigUInt64BE(0)).not.toBe(value);
  });
  it('readBigInt64BE handles negatives', () => {
    const b = Buffer.alloc(8);
    b.writeBigInt64BE(-1n, 0);
    expect(b.readBigInt64BE(0)).toBe(-1n);
    expect(b.readBigUInt64BE(0)).toBe(0xffffffffffffffffn);
  });
  it('writers return post-write offset', () => {
    const b = Buffer.alloc(8);
    expect(b.writeUInt8(1, 0)).toBe(1);
    expect(b.writeUInt16BE(1, 0)).toBe(2);
    expect(b.writeUInt32BE(1, 0)).toBe(4);
    expect(b.writeBigUInt64BE(1n, 0)).toBe(8);
  });
});

describe('node:buffer Buffer — swap', () => {
  it('swap16 swaps each pair of bytes', () => {
    const b = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    b.swap16();
    expect(Array.from(b)).toEqual([0x02, 0x01, 0x04, 0x03]);
  });
  it('swap16 throws on odd length', () => {
    expect(() => Buffer.from([0x01, 0x02, 0x03]).swap16()).toThrow(RangeError);
  });
  it('swap32 reverses each 4-byte group', () => {
    const b = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    b.swap32();
    expect(Array.from(b)).toEqual([0x04, 0x03, 0x02, 0x01, 0x08, 0x07, 0x06, 0x05]);
  });
  it('swap64 reverses each 8-byte group', () => {
    const b = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    b.swap64();
    expect(Array.from(b)).toEqual([0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]);
  });
});

describe('node:buffer Buffer — compare', () => {
  it('instance compare orders lexicographically', () => {
    expect(Buffer.from('abc').compare(Buffer.from('abd'))).toBe(-1);
    expect(Buffer.from('abd').compare(Buffer.from('abc'))).toBe(1);
    expect(Buffer.from('abc').compare(Buffer.from('abc'))).toBe(0);
  });
  it('shorter prefix is less', () => {
    expect(Buffer.from('ab').compare(Buffer.from('abc'))).toBe(-1);
    expect(Buffer.from('abc').compare(Buffer.from('ab'))).toBe(1);
  });
  it('static Buffer.compare matches instance compare', () => {
    expect(Buffer.compare(Buffer.from('a'), Buffer.from('b'))).toBe(-1);
    expect(Buffer.compare(Buffer.from('b'), Buffer.from('a'))).toBe(1);
    expect(Buffer.compare(Buffer.from('x'), Buffer.from('x'))).toBe(0);
  });
});
