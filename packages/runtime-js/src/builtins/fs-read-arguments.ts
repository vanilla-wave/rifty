import { invalidArgType, outOfRange } from '../internal/node-received.ts';

export type ReadPosition = number | bigint | null;

export interface FdReadOptions {
  offset?: number;
  length?: number;
  position?: ReadPosition;
}

/**
 * Node's `validatePosition` for a read of `length` bytes: `null`/`-1`/`-1n` =
 * the fd's position (returned as `null`). A bigint past MAX_SAFE_INTEGER is past
 * any EOF and maps to MAX_SAFE_INTEGER (ADR-0576).
 */
export function readPositionOf(raw: ReadPosition | undefined, length: number): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'bigint') {
    const max = 2n ** 63n - 1n - BigInt(length);
    if (!(raw >= -1n && raw <= max)) throw outOfRange('position', `>= -1 && <= ${max}`, raw);
    if (raw === -1n) return null;
    return raw > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(raw);
  }
  if (typeof raw !== 'number') {
    throw invalidArgType('"position" argument', 'of type bigint or integer', raw);
  }
  if (!Number.isInteger(raw)) throw outOfRange('position', 'an integer', raw);
  if (raw < -1 || raw > Number.MAX_SAFE_INTEGER) {
    throw outOfRange('position', `>= -1 && <= ${Number.MAX_SAFE_INTEGER}`, raw);
  }
  return raw === -1 ? null : raw;
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
