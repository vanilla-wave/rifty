import { NotImplementedError } from '@riftydev/io';
/**
 * Node-compatible `node:crypto` (subset).
 *
 * Implements the synchronous `createHash` API that Vite + most tooling
 * relies on (sha256, sha1, md5) using a pure-JS hash core — SubtleCrypto
 * cannot be used because it is async-only.
 *
 * `randomUUID` / `randomBytes` route through `crypto.getRandomValues` in the
 * browser realm. Anything else is loud: `NotImplementedError`.
 */
import { Buffer } from './buffer.ts';

type Encoding = 'hex' | 'base64' | 'base64url' | 'binary' | 'utf8';

interface Hasher {
  update(bytes: Uint8Array): void;
  digest(): Uint8Array;
}

class Hash {
  private readonly hasher: Hasher;
  private finalized = false;

  constructor(private readonly algorithm: string) {
    this.hasher = createHasher(algorithm);
  }

  update(data: string | Uint8Array | Buffer, inputEncoding?: Encoding): this {
    if (this.finalized) throw new Error('Hash already finalized');
    let bytes: Uint8Array;
    if (typeof data === 'string') {
      bytes = encodeString(data, inputEncoding ?? 'utf8');
    } else if (data instanceof Uint8Array) {
      bytes = data;
    } else {
      throw new TypeError('Hash.update: unsupported data type');
    }
    this.hasher.update(bytes);
    return this;
  }

  digest(): Buffer;
  digest(encoding: Encoding): string;
  digest(encoding?: Encoding): Buffer | string {
    if (this.finalized) throw new Error('Hash already finalized');
    this.finalized = true;
    const bytes = this.hasher.digest();
    if (!encoding) return Buffer.from(bytes);
    return encodeBytes(bytes, encoding);
  }

  copy(): Hash {
    throw new NotImplementedError('crypto.Hash.copy');
  }
}

class Hmac {
  private inner: Hasher;
  private outer: Hasher;
  private finalized = false;

  constructor(algorithm: string, key: string | Uint8Array | Buffer) {
    const blockSize = blockSizeFor(algorithm);
    let keyBytes: Uint8Array =
      typeof key === 'string' ? encodeString(key, 'utf8') : (key as Uint8Array);
    if (keyBytes.length > blockSize) {
      const h = createHasher(algorithm);
      h.update(keyBytes);
      keyBytes = h.digest();
    }
    const padded = new Uint8Array(blockSize);
    padded.set(keyBytes);
    const ipad = new Uint8Array(blockSize);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = padded[i]! ^ 0x36;
      opad[i] = padded[i]! ^ 0x5c;
    }
    this.inner = createHasher(algorithm);
    this.outer = createHasher(algorithm);
    this.inner.update(ipad);
    this.outer.update(opad);
  }

  update(data: string | Uint8Array, encoding?: Encoding): this {
    if (this.finalized) throw new Error('Hmac already finalized');
    const bytes = typeof data === 'string' ? encodeString(data, encoding ?? 'utf8') : data;
    this.inner.update(bytes);
    return this;
  }

  digest(): Buffer;
  digest(encoding: Encoding): string;
  digest(encoding?: Encoding): Buffer | string {
    if (this.finalized) throw new Error('Hmac already finalized');
    this.finalized = true;
    const innerDigest = this.inner.digest();
    this.outer.update(innerDigest);
    const final = this.outer.digest();
    if (!encoding) return Buffer.from(final);
    return encodeBytes(final, encoding);
  }
}

export function createHash(algorithm: string): Hash {
  return new Hash(algorithm.toLowerCase());
}

export function createHmac(algorithm: string, key: string | Uint8Array | Buffer): Hmac {
  return new Hmac(algorithm.toLowerCase(), key);
}

