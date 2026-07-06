/**
 * Polling-based `fs.watch` and `fs.watchFile`.
 *
 * Browsers have no native filesystem event source for our in-memory / OPFS
 * mirror, so we sample the sync-mirror state on a timer and synthesise `change`
 * / `rename` events that match Node's semantics. Tracking lives entirely in the
 * watcher — closing the watcher detaches the interval.
 *
 * Default poll interval (Node uses 5007 ms for `watchFile`) is overrideable
 * via options so dev-server use cases can choose tighter loops.
 */

import { NotImplementedError } from '@riftydev/io';
import { basename, joinPath } from '@riftydev/vfs';
import { Buffer } from './buffer.ts';
import { EventEmitter } from './events.ts';
import { toNodeFsError } from './fs-errors.ts';
import { resolvePath } from './fs-path.ts';
import { Stats } from './fs-stats.ts';
import { syncMirror } from './fs-sync-mirror.ts';

export interface WatchOptions {
  /** poll interval in ms (default 250) */
  interval?: number;
  /**
   * Watch the full subtree; events carry the path RELATIVE to the watch root
   * (`src/components/Button.tsx`). Default false — Node parity.
   */
  recursive?: boolean;
  /** `false` unrefs the poll timer so an active watcher doesn't hold the realm alive. */
  persistent?: boolean;
  /** Only 'utf8' (default) — 'buffer' filenames are a loud gap. */
  encoding?: string;
  /** abort signal */
  signal?: AbortSignal;
}

type WatchEvent = 'rename' | 'change';
type WatchListener = (event: WatchEvent, filename: string | null) => void;

function receivedType(value: unknown): string {
  return value === null ? 'null' : typeof value;
}

