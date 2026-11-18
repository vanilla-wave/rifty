import { randomBytes } from 'node:crypto';
/**
 * Child process (ADR-0557 §2–3): one isolated-vm isolate holding the rifty
 * guest bundle, one run. Spawned with `--no-node-snapshot` and an empty env by
 * `runCode`; killed by the parent after its last message. Only copying
 * `ivm.Callback`s cross into the isolate.
 */
import { readFileSync } from 'node:fs';
import ivm from 'isolated-vm';
import type { ChildMessage, RunRequest } from '../protocol.ts';

const send = (message: ChildMessage): void => {
  process.send?.(message);
};
// The parent owns this child's lifetime; an orphan never keeps running.
process.on('disconnect', () => process.kill(process.pid, 'SIGKILL'));

let pending: [1 | 2, Uint8Array][] = [];
let flushScheduled = false;
function flush(): void {
  flushScheduled = false;
  if (pending.length === 0) return;
  send({ type: 'output', chunks: pending });
  pending = [];
}

let reported = false;
function report(message: ChildMessage): void {
  if (reported) return;
  reported = true;
  flush();
  send(message);
}

async function run(request: RunRequest): Promise<void> {
  let kept = 0;
  let truncated = false;
  const reportMemory = (): void => report({ type: 'memory', truncated });
  const sampler = setInterval(() => {
    if (process.memoryUsage.rss() > request.maxRssBytes) reportMemory();
  }, 25);

  const isolate = new ivm.Isolate({
    memoryLimit: request.memoryLimitMb,
    onCatastrophicError: reportMemory,
    // A sync throw rejects the guest's import(). isolated-vm runs this after the
    // guest task that called import(); the guest's drain waits on `settle` for it.
    importModuleDynamically: () => {
      importRequested = true;
      // isolated-vm flushes unhandled rejections only in a task epilogue; an empty
      // task right after this request flushes before a later guest task can attach
      // a handler (Node reports at the microtask checkpoint).
      process.nextTick(() => context?.evalIgnored('0'));
      const message =
        'Not implemented: isolate-host.dynamic-import (import() is not available in the rifty isolate host; use require(), ADR-0557)';
      // No child frames: the stack crosses into the guest and must not reveal host paths.
      throw Object.assign(new Error(message), { stack: `Error: ${message}` });
    },
    onUnhandledRejection: (reason: unknown) => {
      rejection?.applyIgnored(undefined, [reason], { arguments: { copy: true } });
    },
  });
  let rejection: ivm.Reference<(reason: unknown) => void> | undefined;
  let importRequested = false;
  let context: ivm.Context | undefined;
  const failed = (error: unknown): void => {
    if (isolate.isDisposed) {
      reportMemory();
      return;
    }
    report({
      type: 'error',
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  };
  try {
    context = await isolate.createContext();
    const jail = context.global;
    const timers = new Map<number, NodeJS.Timeout>();
    let fire: ivm.Reference<(id: number) => void> | undefined;
    // Timers armed while the bundle loads can expire before `fire` is bound.
    const early: number[] = [];
    const origin = performance.timeOrigin;
    const host = {
      write: (fd: 1 | 2, bytes: Uint8Array) => {
        if (kept >= request.maxOutputBytes) {
          if (bytes.byteLength > 0) truncated = true;
          return;
        }
        const room = request.maxOutputBytes - kept;
        const chunk = bytes.byteLength > room ? bytes.subarray(0, room) : bytes;
        if (chunk.byteLength < bytes.byteLength) truncated = true;
        kept += chunk.byteLength;
        pending.push([fd === 2 ? 2 : 1, chunk]);
        if (!flushScheduled) {
          flushScheduled = true;
          setImmediate(flush);
        }
      },
      timerStart: (id: number, ms: number, repeat: boolean) => {
        const tick = () => {
          if (!repeat) timers.delete(id);
          if (fire === undefined) early.push(id);
          else fire.applyIgnored(undefined, [id]);
        };
        timers.set(id, repeat ? setInterval(tick, ms) : setTimeout(tick, ms));
      },
      timerClear: (id: number) => {
        clearTimeout(timers.get(id));
        timers.delete(id);
      },
      now: () => performance.now(),
      random: (n: number) => new Uint8Array(randomBytes(Math.max(0, Math.min(65536, n | 0)))),
      done: (exitCode: number) => {
        report({ type: 'exit', exitCode, truncated });
      },
      /** Whether an import() was requested since the last call (the guest's drain asks). */
      takeImportRequested: () => {
        const requested = importRequested;
        importRequested = false;
        return requested;
      },
    };
    for (const [name, fn] of Object.entries(host)) {
      await jail.set(`__riftyHost_${name}`, new ivm.Callback(fn));
    }

    await context.eval(`Object.defineProperty(globalThis, '__riftyIsolateHost', {
      value: Object.freeze({
        write: __riftyHost_write, timerStart: __riftyHost_timerStart, timerClear: __riftyHost_timerClear,
        now: __riftyHost_now, random: __riftyHost_random, done: __riftyHost_done,
        takeImportRequested: __riftyHost_takeImportRequested, timeOrigin: ${origin},
      }),
      configurable: true,
    });
    for (const k of Object.keys(globalThis)) if (k.startsWith('__riftyHost_')) delete globalThis[k];`);
    const guestSource = readFileSync(new URL('./guest.js', import.meta.url), 'utf8');
    const script = await isolate.compileScript(guestSource, { filename: 'rifty-isolate-guest.js' });
    await script.run(context);
    const guest = await jail.get('__riftyGuest', { reference: true });
    fire = await guest.get('fire', { reference: true });
    for (const id of early.splice(0)) fire.applyIgnored(undefined, [id]);
    rejection = await guest.get('rejection', { reference: true });
    const start = await guest.get('run', { reference: true });
    await jail.delete('__riftyGuest');
    await start.apply(undefined, [request.code], {
      arguments: { copy: true },
      result: { promise: true },
    });
  } catch (error) {
    failed(error);
  } finally {
    if (reported) clearInterval(sampler);
  }
}

process.once('message', (message: RunRequest) => {
  void run(message);
});
send({ type: 'ready' });
