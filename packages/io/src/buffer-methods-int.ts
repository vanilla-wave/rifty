/**
 * Integer / BigInt readers and writers for Buffer, split out of
 * `buffer-methods.ts` so both files stay under the ADR-0024 line budget.
 *
 * Each writer returns the post-write offset, matching Node's semantics so
 * callers can chain `n = buf.writeUInt32BE(value, n)` style.
 */

function viewOf(u8: Uint8Array, offset: number, byteLen: number): DataView {
  return new DataView(u8.buffer, u8.byteOffset + offset, byteLen);
}

function defineMethod(u8: Uint8Array, name: string, value: (...args: never[]) => unknown): void {
  Object.defineProperty(u8, name, { configurable: true, writable: true, value });
}

export function tagInt(u8: Uint8Array): void {
  // ---- Integer readers ----
  defineMethod(u8, 'readUInt8', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 1).getUint8(0);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readUInt16BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getUint16(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readUInt16LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getUint16(0, true);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readUInt32BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getUint32(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readUInt32LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getUint32(0, true);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readInt8', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 1).getInt8(0);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readInt16BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getInt16(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readInt16LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getInt16(0, true);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readInt32BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getInt32(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readInt32LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getInt32(0, true);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readBigUInt64BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigUint64(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readBigUInt64LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigUint64(0, true);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readBigInt64BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigInt64(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readBigInt64LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigInt64(0, true);
  } as (...args: never[]) => unknown);

  // ---- Integer writers (return the post-write offset, matching Node) ----
  defineMethod(u8, 'writeUInt8', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 1).setUint8(0, value);
    return offset + 1;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeUInt16BE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setUint16(0, value, false);
    return offset + 2;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeUInt16LE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setUint16(0, value, true);
    return offset + 2;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeUInt32BE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setUint32(0, value, false);
    return offset + 4;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeUInt32LE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setUint32(0, value, true);
    return offset + 4;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeInt8', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 1).setInt8(0, value);
    return offset + 1;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeInt16BE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setInt16(0, value, false);
    return offset + 2;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeInt16LE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setInt16(0, value, true);
    return offset + 2;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeInt32BE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setInt32(0, value, false);
    return offset + 4;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeInt32LE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setInt32(0, value, true);
    return offset + 4;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeBigUInt64BE', function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigUint64(0, value, false);
    return offset + 8;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeBigUInt64LE', function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigUint64(0, value, true);
    return offset + 8;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeBigInt64BE', function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigInt64(0, value, false);
    return offset + 8;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeBigInt64LE', function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigInt64(0, value, true);
    return offset + 8;
  } as (...args: never[]) => unknown);
}
