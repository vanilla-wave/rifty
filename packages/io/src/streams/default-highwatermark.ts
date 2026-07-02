/**
 * Module-level default high-water marks for `Readable`/`Writable`, the single
 * source of truth behind `stream.getDefaultHighWaterMark` /
 * `setDefaultHighWaterMark` (Node v19.9).
 *
 * Lives in its own leaf module (not `index.ts`) so the stream ctors can read it
 * without an import cycle (`index.ts` → `readable.ts`/`writable.ts` →
 * `index.ts`). `index.ts` re-exports the accessors as the public API.
 *
 * Defaults match REAL Node (verified vs the parity runner's Node, not the
 * stale v19 literal): 65536 bytes / 16 objectMode entries. A ctor that passes
 * no explicit `highWaterMark` reads the CURRENT value via
 * {@link getDefaultHighWaterMark}; an explicit option still wins.
 */

// Node bumped the byte default from 16384 → 65536 (v22+); we follow real Node.
let byteDefault = 65536;
let objectDefault = 16;

/**
 * `stream.getDefaultHighWaterMark(objectMode)` — current default HWM in bytes
 * (`objectMode` false) or entries (`objectMode` true).
 */
export function getDefaultHighWaterMark(objectMode: boolean): number {
  return objectMode ? objectDefault : byteDefault;
}

/**
 * `stream.setDefaultHighWaterMark(objectMode, value)` — change the default read
 * by subsequently-constructed `Readable`/`Writable` that pass no explicit
 * `highWaterMark`. Validates exactly like Node: a non-number throws
 * `ERR_INVALID_ARG_TYPE` (TypeError); a negative or non-integer number throws
 * `ERR_OUT_OF_RANGE` (RangeError); `0` is valid. A wrong value fails loud, never
 * silently coerces.
 */
export function setDefaultHighWaterMark(objectMode: boolean, value: number): void {
  if (typeof value !== 'number') {
    const err = new TypeError(
      `The "value" argument must be of type number. Received ${typeof value}`,
    ) as TypeError & { code?: string };
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }
  if (!Number.isInteger(value) || value < 0) {
    const err = new RangeError(
      `The value of "value" is out of range. It must be a non-negative integer. Received ${value}`,
    ) as RangeError & { code?: string };
    err.code = 'ERR_OUT_OF_RANGE';
    throw err;
  }
  if (objectMode) objectDefault = value;
  else byteDefault = value;
}
