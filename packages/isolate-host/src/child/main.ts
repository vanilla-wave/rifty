/**
 * Worker process (pool ADR, ADR-0557 §6): a long-lived embedder of many rifty
 * guests, one fresh isolated-vm isolate per call (`@riftydev/isolate-guest`,
 * ADR-0558). Spawned with `--no-node-snapshot` and an empty env by the
 * consumer's pool; requests arrive as JSON lines on stdin, results leave as
 * call-addressed frames on fd 3. Only copying `ivm.Callback`s over the
 * export's validated host functions cross into an isolate.
 *
 * Kills itself (SIGKILL) when its stdin ends (consumer gone), when an isolate
 * reports a catastrophic error (V8: unrecoverable), or when its RSS passes the
 * ceiling of its live calls; the consumer reruns what was in flight.
 */
import { readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import {
  IMPORT_GAP,
  UNCOPYABLE_REJECTION,
  createHostBridge,
  exitStatus,
} from '@riftydev/isolate-guest';
import ivm from 'isolated-vm';
import {
  FRAME_CHANNEL_FD,
  KIND,
  MAX_ERROR_TEXT,
  RECYCLE_RSS_BYTES,
  type RunRequest,
  STUCK_GRACE_MS,
  type WorkerRequest,
  frame,
  rssCeilingBytes,
} from '../protocol.ts';
import { OutputBudget, importGapError } from './bridge.ts';

const channel = new Socket({ fd: FRAME_CHANNEL_FD, readable: false, writable: true });
const die = (): never => process.kill(process.pid, 'SIGKILL') as never;
channel.on('error', die);
const send = (kind: number, call: number, payload: Uint8Array): void => {
  channel.write(frame(kind, call, payload));
};
/** Flush what is queued, then die (a fallback in case the channel never drains). */
const dieAfterFlush = (): void => {
  channel.write(new Uint8Array(0), die);
  setTimeout(die, 200).unref();
};

const guestSource = readFileSync(new URL('./guest.js', import.meta.url), 'utf8');
/** V8 code cache of the guest bundle, produced by this worker's first compile. */
let cachedData: ivm.ExternalCopy<ArrayBuffer> | undefined;
/** The compile producing the cache: concurrent first calls wait for it instead of compiling cold too. */
let producing: Promise<unknown> | undefined;

interface Live {
  readonly limitMb: number;
  /** The only call of a solo worker (a rerun): its worker's exhaustion is its own. */
  readonly solo: boolean;
  readonly isolate: ivm.Isolate;
  /** This worker disposed the isolate (cancel, end of call); anything else was its heap limit. */
  disposedHere: boolean;
  reported: boolean;
  cancelled: boolean;
  unwound: boolean;
  report(kind: number, payload: Uint8Array): void;
}
const live = new Map<number, Live>();
/** Largest sum of live calls' `memoryLimitMb` since the worker was last idle. */
let busyAllowanceMb = 0;
let retiring = false;
const retire = (): void => {
  if (retiring) return;
  retiring = true;
  send(KIND.retire, 0, new Uint8Array(0));
};

setInterval(() => {
  // Its own heap limit disposed this isolate: a certain culprit, even while a
  // builtin keeps its thread (step 0: the run may not settle for seconds).
  for (const call of live.values()) {
    if (call.isolate.isDisposed && !call.disposedHere) call.report(KIND.memory, new Uint8Array(0));
  }
  const rss = process.memoryUsage.rss();
  // Idle above the watermark: retire, never die under a call the consumer may be placing.
  if (live.size === 0) {
    busyAllowanceMb = 0;
    if (rss > RECYCLE_RSS_BYTES) retire();
    return;
  }
  // The allowance never shrinks while the worker is busy: memory a finished call
  // left resident is not a later call's (ADR-0563 §5).
  let liveMb = 0;
  for (const call of live.values()) liveMb += call.limitMb;
  busyAllowanceMb = Math.max(busyAllowanceMb, liveMb);
  if (rss > rssCeilingBytes([busyAllowanceMb])) {
    // A solo worker's only call: the crossing is its own (ADR-0563 §6). Anywhere
    // else nobody is blamed: the consumer reruns each call alone.
    for (const call of live.values()) if (call.solo) call.report(KIND.memory, new Uint8Array(0));
    dieAfterFlush();
  }
}, 25);

async function run(request: RunRequest): Promise<void> {
  const id = request.call;
  // Before the guest's entry exists, a failure is this worker's, not the guest's.
  let started = false;
  const output = new OutputBudget(request.maxOutputBytes);
  let flushScheduled = false;
  let sentTruncated = false;
  let closeBridge = (): void => {};
  const flush = (): void => {
    flushScheduled = false;
    if (state.reported) return;
    const chunks = output.drain();
    // The consumer accepts only new bytes or the one truncation flip (protocol state).
    if (chunks.length === 0 && (!output.truncated || sentTruncated)) return;
    const t = output.truncated ? 1 : 0;
    // A truncation flip with nothing new to send is its own frame.
    if (chunks.length === 0) send(KIND.output, id, Uint8Array.of(1, t));
    for (const [fd, bytes] of chunks) {
      const payload = new Uint8Array(2 + bytes.byteLength);
      payload[0] = fd;
      payload[1] = t;
      payload.set(bytes, 2);
      send(KIND.output, id, payload);
    }
    sentTruncated = output.truncated;
  };

  let rejection: ivm.Reference<(reason: unknown) => void> | undefined;
  const isolate = new ivm.Isolate({
    memoryLimit: request.memoryLimitMb,
    // V8 cannot recover this process: report the culprit, then the consumer reruns the rest.
    onCatastrophicError: () => {
      state.report(KIND.memory, new Uint8Array(0));
      dieAfterFlush();
    },
    // `import()` is a gap this host cannot serve, and a rejection the guest may
    // never observe (it can drain first, or swallow it): the run ends here,
    // loudly; the guest's promise rejects too, with no worker frame in its stack.
    importModuleDynamically: () => {
      output.write(2, new TextEncoder().encode(`Error: ${IMPORT_GAP}\n`));
      state.report(KIND.exit, Uint8Array.of(1));
      throw importGapError();
    },
    onUnhandledRejection: (reason: unknown) => {
      try {
        rejection?.applyIgnored(undefined, [reason], { arguments: { copy: true } });
      } catch {
        try {
          rejection?.applyIgnored(undefined, [UNCOPYABLE_REJECTION]);
        } catch {
          // The isolate is gone: its call already has its terminal frame.
        }
      }
    },
  });
  /** The isolate is gone for good: disposed and its run unwound. */
  const forget = (): void => {
    state.unwound = true;
    if (!live.has(id)) return;
    if (state.reported) live.delete(id);
    if (live.size === 0 && process.memoryUsage.rss() > RECYCLE_RSS_BYTES) retire();
  };
  const state: Live = {
    limitMb: request.memoryLimitMb,
    solo: request.solo === true,
    isolate,
    disposedHere: false,
    reported: false,
    cancelled: false,
    unwound: false,
    /** The call's one terminal frame; the isolate ends with it. */
    report(kind, payload) {
      if (state.reported) return;
      flush();
      state.reported = true;
      closeBridge();
      // Retire first (call 0, order-free): the consumer stops placing calls here
      // before this slot frees, however the bytes are split into chunks.
      const idle = [...live.values()].every((c) => c === state || c.reported);
      if (state.unwound && idle && process.memoryUsage.rss() > RECYCLE_RSS_BYTES) retire();
      send(kind, id, payload);
      if (!isolate.isDisposed) {
        state.disposedHere = true;
        // Not inside an isolate callback (`importModuleDynamically` reports from one).
        setImmediate(() => isolate.isDisposed || isolate.dispose());
      }
      if (state.unwound) live.delete(id);
      else {
        // Still running after dispose (a builtin that ignores termination): this
        // worker takes no new call (I4).
        setTimeout(() => state.unwound || retire(), STUCK_GRACE_MS).unref();
      }
    },
  };
  // Idle → busy: the allowance starts from this call, not from what came before.
  if (live.size === 0) busyAllowanceMb = 0;
  live.set(id, state);
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    // Bound once the bundle has loaded; the bundle arms no timer while loading.
    const guestFire: { ref?: ivm.Reference<(id: number) => void> } = {};
    const bridge = createHostBridge({
      write: (fd, bytes) => {
        if (!output.write(fd, bytes) || flushScheduled) return;
        flushScheduled = true;
        // Batch: guest writes arrive as separate host tasks; one frame batch per 5 ms.
        setTimeout(flush, 5);
      },
      // Settles once the guest ran the callback: an interval re-arms only then (ADR-0558).
      fire: (timer) => guestFire.ref?.apply(undefined, [timer]),
    });
    closeBridge = bridge.close;
    if (state.reported) closeBridge();
    const names = Object.keys(bridge.functions);
    for (const [name, fn] of Object.entries(bridge.functions)) {
      await jail.set(`__riftyHost_${name}`, new ivm.Callback(fn));
    }
    await context.eval(`{
      const bridge = { timeOrigin: ${bridge.timeOrigin}, allowSharedArrayBuffer: ${request.allowSharedArrayBuffer !== false} };
      for (const name of ${JSON.stringify(names)}) {
        bridge[name] = globalThis['__riftyHost_' + name];
        delete globalThis['__riftyHost_' + name];
      }
      Object.defineProperty(globalThis, '__riftyIsolateHost', { value: Object.freeze(bridge), configurable: true });
    }`);
    if (cachedData === undefined && producing !== undefined) await producing.catch(() => {});
    const compiling = isolate.compileScript(guestSource, {
      filename: 'rifty-isolate-guest.js',
      ...(cachedData === undefined ? { produceCachedData: true } : { cachedData }),
    });
    if (cachedData === undefined) producing = compiling;
    const script = await compiling;
    // isolated-vm sets these on the script; its typings omit them.
    const cache = script as ivm.Script & ivm.CachedDataResult & { cachedDataRejected?: boolean };
    if (cachedData === undefined) cachedData = cache.cachedData;
    else if (cache.cachedDataRejected === true) cachedData = undefined;
    await script.run(context);
    const guest = await jail.get('__riftyGuest', { reference: true });
    guestFire.ref = await guest.get('fire', { reference: true });
    rejection = await guest.get('rejection', { reference: true });
    const start = await guest.get('run', { reference: true });
    await jail.delete('__riftyGuest');
    // From here a failure is the guest's run, not this worker's wiring.
    started = true;
    // The status crosses as ONE PRIMITIVE and is judged HERE, in the worker's
    // realm (ADR-0557 §6): a number resolves a promise with no lookup in the
    // guest realm, so a poisoned prototype there cannot rewrite it.
    const code: unknown = await start.apply(undefined, [request.code], {
      arguments: { copy: true },
      result: { promise: true, copy: true },
    });
    state.unwound = true;
    state.report(KIND.exit, Uint8Array.of(exitStatus(code)));
  } catch (error) {
    state.unwound = true;
    // Cancelled: the consumer already settled it; this terminal frame only ends its addressing.
    if (state.cancelled) state.report(KIND.exit, Uint8Array.of(1));
    else if (isolate.isDisposed && !state.disposedHere)
      state.report(KIND.memory, new Uint8Array(0));
    // The guest's own tail broke (its realm is the guest's to break): a failed run.
    else if (started) state.report(KIND.exit, Uint8Array.of(1));
    else {
      const text = error instanceof Error ? error.message : String(error);
      state.report(KIND.error, new TextEncoder().encode(text).subarray(0, MAX_ERROR_TEXT));
    }
  } finally {
    forget();
  }
}

function cancel(id: number): void {
  const state = live.get(id);
  if (state === undefined || state.reported) return;
  state.cancelled = true;
  state.disposedHere = true;
  // Its heap limit may have disposed it already (inside the 25 ms poll window).
  if (!state.isolate.isDisposed) state.isolate.dispose();
  // The run unwinds into `run`'s catch, which sends its terminal frame; a builtin that
  // ignores termination keeps the thread: retire after the grace.
  setTimeout(() => state.unwound || retire(), STUCK_GRACE_MS).unref();
}

// The consumer owns this worker's lifetime: stdin ends when it dies, and an
// orphan never keeps running.
// Linear in the bytes: each chunk is scanned once, a line is joined once.
let pending: string[] = [];
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data: string) => {
  let from = 0;
  for (let nl = data.indexOf('\n'); nl >= 0; nl = data.indexOf('\n', from)) {
    pending.push(data.slice(from, nl));
    const request = JSON.parse(pending.join('')) as WorkerRequest;
    pending = [];
    from = nl + 1;
    if (request.type === 'run') void run(request);
    else cancel(request.call);
  }
  if (from < data.length) pending.push(data.slice(from));
});
process.stdin.on('end', die);
