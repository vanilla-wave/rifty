/**
 * Child process (ADR-0557 §2–3): one isolated-vm isolate holding the rifty
 * guest bundle, one run. Spawned with `--no-node-snapshot` and an empty env by
 * `runCode`; killed by the parent after its last message. Only the validated
 * copying `ivm.Callback`s of `bridge.ts` cross into the isolate.
 */
import { readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import ivm from 'isolated-vm';
import { FRAME_CHANNEL_FD, KIND, MAX_ERROR_TEXT, type RunRequest, frame } from '../protocol.ts';
import { OutputBudget, createBridge } from './bridge.ts';

const channel = new Socket({ fd: FRAME_CHANNEL_FD, readable: false, writable: true });
channel.on('error', () => process.kill(process.pid, 'SIGKILL'));
const send = (kind: number, payload: Uint8Array): void => {
  channel.write(frame(kind, payload));
};

/** Unhandled rejection reasons isolated-vm cannot copy out arrive as this token. */
const UNCOPYABLE_REASON = 'isolate-host:uncopyable-rejection-reason';
const IMPORT_GAP =
  'Not implemented: isolate-host.dynamic-import (import() is not available in the rifty isolate host; use require(), ADR-0557)';

async function run(request: RunRequest): Promise<void> {
  const output = new OutputBudget(request.maxOutputBytes);
  let flushScheduled = false;
  let reported = false;
  let sentTruncated = false;
  const flush = (): void => {
    flushScheduled = false;
    const chunks = output.drain();
    // The consumer accepts only new bytes or the one truncation flip (protocol state).
    if (chunks.length === 0 && (!output.truncated || sentTruncated)) return;
    const t = output.truncated ? 1 : 0;
    if (chunks.length === 0) send(KIND.output, Uint8Array.of(1, t));
    for (const [fd, bytes] of chunks) {
      const payload = new Uint8Array(2 + bytes.byteLength);
      payload[0] = fd;
      payload[1] = t;
      payload.set(bytes, 2);
      send(KIND.output, payload);
    }
    sentTruncated = output.truncated;
  };
  const report = (kind: number, payload: Uint8Array): void => {
    if (reported) return;
    reported = true;
    flush();
    send(kind, payload);
  };
  const reportMemory = (): void => report(KIND.memory, Uint8Array.of(output.truncated ? 1 : 0));
  setInterval(() => {
    if (process.memoryUsage.rss() > request.maxRssBytes) reportMemory();
  }, 25);

  let rejection: ivm.Reference<(reason: unknown) => void> | undefined;
  const isolate = new ivm.Isolate({
    memoryLimit: request.memoryLimitMb,
    onCatastrophicError: reportMemory,
    // A sync throw rejects the guest's import() — a declared ceiling (compat). No
    // child frames: the stack crosses into the guest and must not reveal host paths.
    importModuleDynamically: () => {
      throw Object.assign(new Error(IMPORT_GAP), { stack: `Error: ${IMPORT_GAP}` });
    },
    onUnhandledRejection: (reason: unknown) => {
      try {
        rejection?.applyIgnored(undefined, [reason], { arguments: { copy: true } });
      } catch {
        rejection?.applyIgnored(undefined, [UNCOPYABLE_REASON]);
      }
    },
  });
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    let fire: ivm.Reference<(id: number) => void> | undefined;
    // Timers armed while the bundle loads can expire before `fire` is bound.
    const early: number[] = [];
    const bridge = createBridge({
      output,
      outputPending: () => {
        if (flushScheduled) return;
        flushScheduled = true;
        // Batch: guest writes arrive as separate host tasks; one frame batch per 5 ms.
        setTimeout(flush, 5);
      },
      fire: (id) => {
        if (fire === undefined) early.push(id);
        else fire.applyIgnored(undefined, [id]);
      },
      done: (exitCode) => report(KIND.exit, Uint8Array.of(exitCode, output.truncated ? 1 : 0)),
    });
    const names = Object.keys(bridge);
    for (const [name, fn] of Object.entries(bridge)) {
      await jail.set(`__riftyHost_${name}`, new ivm.Callback(fn));
    }
    await context.eval(`{
      const bridge = { timeOrigin: ${performance.timeOrigin}, uncopyableReason: ${JSON.stringify(UNCOPYABLE_REASON)} };
      for (const name of ${JSON.stringify(names)}) {
        bridge[name] = globalThis['__riftyHost_' + name];
        delete globalThis['__riftyHost_' + name];
      }
      Object.defineProperty(globalThis, '__riftyIsolateHost', { value: Object.freeze(bridge), configurable: true });
    }`);
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
    if (isolate.isDisposed) reportMemory();
    else {
      const text = error instanceof Error ? error.message : String(error);
      report(KIND.error, new TextEncoder().encode(text).subarray(0, MAX_ERROR_TEXT));
    }
  }
}

// One request line on stdin. The parent owns this child's lifetime: stdin ends
// when the parent dies, and an orphan never keeps running.
let pending = '';
let started = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data: string) => {
  if (started) return;
  pending += data;
  const newline = pending.indexOf('\n');
  if (newline < 0) return;
  started = true;
  void run(JSON.parse(pending.slice(0, newline)) as RunRequest);
});
process.stdin.on('end', () => process.kill(process.pid, 'SIGKILL'));
