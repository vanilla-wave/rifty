/**
 * Node-compatible `process` global (subset).
 *
 * `nextTick` is queued via `queueMicrotask`. To match Node's ordering (nextTick
 * always wins over `Promise.then`), we patch `Promise.prototype.then` in the
 * Worker so every then-callback drains pending nextTicks before firing.
 * Intrusive but contained: runs once at Worker boot.
 *
 * Limitation: code that captured the original `.then` before our patch (via
 * `bind`/closure on boot) bypasses the drain. Acceptable for M3; revisit if a
 * real package breaks.
 */
import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import { EventEmitter } from './events.ts';
import { syncMirror } from './fs-sync-mirror.ts';

const nextTickQueue: Array<{ fn: (...args: unknown[]) => void; args: unknown[] }> = [];
// Head cursor instead of shift()-per-item: O(n) drain, not O(n^2) (#27, perf-audit
// 2026-06-05). Reset to 0 only after a full drain (see drainNextTicks).
let drainHead = 0;
let promisePatched = false;

/**
 * Per-Worker cwd cell (ADR-0019), a snapshot of the active `ProcessRecord.cwd`.
 * Once ADR-0011's worker-as-process model lands, this becomes a
 * SharedArrayBuffer-mirrored slot tied to the kernel-side record; today the
 * Worker hosts a single process realm, so the cell suffices.
 * Default `/workspace` matches the runtime VFS bootstrap convention.
 */
let currentCwd = '/workspace';

function drainNextTicks(): void {
  // Re-read `.length` each iteration so items enqueued mid-drain (nextTick from
  // inside nextTick) are processed — same as the old shift()-until-empty loop.
  // Do NOT snapshot the array.
  while (drainHead < nextTickQueue.length) {
    const item = nextTickQueue[drainHead++];
    if (!item) continue;
    try {
      item.fn(...item.args);
    } catch (err) {
      (riftyProcess as unknown as EventEmitter).emit('uncaughtException', err);
    }
  }
  // Fully drained: clear the array + cursor so the next nextTick sees length
  // 0->1 and re-arms ensureDrainScheduled. Reached exactly once per drain.
  nextTickQueue.length = 0;
  drainHead = 0;
}

function ensureDrainScheduled(): void {
  if (nextTickQueue.length === 1) {
    queueMicrotask(drainNextTicks);
  }
}

function nextTick(fn: (...args: unknown[]) => void, ...args: unknown[]): void {
  nextTickQueue.push({ fn, args });
  ensureDrainScheduled();
}

function patchPromiseForNextTick(): void {
  if (promisePatched) return;
  promisePatched = true;
  const origThen = Promise.prototype.then;
  Promise.prototype.then = function (this: Promise<unknown>, onF, onR) {
    const wrapF =
      typeof onF === 'function'
        ? (value: unknown) => {
            drainNextTicks();
            return (onF as (v: unknown) => unknown)(value);
          }
        : onF;
    const wrapR =
      typeof onR === 'function'
        ? (reason: unknown) => {
            drainNextTicks();
            return (onR as (r: unknown) => unknown)(reason);
          }
        : onR;
    return origThen.call(this, wrapF as never, wrapR as never);
  } as typeof Promise.prototype.then;
}

class RiftyProcess extends EventEmitter {
  env: Record<string, string | undefined> = Object.create(null);
  argv: string[] = ['rifty', 'repl'];
  argv0 = 'rifty';
  execPath = '/usr/local/bin/rifty';
  platform = 'rifty';
  arch = 'wasm';
  // TODO(backlog: runtime-js/process-versions-node-honesty) — `version`/`versions.node` impersonate Node
  // while `platform`/`arch` follow ADR-0026's honesty principle. Tracked for
  // human review by M11 close; see docs/backlog/runtime-js/process-versions-node-honesty.md.
  version = 'v22.0.0';
  versions = { node: '22.0.0', v8: '12.0.0', rifty: '0.0.0' };
  pid = 1;
  ppid = 0;
  title = 'rifty';
  exitCode = 0;
  stdout = { write: (chunk: string) => console.log(chunk), isTTY: false, fd: 1 };
  stderr = { write: (chunk: string) => console.error(chunk), isTTY: false, fd: 2 };
  // No real stdin in browser; EventEmitter shell so `.on('end',…)`/`.off(…)` don't blow up.
  stdin = new EventEmitter() as EventEmitter & {
    isTTY: boolean;
    fd: number;
    setEncoding(encoding: string | null): void;
    resume(): void;
    pause(): void;
  };