function invalidOptions(value: unknown): TypeError {
  return Object.assign(
    new TypeError(
      `The "options" argument must be of type string or object. Received ${receivedType(value)}`,
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

function invalidListener(value: unknown): TypeError {
  return Object.assign(
    new TypeError(
      `The "listener" argument must be of type function. Received ${receivedType(value)}`,
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

function invalidInterval(value: unknown): TypeError {
  return Object.assign(
    new TypeError(
      `The "interval" argument must be of type number. Received ${receivedType(value)}`,
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

function intervalOutOfRange(value: number, must: string): RangeError {
  return Object.assign(
    new RangeError(
      `The value of "interval" is out of range. It must be ${must}. Received ${value}`,
    ),
    { code: 'ERR_OUT_OF_RANGE' },
  );
}

/**
 * Node's uint32 interval rule (probed v24): non-number → ERR_INVALID_ARG_TYPE;
 * NaN/fractional/Infinity → ERR_OUT_OF_RANGE "must be an integer"; negative or
 * > uint32-max → the range message; 0 is VALID. The old typeof-only check let
 * setInterval silently coerce NaN/-1/Infinity. Parity: fs/watchfile-overloads.
 */
function assertInterval(value: unknown): asserts value is number | undefined {
  if (value === undefined) return;
  if (typeof value !== 'number') throw invalidInterval(value);
  if (!Number.isInteger(value)) throw intervalOutOfRange(value, 'an integer');
  if (value < 0 || value > 4294967295) {
    throw intervalOutOfRange(value, '>= 0 && <= 4294967295');
  }
}

function invalidEncoding(value: string): TypeError {
  return Object.assign(
    new TypeError(`The argument 'encoding' is invalid encoding. Received '${value}'`),
    { code: 'ERR_INVALID_ARG_VALUE' },
  );
}

export class FSWatcher extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  /** @internal — used by fs.watch */
  _start(tick: () => void, interval: number, signal?: AbortSignal): void {
    this.timer = setInterval(tick, interval);
    if (signal) {
      if (signal.aborted) this.close();
      else signal.addEventListener('abort', () => this.close(), { once: true });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    queueMicrotask(() => this.emit('close'));
  }

  // Delegate to the poll timer's handle: after installTimerGlobals the poll
  // `setInterval` returns a keepalive-counted handle whose ref()/unref() opt the
  // realm in/out of staying alive for the watcher — Node parity, not a no-op.
  ref(): this {
    (this.timer as { ref?: () => unknown } | null)?.ref?.();
    return this;
  }
  unref(): this {
    (this.timer as { unref?: () => unknown } | null)?.unref?.();
    return this;
  }
}

interface FileSnapshot {
  exists: boolean;
  size: number;
  mtime: number;
  isFile: boolean;
  isDirectory: boolean;
}

function snapshotFile(p: string): FileSnapshot {
  try {
    const s = syncMirror().statSync(p);
    return {
      exists: true,
      size: s.size ?? 0,
      mtime: s.mtime ?? 0,
      isFile: s.isFile,
      isDirectory: s.isDirectory,
    };
  } catch {
    return { exists: false, size: 0, mtime: 0, isFile: false, isDirectory: false };
  }
}

/**
 * Full-snapshot comparison (review 2026-07-05 handoff #4): size/mtime alone
 * miss existence flips and file↔dir swaps — OPFS entries can legitimately
 * carry size 0 / mtime 0, making those transitions otherwise invisible.
 */
function snapshotChanged(a: FileSnapshot, b: FileSnapshot): boolean {
  return (
    a.exists !== b.exists ||
    a.isFile !== b.isFile ||
    a.isDirectory !== b.isDirectory ||
    a.size !== b.size ||
    a.mtime !== b.mtime
  );
}

/** Existence or kind change — Node's `fs.watch` reports these as 'rename'. */
function kindChanged(a: FileSnapshot, b: FileSnapshot): boolean {
  return a.exists !== b.exists || a.isFile !== b.isFile || a.isDirectory !== b.isDirectory;
}

/**
 * Snapshot of a directory's children keyed by the path RELATIVE to the watch
 * root — one name deep without `recursive`, the whole subtree with it (the
 * relative key is exactly the `filename` Node hands recursive listeners).
 */
function snapshotDir(root: string, recursive: boolean): Map<string, FileSnapshot> {
  const out = new Map<string, FileSnapshot>();
  const walk = (abs: string, rel: string): void => {
    let entries: readonly { name: string; isDirectory: boolean }[];
    try {
      entries = syncMirror().readdirSync(abs);
    } catch {
      return;
    }
    for (const { name, isDirectory } of entries) {
      const childAbs = joinPath(abs, name);
      const childRel = rel === '' ? name : `${rel}/${name}`;
      out.set(childRel, snapshotFile(childAbs));
      if (recursive && isDirectory) walk(childAbs, childRel);
    }
  };
  walk(root, '');
  return out;
}

export function watch(
  path: string,
  optionsOrListener?: WatchOptions | WatchListener | string | null,
  listener?: WatchListener,
): FSWatcher {
  let opts: WatchOptions;
  let cb: WatchListener | undefined;
  if (typeof optionsOrListener === 'function') {
    opts = {};
    cb = optionsOrListener;
  } else if (typeof optionsOrListener === 'string') {
    opts = { encoding: optionsOrListener };
    cb = listener;
  } else {
    // `null` means default options in Node (probed v24), same as undefined.
    if (optionsOrListener !== undefined && optionsOrListener !== null) {
      if (typeof optionsOrListener !== 'object') throw invalidOptions(optionsOrListener);
    }
    opts = optionsOrListener ?? {};
    cb = listener;
  }
  if (cb !== undefined && typeof cb !== 'function') throw invalidListener(cb);

  // Node's observable order (probed v24, observable-order axis): an INVALID
  // encoding value fails in option parsing — before target existence…
  const enc = opts.encoding;
  if (enc !== undefined && enc !== 'buffer' && !Buffer.isEncoding(enc)) {
    throw invalidEncoding(enc);
  }

  const target = resolvePath(path);
  const watcher = new FSWatcher();

  if (cb) watcher.on('change', cb as (...args: unknown[]) => void);

  // …then a missing target is ENOENT/watch (valid-encoding requests included)…
  let isDir = false;
  try {
    const s = syncMirror().statSync(target);
    isDir = s.isDirectory;
  } catch (err) {
    throw toNodeFsError(err, 'watch', path);
  }

  // …and only where Node itself would SUCCEED does the rifty gap fire:
  // 'buffer' filenames (and other valid-but-unmodelled encodings) are loud,
  // never a silently-still-utf8 string. Gap throws replace Node's success
  // path, not its error path.
  if (enc !== undefined && enc !== 'utf8' && enc !== 'utf-8') {
    throw new NotImplementedError(`fs.watch.encoding:'${enc}'`);
  }

  // rifty extension (poll interval) — validated last, after every Node-visible check.
  const interval = opts.interval ?? 250;
  assertInterval(interval);

  if (isDir) {
    const recursive = opts.recursive ?? false;
    let prev = snapshotDir(target, recursive);
    watcher._start(
      () => {
        const next = snapshotDir(target, recursive);
        // additions / deletions
        for (const name of next.keys()) {
          if (!prev.has(name)) {
            watcher.emit('change', 'rename', name);
          }
        }
        for (const name of prev.keys()) {
          if (!next.has(name)) {
            watcher.emit('change', 'rename', name);
          }
        }
        // modifications; a file↔dir swap under the same name is a 'rename'
        for (const [name, snap] of next) {
          const old = prev.get(name);
          if (!old) continue;
          if (kindChanged(old, snap)) {
            watcher.emit('change', 'rename', name);
          } else if (old.mtime !== snap.mtime || old.size !== snap.size) {
            watcher.emit('change', 'change', name);
          }
        }
        prev = next;
      },
      interval,
      opts.signal,
    );
  } else {
    let prev = snapshotFile(target);
    const filename = basename(target);
    watcher._start(
      () => {
        const next = snapshotFile(target);
        if (kindChanged(prev, next)) {
          watcher.emit('change', 'rename', filename);
        } else if (next.exists && (prev.mtime !== next.mtime || prev.size !== next.size)) {
          watcher.emit('change', 'change', filename);
        }
        prev = next;
      },
      interval,
      opts.signal,
    );
  }

  // Node parity: persistent:false watchers don't keep the realm alive. The
  // poll timer's keepalive handle makes unref() real, not a stub (see FSWatcher).
  if (opts.persistent === false) watcher.unref();

  return watcher;
}

// ─── fs.watchFile / fs.unwatchFile ────────────────────────────────────────

export interface WatchFileOptions {
  interval?: number;
  /** BigIntStats are not implemented yet; loud gap beats number-shaped lies. */
  bigint?: boolean;
  /** `false` unrefs the poll timer (Node parity) — an ignored field would lie. */
  persistent?: boolean;
}

type WatchFileListener = (curr: Stats, prev: Stats) => void;

function invalidWatchFileListener(value: unknown): TypeError {
  return Object.assign(
    new TypeError(
      `The "listener" argument must be of type function. Received ${receivedType(value)}`,
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

function assertWatchFileOptions(opts: WatchFileOptions): void {
  assertInterval(opts.interval);
  // TODO(backlog: runtime-js/fs-watchfile-bigint-stats)
  if (opts.bigint === true) throw new NotImplementedError('fs.watchFile.bigint');
}

interface PollEntry {
  timer: ReturnType<typeof setInterval>;
  listeners: WatchFileListener[];
  last: FileSnapshot;
  /** Node ENOENT contract: a missing-at-start target gets ONE zeroed listener call. */
  notifyMissingOnce: boolean;
}

/**
 * Node hands watchFile listeners real `fs.Stats` (missing target = all-zero
 * Stats, `mtime` a Date at epoch 0 — probed v24). Reuse THE Stats class every
 * stat surface returns — the previous bespoke `StatsLike` twin drifted
 * (number `mtime`, no `mtimeMs`/`isSymbolicLink`; review 2026-07-06).
 */
function toStats(snap: FileSnapshot): Stats {
  return new Stats({
    isFile: snap.isFile,
    isDirectory: snap.isDirectory,
    size: snap.size,
    mtime: snap.mtime,
  });
}

const pollers = new Map<string, PollEntry>();

export function watchFile(
  path: string,
  optionsOrListener?: WatchFileOptions | WatchFileListener | null,
  listener?: WatchFileListener,
): void {
  let opts: WatchFileOptions;
  let cb: WatchFileListener;
  if (typeof optionsOrListener === 'function') {
    opts = {};
    cb = optionsOrListener;
  } else {
    if (!optionsOrListener || typeof optionsOrListener !== 'object') {
      throw invalidWatchFileListener(optionsOrListener);
    }
    if (typeof listener !== 'function') throw invalidWatchFileListener(listener);
    opts = optionsOrListener;
    cb = listener;
  }
  assertWatchFileOptions(opts);
  const target = resolvePath(path);
  const interval = opts.interval ?? 5007;
  const existing = pollers.get(target);
  if (existing) {
    existing.listeners.push(cb);
    return;
  }
  const initial = snapshotFile(target);
  const entry: PollEntry = {
    timer: setInterval(() => {
      const next = snapshotFile(target);
      if (entry.notifyMissingOnce && !next.exists) {
        // Missing at watchFile() time and still missing: Node invokes the
        // listener ONCE with all fields zeroed (curr === prev === zeros).
        entry.notifyMissingOnce = false;
        for (const fn of entry.listeners.slice()) fn(toStats(next), toStats(entry.last));
        entry.last = next;
        return;
      }
      entry.notifyMissingOnce = false;
      if (snapshotChanged(entry.last, next)) {
        const prev = entry.last;
        entry.last = next;
        for (const fn of entry.listeners.slice()) fn(toStats(next), toStats(prev));
      }
    }, interval),
    listeners: [cb],
    last: initial,
    notifyMissingOnce: !initial.exists,
  };
  if (opts.persistent === false) {
    (entry.timer as { unref?: () => unknown }).unref?.();
  }
  pollers.set(target, entry);
}

export function unwatchFile(path: string, listener?: WatchFileListener): void {
  const target = resolvePath(path);
  const entry = pollers.get(target);
  if (!entry) return;
  if (listener) {
    entry.listeners = entry.listeners.filter((l) => l !== listener);
    if (entry.listeners.length > 0) return;
  }
  clearInterval(entry.timer);
  pollers.delete(target);
}
