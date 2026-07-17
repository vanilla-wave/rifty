import type { KernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeEntryTerminalBootstrap } from '../builtins/node-entry-runtime-config.ts';
import { applyNodeProcessTerminalBootstrap } from '../builtins/process.ts';
import { installNodeProcessShim } from './install-process.ts';

const originalProcess = (globalThis as { process?: unknown }).process;

function spec(
  ipc: MessagePort,
  env: Record<string, string> = { NAPI_RS_FORCE_WASI: '1', PORT: '5174' },
): KernelProcessSpec {
  const stdout = new MessageChannel();
  const stderr = new MessageChannel();
  const stdin = new MessageChannel();
  return {
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env,
    cwd: '/workspace',
    stdio: {
      stdout: stdout.port1,
      stderr: stderr.port1,
      stdin: stdin.port1,
      ipc,
    },
  };
}

afterEach(() => {
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

type ResizableWriter = ReturnType<typeof installNodeProcessShim>['stdout'] & {
  columns: number;
  rows: number;
  getWindowSize(): [number, number];
  on(event: 'resize', listener: () => void): unknown;
};

describe('late Node process terminal bootstrap', () => {
  it('treats colliding legacy TTY env keys as guest data until typed bootstrap', () => {
    // Fault class: frozen-assumption. Former RIFTY_TTY_* control names remain
    // ordinary guest data; only the entry-owned typed bootstrap may shape stdio.
    const ipc = new MessageChannel();
    const guestEnv = {
      USER_FLAG: 'kept',
      RIFTY_STDIN_IS_TTY: '1',
      RIFTY_STDOUT_IS_TTY: '0',
      RIFTY_STDERR_IS_TTY: 'guest-value',
      RIFTY_TTY_COLS: 'wide',
      RIFTY_TTY_ROWS: 'tall',
    };
    let process: ReturnType<typeof installNodeProcessShim> | undefined;

    expect(() => {
      process = installNodeProcessShim(spec(ipc.port1, guestEnv));
    }).not.toThrow();
    expect(process).toBeDefined();
    if (process === undefined) throw new Error('process install did not return');

    expect(process.env).toEqual(guestEnv);
    expect(process.stdin).toMatchObject({ fd: 0, isTTY: false });
    expect(process.stdout).toMatchObject({ fd: 1, isTTY: false });
    expect(process.stderr).toMatchObject({ fd: 2, isTTY: false });

    applyNodeProcessTerminalBootstrap(process, {
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 123,
      rows: 45,
    });

    const stdout = process.stdout as ResizableWriter;
    const stderr = process.stderr as ResizableWriter;
    expect(process.env).toEqual(guestEnv);
    expect(stdout).toMatchObject({ fd: 1, isTTY: true, columns: 123, rows: 45 });
    expect(stderr).toMatchObject({ fd: 2, isTTY: true, columns: 123, rows: 45 });
    expect(stdout.getWindowSize()).toEqual([123, 45]);
    expect(stderr.getWindowSize()).toEqual([123, 45]);
  });

  it('applies typed TTY shape before user code without leaking host metadata into env', () => {
    // Regression (sibling-drift + frozen-assumption, ADR-0267): the dev-server
    // has its own entry envelope, so copying Node-entry RIFTY_* env made host
    // launch metadata user-visible. One process chokepoint must shape stdio.
    const ipc = new MessageChannel();
    const process = installNodeProcessShim(spec(ipc.port1));
    const terminal = Object.freeze({
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 91,
      rows: 37,
    }) satisfies NodeEntryTerminalBootstrap;

    expect(process.stdin.isTTY).toBe(false);
    expect(process.stdout.isTTY).toBe(false);
    expect(process.stderr.isTTY).toBe(false);

    applyNodeProcessTerminalBootstrap(process, terminal);

    const stdout = process.stdout as ResizableWriter;
    const stderr = process.stderr as ResizableWriter;
    expect(process.env).toEqual({ NAPI_RS_FORCE_WASI: '1', PORT: '5174' });
    expect(Object.keys(process.env).filter((key) => key.startsWith('RIFTY_'))).toEqual([]);
    expect(process.stdin).toMatchObject({ fd: 0, isTTY: true });
    expect(stdout).toMatchObject({ fd: 1, isTTY: true, columns: 91, rows: 37 });
    expect(stderr).toMatchObject({ fd: 2, isTTY: true, columns: 91, rows: 37 });
    expect(stdout.getWindowSize()).toEqual([91, 37]);
    expect(stderr.getWindowSize()).toEqual([91, 37]);
  });

  it('reads each accessor-backed terminal field once into one detached snapshot', () => {
    // Fault class: corrupt-input. Public callers may pass accessors or proxies;
    // validation and application must consume the same five observed values.
    const ipc = new MessageChannel();
    const process = installNodeProcessShim(spec(ipc.port1));
    const first = {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 107,
      rows: 39,
    } as const;
    const reads = new Map<string, number>();
    const terminal: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(first)) {
      Object.defineProperty(terminal, field, {
        enumerable: true,
        configurable: true,
        get() {
          const count = (reads.get(field) ?? 0) + 1;
          reads.set(field, count);
          if (count > 1) throw new Error(`terminal.${field} read twice`);
          return value;
        },
      });
    }

    expect(() =>
      applyNodeProcessTerminalBootstrap(process, terminal as unknown as NodeEntryTerminalBootstrap),
    ).not.toThrow();
    expect(Object.fromEntries(reads)).toEqual({
      stdinIsTTY: 1,
      stdoutIsTTY: 1,
      stderrIsTTY: 1,
      cols: 1,
      rows: 1,
    });
    expect(process.stdin.isTTY).toBe(true);
    expect(process.stdout).toMatchObject({ isTTY: true, columns: 107, rows: 39 });
    expect(process.stderr).toMatchObject({ isTTY: true, columns: 107, rows: 39 });
  });

  it('leaves stdio unchanged when an accessor snapshot is invalid', () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim(spec(ipc.port1));
    const terminal = {
      get stdinIsTTY() {
        return true;
      },
      get stdoutIsTTY() {
        return true;
      },
      get stderrIsTTY() {
        return true;
      },
      get cols() {
        return 107;
      },
      get rows() {
        return 0;
      },
    };

    expect(() => applyNodeProcessTerminalBootstrap(process, terminal)).toThrow(RangeError);
    expect(process.stdin).toMatchObject({ isTTY: false });
    expect(process.stdout).toMatchObject({ isTTY: false });
    expect(process.stderr).toMatchObject({ isTTY: false });
  });

  it('preserves resize events and SIGWINCH after the late bootstrap', async () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim(spec(ipc.port1));
    applyNodeProcessTerminalBootstrap(process, {
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 80,
      rows: 24,
    });
    const stdout = process.stdout as ResizableWriter;
    const stderr = process.stderr as ResizableWriter;
    const events: string[] = [];
    stdout.on('resize', () => events.push(`stdout:${stdout.columns}x${stdout.rows}`));
    stderr.on('resize', () => events.push(`stderr:${stderr.columns}x${stderr.rows}`));
    process.on('SIGWINCH', () => events.push('SIGWINCH'));

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 120, rows: 40 });
    await tick();

    expect(stdout.getWindowSize()).toEqual([120, 40]);
    expect(stderr.getWindowSize()).toEqual([120, 40]);
    expect(events).toEqual(['stdout:120x40', 'stderr:120x40', 'SIGWINCH']);

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 120, rows: 40 });
    await tick();
    expect(events).toEqual(['stdout:120x40', 'stderr:120x40', 'SIGWINCH']);
  });

  it('retains a validated resize that arrives before the late bootstrap', async () => {
    // Fault class: torn-state. Kernel control can race the URL module
    // import; the single process owner must retain the newest grid even while
    // its streams are not TTY-shaped yet.
    const ipc = new MessageChannel();
    const process = installNodeProcessShim(spec(ipc.port1));

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 111, rows: 33 });
    await tick();
    applyNodeProcessTerminalBootstrap(process, {
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 80,
      rows: 24,
    });

    const stdout = process.stdout as ResizableWriter;
    const stderr = process.stderr as ResizableWriter;
    expect(stdout.getWindowSize()).toEqual([111, 33]);
    expect(stderr.getWindowSize()).toEqual([111, 33]);

    const events: string[] = [];
    stdout.on('resize', () => events.push(`stdout:${stdout.columns}x${stdout.rows}`));
    stderr.on('resize', () => events.push(`stderr:${stderr.columns}x${stderr.rows}`));
    process.on('SIGWINCH', () => events.push('SIGWINCH'));
    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 120, rows: 40 });
    await tick();
    expect(events).toEqual(['stdout:120x40', 'stderr:120x40', 'SIGWINCH']);
  });

  it('applies the owner copy latest grid through a separately loaded runtime copy', async () => {
    // Fault class: sibling-drift. Production can bundle the kernel pre-entry and
    // URL entry with distinct runtime-js module copies. Shared launch state
    // must live on the one process instance, never in a module-local side map.
    const ipc = new MessageChannel();
    const process = installNodeProcessShim(spec(ipc.port1));
    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 111, rows: 33 });
    await tick();

    vi.resetModules();
    const foreignRuntime = await import('../builtins/process.ts');
    expect(foreignRuntime.NodeProcess).not.toBe(process.constructor);
    foreignRuntime.applyNodeProcessTerminalBootstrap(process, {
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 80,
      rows: 24,
    });

    const stdout = process.stdout as ResizableWriter;
    const stderr = process.stderr as ResizableWriter;
    expect(stdout.getWindowSize()).toEqual([111, 33]);
    expect(stderr.getWindowSize()).toEqual([111, 33]);
  });
});