  cwd(): string {
    return currentCwd;
  }
  chdir(dir: string): void {
    if (typeof dir !== 'string') {
      throw Object.assign(new TypeError('chdir: path must be a string'), {
        code: 'ERR_INVALID_ARG_TYPE',
      });
    }
    const target = normalizePath(isAbsolute(dir) ? dir : joinPath(currentCwd, dir));
    let stat: { isDirectory: boolean };
    try {
      stat = syncMirror().statSync(target);
    } catch (err) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, chdir '${dir}'`), {
        code: 'ENOENT',
        syscall: 'chdir',
        path: target,
        cause: err,
      });
    }
    if (!stat.isDirectory) {
      throw Object.assign(new Error(`ENOTDIR: not a directory, chdir '${dir}'`), {
        code: 'ENOTDIR',
        syscall: 'chdir',
        path: target,
      });
    }
    currentCwd = target;
  }
  hrtime(time?: [number, number]): [number, number] {
    const ms = performance.now();
    const secs = Math.floor(ms / 1000);
    const ns = Math.floor((ms - secs * 1000) * 1e6);
    if (!time) return [secs, ns];
    const [s0, n0] = time;
    return [secs - s0, ns - n0];
  }
  uptime(): number {
    return performance.now() / 1000;
  }
  nextTick = nextTick;
  exit(code = 0): void {
    this.exitCode = code;
    throw Object.assign(new Error(`process.exit(${code})`), {
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: code,
    });
  }
}

(RiftyProcess.prototype as unknown as { hrtime: { bigint: () => bigint } }).hrtime.bigint = () =>
  BigInt(Math.floor(performance.now() * 1e6));

export const riftyProcess = new RiftyProcess();
// TTY-ish properties + no-op resume/pause that don't belong on the class itself.
let stdinEncoding: string | null = null;
const pendingStdin: Array<string | Uint8Array> = [];
let stdinDecoder = new TextDecoder();

function flushPendingStdin(): void {
  if ((riftyProcess.stdin as EventEmitter).listenerCount('data') === 0) return;
  while (pendingStdin.length > 0) {
    const chunk = pendingStdin.shift();
    if (chunk === undefined) continue;
    (riftyProcess.stdin as EventEmitter).emit('data', chunk);
  }
}

(riftyProcess.stdin as EventEmitter).on('newListener', (event) => {
  if (event !== 'data') return;
  queueMicrotask(flushPendingStdin);
});

Object.assign(riftyProcess.stdin as object, {
  isTTY: false,
  fd: 0,
  setEncoding(encoding: string | null) {
    stdinEncoding = encoding;
    stdinDecoder = new TextDecoder();
  },
  resume() {},
  pause() {},
});

function normalizeStdinChunk(data: string | Uint8Array): string | Uint8Array | null {
  if (typeof data === 'string') return data;
  if (stdinEncoding && /^utf-?8$/iu.test(stdinEncoding)) {
    const text = stdinDecoder.decode(data, { stream: true });
    return text.length === 0 ? null : text;
  }
  return data;
}

function flushStdinDecoder(): void {
  if (!stdinEncoding || !/^utf-?8$/iu.test(stdinEncoding)) return;
  const tail = stdinDecoder.decode();
  if (tail.length === 0) return;
  if ((riftyProcess.stdin as EventEmitter).listenerCount('data') === 0) {
    pendingStdin.push(tail);
    return;
  }
  (riftyProcess.stdin as EventEmitter).emit('data', tail);
}

(riftyProcess.stdin as EventEmitter).on('end', flushStdinDecoder);

/** Host bridge: deliver terminal/process stdin into the REPL Worker process. */
export function writeProcessStdin(data: string | Uint8Array): void {
  const chunk = normalizeStdinChunk(data);
  if (chunk == null) return;
  if ((riftyProcess.stdin as EventEmitter).listenerCount('data') === 0) {
    pendingStdin.push(chunk);
    return;
  }
  (riftyProcess.stdin as EventEmitter).emit('data', chunk);
}

/** Install the global `process`, patch Promise for nextTick ordering. */
export function installProcessGlobals(): void {
  patchPromiseForNextTick();
  (globalThis as unknown as { process: RiftyProcess }).process = riftyProcess;
}

/**
 * Test/host helper: override the per-Worker cwd cell, bypassing `chdir`'s VFS
 * validation. Used by the parity-runner so `process.cwd()` sees a stable anchor
 * matching the Node child's `--cwd`. Not Node API — production code uses `chdir`.
 */
export function setProcessCwd(next: string): void {
  currentCwd = next;
}

/** Internal cwd accessor for sibling builtins (e.g. `fs.resolvePath`). */
export function getProcessCwd(): string {
  return currentCwd;
}

export default riftyProcess;
