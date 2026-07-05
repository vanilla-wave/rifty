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
import { EventEmitter } from './events.ts';
import { resolvePath } from './fs-path.ts';
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
    this.emit('close');
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
  optionsOrListener?: WatchOptions | WatchListener,
  listener?: WatchListener,
): FSWatcher {
  const opts: WatchOptions =
    typeof optionsOrListener === 'function' ? {} : (optionsOrListener ?? {});
  const cb = typeof optionsOrListener === 'function' ? optionsOrListener : listener;

  if (opts.encoding !== undefined && opts.encoding !== 'utf8' && opts.encoding !== 'utf-8') {
    // 'buffer' filenames (and exotic encodings) are unmodelled — loud gap,
    // never a silently-still-utf8 string.
    throw new NotImplementedError(`fs.watch.encoding:'${opts.encoding}'`);
  }

  const interval = opts.interval ?? 250;
  const target = resolvePath(path);
  const watcher = new FSWatcher();

  if (cb) watcher.on('change', cb as (...args: unknown[]) => void);

  // Determine mode (file vs directory) at start.
  let isDir = false;
  try {
    const s = syncMirror().statSync(target);
    isDir = s.isDirectory;
  } catch {
    // target doesn't exist — fine, we'll just emit rename when it appears.
  }

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
        // modifications
        for (const [name, snap] of next) {
          const old = prev.get(name);
          if (old && (old.mtime !== snap.mtime || old.size !== snap.size)) {
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
        if (prev.exists !== next.exists) {
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
  /** `false` unrefs the poll timer (Node parity) — an ignored field would lie. */
  persistent?: boolean;
}

export interface StatsLike {
  size: number;
  mtime: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

type WatchFileListener = (curr: StatsLike, prev: StatsLike) => void;

interface PollEntry {
  timer: ReturnType<typeof setInterval>;
  listeners: WatchFileListener[];
  last: StatsLike;
}

function toStats(snap: FileSnapshot): StatsLike {
  return {
    size: snap.size,
    mtime: snap.mtime,
    isFile() {
      return snap.isFile;
    },
    isDirectory() {
      return snap.isDirectory;
    },
  };
}

const pollers = new Map<string, PollEntry>();

export function watchFile(
  path: string,
  optionsOrListener: WatchFileOptions | WatchFileListener,
  listener?: WatchFileListener,
): void {
  const opts: WatchFileOptions = typeof optionsOrListener === 'function' ? {} : optionsOrListener;
  const cb = typeof optionsOrListener === 'function' ? optionsOrListener : listener;
  if (!cb) return;
  const target = resolvePath(path);
  const interval = opts.interval ?? 5007;
  const existing = pollers.get(target);
  if (existing) {
    existing.listeners.push(cb);
    return;
  }
  const initial = toStats(snapshotFile(target));
  const entry: PollEntry = {
    timer: setInterval(() => {
      const next = toStats(snapshotFile(target));
      if (next.size !== entry.last.size || next.mtime !== entry.last.mtime) {
        const prev = entry.last;
        entry.last = next;
        for (const fn of entry.listeners.slice()) fn(next, prev);
      }
    }, interval),
    listeners: [cb],
    last: initial,
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
