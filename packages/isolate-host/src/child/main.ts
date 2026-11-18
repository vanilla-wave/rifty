/**
 * Child process (ADR-0557 §2–3): one isolated-vm isolate holding the rifty
 * guest bundle, one run. Spawned with `--no-node-snapshot` and an empty env by
 * `runCode`; killed by the parent after its last message. Only copying
 * `ivm.Callback`s over the export's validated `createHostBridge` functions
 * cross into the isolate (ADR-0558).
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
import { FRAME_CHANNEL_FD, KIND, MAX_ERROR_TEXT, type RunRequest, frame } from '../protocol.ts';
import { OutputBudget, importGapError } from './bridge.ts';

const channel = new Socket({ fd: FRAME_CHANNEL_FD, readable: false, writable: true });
channel.on('error', () => process.kill(process.pid, 'SIGKILL'));
const send = (kind: number, payload: Uint8Array): void => {
  channel.write(frame(kind, payload));
};

async function run(request: RunRequest): Promise<void> {
  // Before the guest's entry exists, a failure is this child's, not the guest's.
  let started = false;
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
    // A truncation flip with nothing new to send is its own frame.
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
  const reportMemory = (): void => report(KIND.memory, new Uint8Array(0));
  // A report the child cannot use is a failed run. stderr stays the guest's
  // bytes (goal.md Decisions): the child adds no text of its own.
  const reportFailed = (): void => report(KIND.exit, Uint8Array.of(1));
  setInterval(() => {
    if (process.memoryUsage.rss() > request.maxRssBytes) reportMemory();
  }, 25);

  let rejection: ivm.Reference<(reason: unknown) => void> | undefined;
  const isolate = new ivm.Isolate({
    memoryLimit: request.memoryLimitMb,
    onCatastrophicError: reportMemory,
    // `import()` is a gap this host cannot serve, and a rejection the guest may
    // never observe (it can drain first, or swallow it). Fidelity: end the run
    // loudly here, then reject the guest's promise too (no child frames in the
    // stack — it crosses into the guest and must not reveal host paths).
    importModuleDynamically: () => {
      // Loud and terminal, as any other ceiling: the guest's stderr gets the gap
      // and the run ends 1. The guest may never observe the rejection below (it
      // can drain first, or swallow it), so the gap cannot be left to it.
      output.write(2, new TextEncoder().encode(`Error: ${IMPORT_GAP}\n`));
      report(KIND.exit, Uint8Array.of(1));
      throw importGapError();
    },
    onUnhandledRejection: (reason: unknown) => {
      try {
        rejection?.applyIgnored(undefined, [reason], { arguments: { copy: true } });
      } catch {
        rejection?.applyIgnored(undefined, [UNCOPYABLE_REJECTION]);
      }
    },
  });
  try {
    const context = await isolate.createContext();
    const jail = context.global;
    // Bound once the bundle has loaded; the bundle arms no timer while loading.
    const guestFire: { ref?: ivm.Reference<(id: number) => void> } = {};
    const { functions, timeOrigin } = createHostBridge({
      write: (fd, bytes) => {
        if (!output.write(fd, bytes) || flushScheduled) return;
        flushScheduled = true;
        // Batch: guest writes arrive as separate host tasks; one frame batch per 5 ms.
        setTimeout(flush, 5);
      },
      fire: (id) => guestFire.ref?.applyIgnored(undefined, [id]),
    });
    const names = Object.keys(functions);
    for (const [name, fn] of Object.entries(functions)) {
      await jail.set(`__riftyHost_${name}`, new ivm.Callback(fn));
    }
    await context.eval(`{
      const bridge = { timeOrigin: ${timeOrigin} };
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
    guestFire.ref = await guest.get('fire', { reference: true });
    rejection = await guest.get('rejection', { reference: true });
    const start = await guest.get('run', { reference: true });
    await jail.delete('__riftyGuest');
    // From here a failure is the guest's run, not this child's wiring.
    started = true;
    // The status crosses as ONE PRIMITIVE and is judged HERE, in the child's
    // realm. A number resolves a promise with no lookup in the guest realm (the
    // thenable check runs only for objects), so a poisoned prototype there
    // cannot rewrite it; the guest can cost itself only its own status and
    // text, never the consumer's view of this host (ADR-0557 §6).
    const code: unknown = await start.apply(undefined, [request.code], {
      arguments: { copy: true },
      result: { promise: true, copy: true },
    });
    report(KIND.exit, Uint8Array.of(exitStatus(code)));
  } catch (error) {
    if (isolate.isDisposed) reportMemory();
    // The guest's own tail broke (its realm is the guest's to break): a failed
    // run with this child's diagnostic, never this child reporting a failure.
    else if (started) reportFailed();
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