export function randomBytes(size: number): Buffer {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

export function randomFillSync<T extends Uint8Array>(buf: T, offset = 0, size?: number): T {
  const end = size === undefined ? buf.length : offset + size;
  const view = buf.subarray(offset, end);
  crypto.getRandomValues(view);
  return buf;
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

// Node 17+ exposes the Web Crypto `getRandomValues` directly on
// `node:crypto`. Vite uses it during config hashing.
export function getRandomValues<T extends ArrayBufferView>(view: T): T {
  crypto.getRandomValues(view as unknown as Uint8Array);
  return view;
}

export function getHashes(): string[] {
  return ['sha1', 'sha256', 'md5'];
}

export function getCiphers(): string[] {
  return [];
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return acc === 0;
}

const webcrypto = typeof crypto !== 'undefined' ? crypto : undefined;

const cryptoModule = {
  createHash,
  createHmac,
  randomBytes,
  randomFillSync,
  randomUUID,
  getRandomValues,
  getHashes,
  getCiphers,
  timingSafeEqual,
  webcrypto,
  subtle: webcrypto?.subtle,
  Hash,
  Hmac,
};

export default cryptoModule;

// ---------------------------------------------------------------------------
// Hash cores — pure JS so that .digest() can be synchronous, which is what
// Vite and the rest of the npm tooling ecosystem expect. SHA-256 is the one
// actually used at boot for content hashing; SHA-1 + MD5 are included because
// many packages still call them.
// ---------------------------------------------------------------------------

function createHasher(algorithm: string): Hasher {
  switch (algorithm) {
    case 'sha256':
      return new Sha256();
    case 'sha1':
      return new Sha1();
    case 'md5':
      return new Md5();
    default:
      throw new NotImplementedError(`crypto.createHash('${algorithm}')`);
  }
}

function blockSizeFor(algorithm: string): number {
  switch (algorithm) {
    case 'sha256':
    case 'sha1':
    case 'md5':
      return 64;
    default:
      throw new NotImplementedError(`crypto.createHmac('${algorithm}')`);
  }
}

function encodeString(str: string, encoding: Encoding): Uint8Array {
  if (encoding === 'utf8') return new TextEncoder().encode(str);
  if (encoding === 'hex') {
    const out = new Uint8Array(str.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(str.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  if (encoding === 'base64' || encoding === 'base64url') {
    const norm = encoding === 'base64url' ? str.replaceAll('-', '+').replaceAll('_', '/') : str;
    const bin = atob(norm);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (encoding === 'binary') {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }
  throw new NotImplementedError(`crypto encoding '${encoding}'`);
}

function encodeBytes(bytes: Uint8Array, encoding: Encoding): string {
  if (encoding === 'hex') {
    let s = '';
    for (const b of bytes) s += b.toString(16).padStart(2, '0');
    return s;
  }
  if (encoding === 'base64' || encoding === 'base64url') {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = btoa(bin);
    return encoding === 'base64url'
      ? b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
      : b64;
  }
  if (encoding === 'utf8') {
    return new TextDecoder().decode(bytes);
  }
  if (encoding === 'binary') {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
  throw new NotImplementedError(`crypto encoding '${encoding}'`);
}

// --- SHA-256 ---------------------------------------------------------------
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class Sha256 implements Hasher {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private totalLen = 0;

  update(bytes: Uint8Array): void {
    let i = 0;
    while (i < bytes.length) {
      const room = 64 - this.bufLen;
      const take = Math.min(room, bytes.length - i);
      this.buf.set(bytes.subarray(i, i + take), this.bufLen);
      this.bufLen += take;
      i += take;
      this.totalLen += take;
      if (this.bufLen === 64) {
        this.processBlock(this.buf);
        this.bufLen = 0;
      }
    }
  }

  digest(): Uint8Array {
    const bitLen = this.totalLen * 8;
    this.buf[this.bufLen++] = 0x80;
    if (this.bufLen > 56) {
      while (this.bufLen < 64) this.buf[this.bufLen++] = 0;
      this.processBlock(this.buf);
      this.bufLen = 0;
    }
    while (this.bufLen < 56) this.buf[this.bufLen++] = 0;
    // Length as 64-bit big-endian.
    const view = new DataView(this.buf.buffer, this.buf.byteOffset, 64);
    const high = Math.floor(bitLen / 0x100000000);
    const low = bitLen >>> 0;
    view.setUint32(56, high, false);
    view.setUint32(60, low, false);
    this.processBlock(this.buf);
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let j = 0; j < 8; j++) outView.setUint32(j * 4, this.h[j]!, false);
    return out;
  }

  private processBlock(block: Uint8Array): void {
    const w = new Uint32Array(64);
    const view = new DataView(block.buffer, block.byteOffset, 64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [
      this.h[0]!,
      this.h[1]!,
      this.h[2]!,
      this.h[3]!,
      this.h[4]!,
      this.h[5]!,
      this.h[6]!,
      this.h[7]!,
    ];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    this.h[0] = (this.h[0]! + a) >>> 0;
    this.h[1] = (this.h[1]! + b) >>> 0;
    this.h[2] = (this.h[2]! + c) >>> 0;
    this.h[3] = (this.h[3]! + d) >>> 0;
    this.h[4] = (this.h[4]! + e) >>> 0;
    this.h[5] = (this.h[5]! + f) >>> 0;
    this.h[6] = (this.h[6]! + g) >>> 0;
    this.h[7] = (this.h[7]! + h) >>> 0;
  }
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

// --- SHA-1 -----------------------------------------------------------------
class Sha1 implements Hasher {
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private totalLen = 0;

  update(bytes: Uint8Array): void {
    let i = 0;
    while (i < bytes.length) {
      const room = 64 - this.bufLen;
      const take = Math.min(room, bytes.length - i);
      this.buf.set(bytes.subarray(i, i + take), this.bufLen);
      this.bufLen += take;
      i += take;
      this.totalLen += take;
      if (this.bufLen === 64) {
        this.processBlock(this.buf);
        this.bufLen = 0;
      }
    }
  }

  digest(): Uint8Array {
    const bitLen = this.totalLen * 8;
    this.buf[this.bufLen++] = 0x80;
    if (this.bufLen > 56) {
      while (this.bufLen < 64) this.buf[this.bufLen++] = 0;
      this.processBlock(this.buf);
      this.bufLen = 0;
    }
    while (this.bufLen < 56) this.buf[this.bufLen++] = 0;
    const view = new DataView(this.buf.buffer, this.buf.byteOffset, 64);
    view.setUint32(56, Math.floor(bitLen / 0x100000000), false);
    view.setUint32(60, bitLen >>> 0, false);
    this.processBlock(this.buf);
    const out = new Uint8Array(20);
    const outView = new DataView(out.buffer);
    for (let j = 0; j < 5; j++) outView.setUint32(j * 4, this.h[j]!, false);
    return out;
  }

  private processBlock(block: Uint8Array): void {
    const w = new Uint32Array(80);
    const view = new DataView(block.buffer, block.byteOffset, 64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4, false);
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    }
    let [a, b, c, d, e] = [this.h[0]!, this.h[1]!, this.h[2]!, this.h[3]!, this.h[4]!];
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    this.h[0] = (this.h[0]! + a) >>> 0;
    this.h[1] = (this.h[1]! + b) >>> 0;
    this.h[2] = (this.h[2]! + c) >>> 0;
    this.h[3] = (this.h[3]! + d) >>> 0;
    this.h[4] = (this.h[4]! + e) >>> 0;
  }
}

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

// --- MD5 -------------------------------------------------------------------
const MD5_K = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

class Md5 implements Hasher {
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private totalLen = 0;

  update(bytes: Uint8Array): void {
    let i = 0;
    while (i < bytes.length) {
      const room = 64 - this.bufLen;
      const take = Math.min(room, bytes.length - i);
      this.buf.set(bytes.subarray(i, i + take), this.bufLen);
      this.bufLen += take;
      i += take;
      this.totalLen += take;
      if (this.bufLen === 64) {
        this.processBlock(this.buf);
        this.bufLen = 0;
      }
    }
  }

  digest(): Uint8Array {
    const bitLen = this.totalLen * 8;
    this.buf[this.bufLen++] = 0x80;
    if (this.bufLen > 56) {
      while (this.bufLen < 64) this.buf[this.bufLen++] = 0;
      this.processBlock(this.buf);
      this.bufLen = 0;
    }
    while (this.bufLen < 56) this.buf[this.bufLen++] = 0;
    const view = new DataView(this.buf.buffer, this.buf.byteOffset, 64);
    view.setUint32(56, bitLen >>> 0, true);
    view.setUint32(60, Math.floor(bitLen / 0x100000000), true);
    this.processBlock(this.buf);
    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    for (let j = 0; j < 4; j++) outView.setUint32(j * 4, this.h[j]!, true);
    return out;
  }

  private processBlock(block: Uint8Array): void {
    const m = new Uint32Array(16);
    const view = new DataView(block.buffer, block.byteOffset, 64);
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(i * 4, true);
    let [a, b, c, d] = [this.h[0]!, this.h[1]!, this.h[2]!, this.h[3]!];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const t = (a + f + MD5_K[i]! + m[g]!) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(t, MD5_S[i]!)) >>> 0;
    }
    this.h[0] = (this.h[0]! + a) >>> 0;
    this.h[1] = (this.h[1]! + b) >>> 0;
    this.h[2] = (this.h[2]! + c) >>> 0;
    this.h[3] = (this.h[3]! + d) >>> 0;
  }
}
