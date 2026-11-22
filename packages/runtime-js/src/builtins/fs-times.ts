/**
 * `utimes` time arguments as Node 24.16.0 turns them into the file's times:
 * `toUnixTimestamp` in JS, then libuv's `uv__fs_to_timespec` (ADR-0029). The
 * VFS stores ms and never a non-finite time.
 */
import { syncMirror } from '@riftydev/vfs';

/** The largest time a 64-bit nanosecond clock holds (libuv/macOS saturate there). */
const MAX_TIME_MS = 9223372036854.775;

/**
 * Node's `toUnixTimestamp`: a Date is its time (NaN for an invalid one); a
 * numeric string coerces; a negative number is now; anything else
 * (NaN/Infinity/non-numeric string/null/…) is a loud ERR_INVALID_ARG_TYPE.
 */
function toMs(t: number | string | Date): number {
  if (t instanceof Date) return t.getTime();
  const n = typeof t === 'string' ? Number(t) : t;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    const e = new TypeError('The "time" argument must be of type number, string, or Date.');
    (e as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
    throw e;
  }
  return n < 0 ? Date.now() : Math.floor(n * 1000);
}

/** Validated before the path is touched, as Node validates arguments first. */
export function utimesArgs(atime: number | Date, mtime: number | Date): [number, number] {
  return [toMs(atime), toMs(mtime)];
}

/** libuv: a NaN time leaves that time as it was (UTIME_OMIT); a huge one saturates. */
export function setTimes(np: string, [atime, mtime]: [number, number]): void {
  const now = syncMirror().statSync(np);
  const stored = (ms: number, current: number | undefined): number =>
    Number.isNaN(ms) ? (current ?? 0) : Math.min(ms, MAX_TIME_MS);
  syncMirror().utimes(np, stored(atime, now.atime), stored(mtime, now.mtime));
}
