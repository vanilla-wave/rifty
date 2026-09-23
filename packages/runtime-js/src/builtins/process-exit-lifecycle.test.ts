import type { KernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  awaitDrain,
  handleRealmUnhandledRejection,
  resetKeepalive,
} from '../internal/event-loop-keepalive.ts';
import { installNodeProcessShim } from '../ipc/install-process.ts';

// ADR-0445 fault rows (observable-order): `exit()` re-entered from an `'exit'`
// listener, or called again by a timer that listener scheduled (vitest's
// onExit `setTimeout(() => process.exit(), 1)`), never re-emits `'exit'` and
// never sends the kernel a second, different exit request.

const originalProcess = (globalThis as { process?: unknown }).process;

afterEach(() => {
  resetKeepalive();
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
});

function processWithControl(): {
  readonly process: ReturnType<typeof installNodeProcessShim>;
  readonly frames: unknown[];
  readonly stderr: string[];
} {
  const ipc = new MessageChannel();
  const frames: unknown[] = [];
  const stderr: string[] = [];
  ipc.port2.onmessage = (event) => frames.push(event.data);
  ipc.port2.start();
  const spec: KernelProcessSpec = {
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env: {},
    cwd: '/workspace',
    stdio: {
      stdout: { write: () => {} },
      stderr: {
        write: (bytes: Uint8Array) => {
          stderr.push(new TextDecoder().decode(bytes));
        },
      },
      stdin: new MessageChannel().port1,
      ipc: ipc.port1,
    },
  };
  return { process: installNodeProcessShim(spec), frames, stderr };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));
const exitSignal = (exitCode: number) =>
  expect.objectContaining({ code: 'RIFTY_PROCESS_EXIT', exitCode });

describe('process.exit re-entry (ADR-0445)', () => {
  it('a later exit() after the first terminal neither re-emits exit nor re-requests exit', async () => {
    const { process, frames } = processWithControl();
    const seen: unknown[] = [];
    process.on('exit', (code: unknown) => seen.push(code));

    expect(() => process.exit(3)).toThrow(exitSignal(3));
    expect(() => process.exit(9)).toThrow();
    await tick();

    expect(seen).toEqual([3]);
    expect(frames).toEqual([{ kind: 'control:self-exit', code: 3 }]);
  });

  it('exit() inside an exit listener runs the listeners once and requests only its code', async () => {
    const { process, frames } = processWithControl();
    const seen: unknown[] = [];
    process.on('exit', (code: unknown) => {
      seen.push(code);
      process.exit(2);
    });
    process.on('exit', (code: unknown) => seen.push(`second:${String(code)}`));

    expect(() => process.exit(1)).toThrow(exitSignal(2));
    await tick();

    expect(seen).toEqual([1]);
    expect(frames).toEqual([{ kind: 'control:self-exit', code: 2 }]);
  });
});

// ADR-0445 fault row (observable-order): Node dies inside its fatal handler, so a
// no-listener rejection's status 1 is final at once — a later task's exit(0)
// (reviewer probe: `setTimeout(() => process.exit(0), 1)`) never overrides it.
describe('fatal unhandled rejection (ADR-0445)', () => {
  it('prints and requests status 1 at the trap; a later exit(0) requests nothing', async () => {
    const { process, frames, stderr } = processWithControl();
    const seen: unknown[] = [];
    process.on('exit', (code: unknown) => seen.push(code));
    const reason = new Error('V1');
    const promise = Promise.reject(reason);
    promise.catch(() => {});

    const canceled = handleRealmUnhandledRejection(reason, promise);
    expect(() => process.exit(0)).toThrow();
    await tick();

    expect(frames).toEqual([{ kind: 'control:self-exit', code: 1 }]);
    expect(seen).toEqual([1]);
    expect(stderr.join('')).toContain('Error: V1');
    expect(canceled).toBe(true);
    await expect(awaitDrain()).rejects.toMatchObject({ code: 'RIFTY_PROCESS_EXIT', exitCode: 1 });
  });

  // Node v24.16.0 (evidence §F): exit(2) in the fatal 'exit' listener → status 2,
  // no stderr; exit(0) before the rejection is seen → status 0, no stderr.
  it('an exit() inside the fatal exit listener owns the status and nothing prints', async () => {
    const { process, frames, stderr } = processWithControl();
    process.on('exit', () => process.exit(2));
    const reason = new Error('V7');
    const promise = Promise.reject(reason);
    promise.catch(() => {});

    handleRealmUnhandledRejection(reason, promise);
    await tick();

    expect(frames).toEqual([{ kind: 'control:self-exit', code: 2 }]);
    expect(stderr).toEqual([]);
    await expect(awaitDrain()).rejects.toMatchObject({ code: 'RIFTY_PROCESS_EXIT', exitCode: 2 });
  });

  it('a rejection seen after exit(0) prints nothing and keeps status 0', async () => {
    const { process, frames, stderr } = processWithControl();
    const reason = new Error('V8');
    const promise = Promise.reject(reason);
    promise.catch(() => {});

    expect(() => process.exit(0)).toThrow(exitSignal(0));
    handleRealmUnhandledRejection(reason, promise);
    await tick();

    expect(frames).toEqual([{ kind: 'control:self-exit', code: 0 }]);
    expect(stderr).toEqual([]);
    await expect(awaitDrain()).rejects.toMatchObject({ code: 'RIFTY_PROCESS_EXIT', exitCode: 0 });
  });
});
