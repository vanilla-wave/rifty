import { NotImplementedError } from '@riftydev/io';
import type { KernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  awaitDrain,
  handleRealmUncaughtError,
  handleRealmUnhandledRejection,
  resetKeepalive,
} from '../internal/event-loop-keepalive.ts';
import { installNodeProcessShim } from '../ipc/install-process.ts';
import { setActiveNodeProcessBootstrap } from './process-bootstrap-identity.ts';
import { dispatchUncaughtException } from './process-lifecycle-events.ts';
import { NodeProcess, resetNodeProcessExit } from './process.ts';

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

  // An in-process host (no-COI runBin) projects a declared gap from the fatal
  // failure; the recorded exit signal must still name it. A guest-owned exit
  // names nothing.
  it('the recorded fatal exit signal keeps the error it terminated for', async () => {
    processWithControl();
    const gap = new NotImplementedError('toolchain.threaded-wasm');
    const reason = new Error('WASI binding not found', { cause: gap });
    const promise = Promise.reject(reason);
    promise.catch(() => {});

    handleRealmUnhandledRejection(reason, promise);

    const signal = await awaitDrain().then(
      () => null,
      (error: unknown) => error,
    );
    expect(signal).toMatchObject({ code: 'RIFTY_PROCESS_EXIT', exitCode: 1 });
    expect((signal as Error).cause).toBe(reason);
  });

  it('a throwing uncaughtException listener exit keeps the listener error', () => {
    const { process } = processWithControl();
    const thrown = new NotImplementedError('child_process.execSync');
    process.on('uncaughtException', () => {
      throw thrown;
    });

    const outcome = dispatchUncaughtException(new Error('entry'), 'uncaughtException');

    expect(outcome).toMatchObject({
      kind: 'exited',
      signal: { code: 'RIFTY_PROCESS_EXIT', exitCode: 7 },
    });
    expect(outcome.kind === 'exited' && outcome.signal.cause).toBe(thrown);
  });

  it('a guest exit() in the fatal exit listener carries no fatal cause', async () => {
    const { process } = processWithControl();
    process.on('exit', () => process.exit(2));
    const reason = new Error('V9');
    const promise = Promise.reject(reason);
    promise.catch(() => {});

    handleRealmUnhandledRejection(reason, promise);

    const signal = await awaitDrain().then(
      () => null,
      (error: unknown) => error,
    );
    expect(signal).toMatchObject({ code: 'RIFTY_PROCESS_EXIT', exitCode: 2 });
    expect((signal as Error).cause).toBeUndefined();
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

// ADR-0445 in-process host (no-COI command/runBin): no control port carries the
// exit request, so the drain is the only in-realm reader of the terminal. Node
// v24.16.0: a throwing listener exits 7 (never the natural exit's 0); an exit()
// inside a handler owns the status; a fresh invocation starts without it.
describe('in-process process without a control port (ADR-0445)', () => {
  function inProcess(): { readonly process: NodeProcess; readonly stderr: string[] } {
    const process = new NodeProcess();
    const stderr: string[] = [];
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    };
    setActiveNodeProcessBootstrap(process);
    return { process, stderr };
  }

  afterEach(() => {
    setActiveNodeProcessBootstrap(null);
  });

  it('a throwing uncaughtException listener settles the drain with status 7', async () => {
    const { process, stderr } = inProcess();
    process.on('uncaughtException', () => {
      throw new Error('LISTENER');
    });

    expect(handleRealmUncaughtError(new Error('timer'))).toBe(true);

    await expect(awaitDrain()).rejects.toMatchObject({
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: 7,
    });
    expect(stderr.join('')).toContain('Error: LISTENER');
  });

  it('a listener throw for an unhandled rejection settles the drain with status 7', async () => {
    const { process } = inProcess();
    process.on('uncaughtException', () => {
      throw new Error('LISTENER');
    });
    const reason = new Error('rejected');
    const promise = Promise.reject(reason);
    promise.catch(() => {});

    expect(handleRealmUnhandledRejection(reason, promise)).toBe(true);

    await expect(awaitDrain()).rejects.toMatchObject({
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: 7,
    });
  });

  it('an exit() inside a handler ends the loop with its status', async () => {
    const { process } = inProcess();
    process.on('uncaughtException', () => process.exit(4));

    expect(handleRealmUncaughtError(new Error('timer'))).toBe(true);

    await expect(awaitDrain()).rejects.toMatchObject({
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: 4,
    });
  });

  it('a reset invocation drains without the previous terminal', async () => {
    const { process } = inProcess();
    expect(() => process.exit(3)).toThrow(exitSignal(3));

    resetNodeProcessExit(process);

    await expect(awaitDrain()).resolves.toBeUndefined();
  });
});
