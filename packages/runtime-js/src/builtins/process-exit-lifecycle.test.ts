import type { KernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { resetKeepalive } from '../internal/event-loop-keepalive.ts';
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
} {
  const ipc = new MessageChannel();
  const frames: unknown[] = [];
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
      stderr: { write: () => {} },
      stdin: new MessageChannel().port1,
      ipc: ipc.port1,
    },
  };
  return { process: installNodeProcessShim(spec), frames };
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
