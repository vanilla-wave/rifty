/**
 * `utimes` time arguments as Node 24.16.0 turns them into the file's times:
 * `toUnixTimestamp` in JS, then libuv's `uv__fs_to_timespec` (ADR-0029). The
 * VFS stores ms and never a non-finite time.
 */
import { syncMirror } from '@riftydev/vfs';

/** The largest time a 64-bit nanosecond clock holds (libuv/macOS saturate there). */
const MAX_TIME_MS = 9223372036854.775;

/**
 * Node's `toUnixTimestamp`, then libuv: a numeric string is its number as is
 * (a negative one too; `''` is 0; an infinite one is now, libuv UTIME_NOW); a
 * finite number is seconds, a negative one now; a Date is its time (NaN for an
 * invalid one); anything else (NaN/Infinity numbers, other strings, null, …)
 * is a loud ERR_INVALID_ARG_TYPE.
 */
function toMs(t: number | string | Date): number {
  if (t instanceof Date) return t.getTime();
  // biome-ignore lint/suspicious/noDoubleEquals: Node's own test, `+time == time`.
  if (typeof t === 'string' && +t == (t as unknown as number)) {
    const n = +t;
    return Number.isFinite(n) ? Math.floor(n * 1000) : Date.now();
  }
  if (typeof t === 'number' && Number.isFinite(t)) return t < 0 ? Date.now() : Math.floor(t * 1000);
  const e = new TypeError('The "time" argument must be of type number, string, or Date.');
  (e as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
  throw e;
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
