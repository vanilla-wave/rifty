/**
 * Node-compatible `process` global (subset).
 *
 * `nextTick` is queued via `queueMicrotask`. To match Node's ordering — where
 * `nextTick` always wins over `Promise.then` — we patch `Promise.prototype.then`
 * inside the Worker so that every then-callback drains pending nextTicks
 * before firing. This is intrusive but contained: it runs once at Worker boot
 * and is undone if/when the runtime decides to dispose.
 *
 * Limitations:
 *   - This patch lives on the Worker's `Promise.prototype`. User code that
 *     captures the original `.then` before our patch (via `bind`/closure on
 *     boot) will bypass the drain. Acceptable for M3; revisit if a real
 *     package breaks.
 */
import { isAbsolute, joinPath, normalizePath } from '@rifty/vfs';
import { EventEmitter } from './events.ts';
import { syncMirror } from './fs-sync-mirror.ts';

const nextTickQueue: Array<{ fn: (...args: unknown[]) => void; args: unknown[] }> = [];
let promisePatched = false;

/**
 * Per-Worker cwd cell (ADR-0019). Conceptually a snapshot of the active
 * `ProcessRecord.cwd` — once ADR-0011's worker-as-process model lands, this
 * cell becomes a SharedArrayBuffer-mirrored slot tied to the kernel-side
 * record. Today the Worker hosts a single process realm; the cell suffices.
 *
 * The default `/workspace` matches the runtime VFS bootstrap convention.
 */
let currentCwd = '/workspace';

function drainNextTicks(): void {
  while (nextTickQueue.length > 0) {
    const item = nextTickQueue.shift();
    if (!item) continue;
    try {
      item.fn(...item.args);
    } catch (err) {
      // Surface uncaught to the host
      (riftyProcess as unknown as EventEmitter).emit('uncaughtException', err);
    }
  }
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
  version = 'v22.0.0';
  versions = { node: '22.0.0', v8: '12.0.0', rifty: '0.0.0' };
  pid = 1;
  ppid = 0;
  title = 'rifty';
  exitCode = 0;
  stdout = { write: (chunk: string) => console.log(chunk), isTTY: false, fd: 1 };
  stderr = { write: (chunk: string) => console.error(chunk), isTTY: false, fd: 2 };
  // Browser has no real stdin — give it an EventEmitter shell so consumers
  // calling `.on('end', …)` / `.off(…)` don't blow up.
  stdin = new EventEmitter() as EventEmitter & {
    isTTY: boolean;
    fd: number;
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
// Augment the stdin EventEmitter shell with the fields/methods that don't
// belong on the class itself (TTY-ish properties + a no-op resume/pause).
Object.assign(riftyProcess.stdin as object, {
  isTTY: false,
  fd: 0,
  resume() {},
  pause() {},
});

/** Install the global `process`, patch Promise for nextTick ordering. */
export function installProcessGlobals(): void {
  patchPromiseForNextTick();
  (globalThis as unknown as { process: RiftyProcess }).process = riftyProcess;
}

/**
 * Test/host helper: override the per-Worker cwd cell without going through
 * `chdir`'s VFS validation. Used by the parity-runner so cases that exercise
 * `process.cwd()` see a stable anchor matching the Node child's `--cwd`.
 *
 * Not part of Node's API — production code should call `riftyProcess.chdir`.
 */
export function setProcessCwd(next: string): void {
  currentCwd = next;
}

/** Internal cwd accessor for sibling builtins (e.g. `fs.resolvePath`). */
export function getProcessCwd(): string {
  return currentCwd;
}

export default riftyProcess;
