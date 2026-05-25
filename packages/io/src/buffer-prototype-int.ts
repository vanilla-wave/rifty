/**
 * Integer / BigInt prototype readers and writers for Buffer (ADR-0030). Split
 * out of `buffer.ts` to stay under the ADR-0024 line budget.
 *
 * Each writer returns the post-write offset, matching Node's semantics so
 * callers can chain `n = buf.writeUInt32BE(value, n)` style.
 *
 * No type-back import from `buffer.ts` — the class-level signatures are
 * declared there (via `declare`) and this file only manipulates
 * `BufferClass.prototype`.
 */

type BufferLikeCtor = new (...args: unknown[]) => Uint8Array;

function viewOf(u8: Uint8Array, offset: number, byteLen: number): DataView {
  return new DataView(u8.buffer, u8.byteOffset + offset, byteLen);
}

export function installIntMethods(BufferClass: BufferLikeCtor): void {
  const p = BufferClass.prototype as Record<string, unknown>;

  // ---- Integer readers ----
  p.readUInt8 = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 1).getUint8(0);
  };
  p.readUInt16BE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getUint16(0, false);
  };
  p.readUInt16LE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getUint16(0, true);
  };
  p.readUInt32BE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getUint32(0, false);
  };
  p.readUInt32LE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getUint32(0, true);
  };
  p.readInt8 = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 1).getInt8(0);
  };
  p.readInt16BE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getInt16(0, false);
  };
  p.readInt16LE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getInt16(0, true);
  };
  p.readInt32BE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getInt32(0, false);
  };
  p.readInt32LE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getInt32(0, true);
  };
  p.readBigUInt64BE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigUint64(0, false);
  };
  p.readBigUInt64LE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigUint64(0, true);
  };
  p.readBigInt64BE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigInt64(0, false);
  };
  p.readBigInt64LE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigInt64(0, true);
  };

  // ---- Integer writers (return the post-write offset, matching Node) ----
  p.writeUInt8 = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 1).setUint8(0, value);
    return offset + 1;
  };
  p.writeUInt16BE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setUint16(0, value, false);
    return offset + 2;
  };
  p.writeUInt16LE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setUint16(0, value, true);
    return offset + 2;
  };
  p.writeUInt32BE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setUint32(0, value, false);
    return offset + 4;
  };
  p.writeUInt32LE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setUint32(0, value, true);
    return offset + 4;
  };
  p.writeInt8 = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 1).setInt8(0, value);
    return offset + 1;
  };
  p.writeInt16BE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setInt16(0, value, false);
    return offset + 2;
  };
  p.writeInt16LE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setInt16(0, value, true);
    return offset + 2;
  };
  p.writeInt32BE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setInt32(0, value, false);
    return offset + 4;
  };
  p.writeInt32LE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setInt32(0, value, true);
    return offset + 4;
  };
  p.writeBigUInt64BE = function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigUint64(0, value, false);
    return offset + 8;
  };
  p.writeBigUInt64LE = function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigUint64(0, value, true);
    return offset + 8;
  };
  p.writeBigInt64BE = function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigInt64(0, value, false);
    return offset + 8;
  };
  p.writeBigInt64LE = function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigInt64(0, value, true);
    return offset + 8;
  };
}
