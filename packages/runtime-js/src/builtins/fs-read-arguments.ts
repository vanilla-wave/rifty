export interface FdReadOptions {
  offset?: number;
  length?: number;
  position?: number | null;
}

export function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

export function checkedSliceBounds(buffer: Uint8Array, offset: number, length: number): void {
  assertNonNegativeInteger(offset, 'offset');
  assertNonNegativeInteger(length, 'length');
  if (offset + length > buffer.byteLength) {
    throw new RangeError('offset + length exceeds buffer length');
  }
}
