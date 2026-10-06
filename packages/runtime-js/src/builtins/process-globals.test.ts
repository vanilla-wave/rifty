import { NotImplementedError } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBuiltin, refreshRuntimeJsProcessBuiltin } from './index.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
import { NodeProcess, adoptNodeProcessBootstrap, installProcessGlobals } from './process.ts';

type GlobalWithNodeAlias = typeof globalThis & { global?: typeof globalThis };

const originalGlobalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'global');
const originalProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
const originalActiveProcess = readActiveNodeProcessBootstrap();

afterEach(() => {
  setActiveNodeProcessBootstrap(
    originalActiveProcess?.process ?? null,
    originalActiveProcess?.federated ?? false,
  );
  if (originalProcessDescriptor) {
    Object.defineProperty(globalThis, 'process', originalProcessDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'process');
  }
  if (originalGlobalDescriptor) {
    Object.defineProperty(globalThis, 'global', originalGlobalDescriptor);
  } else {
    Reflect.deleteProperty(globalThis as GlobalWithNodeAlias, 'global');
  }
  refreshRuntimeJsProcessBuiltin();
});

describe('installProcessGlobals', () => {
  it('installs the Node global alias for browser worker realms', () => {
    Reflect.deleteProperty(globalThis as GlobalWithNodeAlias, 'global');

    installProcessGlobals();

    expect((globalThis as GlobalWithNodeAlias).global).toBe(globalThis);
  });

  it('installs global with Node’s descriptor (enumerable own data property, not a hidden alias)', () => {
    const savedProcess = (globalThis as { process?: unknown }).process;
    // installProcessGlobals short-circuits when process is already a NodeProcess
    // (test 1 installed it); reset so the global-alias install actually runs.
    (globalThis as { process?: unknown }).process = undefined;
    Reflect.deleteProperty(globalThis as GlobalWithNodeAlias, 'global');
    try {
      installProcessGlobals();

      // Node: `Object.getOwnPropertyDescriptor(globalThis,'global')` is
      // {writable:true, enumerable:true, configurable:true} and shows up in
      // Object.keys(globalThis). A non-enumerable alias would diverge.
      expect(Object.getOwnPropertyDescriptor(globalThis, 'global')).toMatchObject({
        writable: true,
        enumerable: true,
        configurable: true,
      });
      expect(Object.keys(globalThis)).toContain('global');
    } finally {
      (globalThis as { process?: unknown }).process = savedProcess;
    }
  });

  it('does not downgrade or replace an existing trusted bootstrap binding', () => {
    const trusted = new NodeProcess();
    const guestReplacement = Object.create(trusted) as NodeProcess;
    setActiveNodeProcessBootstrap(trusted, true);
    Object.defineProperty(globalThis, 'process', {
      value: guestReplacement,
      writable: true,
      configurable: true,
    });

    installProcessGlobals();

    expect(readActiveNodeProcessBootstrap()).toEqual({
      process: trusted,
      identity: null,
      federated: true,
    });
  });

  it('resolves process builtins from the trusted bootstrap after the public global is poisoned', () => {
    const trusted = new NodeProcess();
    trusted.pid = 41;
    const guestReplacement = { pid: 76_543, ppid: 76_542 };
    setActiveNodeProcessBootstrap(trusted, true);
    Object.defineProperty(globalThis, 'process', {
      value: guestReplacement,
      writable: true,
      configurable: true,
    });
    refreshRuntimeJsProcessBuiltin();

    expect(loadBuiltin('process')).toBe(trusted);
    expect(loadBuiltin('node:process')).toBe(trusted);
  });

  it('adopts the same active process in a shared development bundle', () => {
    const stdin = new MessageChannel();
    const ipc = new MessageChannel();
    const process = new NodeProcess({
      pid: 41,
      ppid: 7,
      argv: ['rifty', '/entry.js'],
      env: {},
      cwd: '/workspace',
      stdio: {
        stdout: { write() {} },
        stderr: { write() {} },
        stdin: stdin.port1,
        ipc: ipc.port1,
      },
    });
    const authority = {
      kill: () => true,
      snapshot: () => [],
    };
    setActiveNodeProcessBootstrap(process, true);

    try {
      expect(() => adoptNodeProcessBootstrap(process, authority)).not.toThrow();
      expect(() => adoptNodeProcessBootstrap(process, authority)).toThrow(/already bound/i);
    } finally {
      stdin.port1.close();
      stdin.port2.close();
      ipc.port1.close();
      ipc.port2.close();
    }
  });

  it('trusts a one-shot adopted process created by another production bundle', async () => {
    const stdin = new MessageChannel();
    const ipc = new MessageChannel();
    const foreignBundleProcess = new NodeProcess({
      pid: 41,
      ppid: 7,
      argv: ['rifty', '/entry.js'],
      env: {},
      cwd: '/workspace',
      stdio: {
        stdout: { write() {} },
        stderr: { write() {} },
        stdin: stdin.port1,
        ipc: ipc.port1,
      },
    });

    vi.resetModules();
    const freshProcessModule = await import('./process.ts');
    const freshIdentityModule = await import('./process-bootstrap-identity.ts');
    const freshBuiltinModule = await import('./index.ts');
    try {
      expect(foreignBundleProcess).not.toBeInstanceOf(freshProcessModule.NodeProcess);
      freshProcessModule.adoptNodeProcessBootstrap(foreignBundleProcess, {
        kill: () => true,
        snapshot: () => [],
      });
      Object.defineProperty(globalThis, 'process', {
        value: { pid: 76_543, ppid: 76_542 },
        writable: true,
        configurable: true,
      });
      freshBuiltinModule.refreshRuntimeJsProcessBuiltin();

      expect(freshIdentityModule.readActiveNodeProcessBootstrap()).toEqual({
        process: foreignBundleProcess,
        identity: { pid: 41, ppid: 7 },
        federated: true,
      });
      expect(freshBuiltinModule.loadBuiltin('process')).toBe(foreignBundleProcess);
      expect(freshBuiltinModule.loadBuiltin('node:process')).toBe(foreignBundleProcess);
      expect(() =>
        freshProcessModule.adoptNodeProcessBootstrap(foreignBundleProcess, {
          kill: () => true,
          snapshot: () => [],
        }),
      ).toThrow(/already bound/i);
    } finally {
      freshIdentityModule.setActiveNodeProcessBootstrap(null);
      stdin.port1.close();
      stdin.port2.close();
      ipc.port1.close();
      ipc.port2.close();
    }
  });
});

describe('process.memoryUsage named-loud member (absent-builtin-members-loud-throws)', () => {
  it('binds without throwing and CALLS loud, never fabricates heap numbers', async () => {
    const ns = (await loadBuiltin('process')) as { memoryUsage: () => never };
    expect(typeof ns.memoryUsage).toBe('function');
    const bound = ns.memoryUsage.bind({}) as () => never;
    expect(typeof bound).toBe('function');
    expect(() => ns.memoryUsage()).toThrow(NotImplementedError);
    expect(() => ns.memoryUsage()).toThrow('process.memoryUsage');
  });
});

describe('process exit lifecycle (process-lifecycle-events-exit-code, I3)', () => {
  function freshProcess(): InstanceType<typeof NodeProcess> {
    return new NodeProcess();
  }

  it('exit() without an argument exits with process.exitCode', () => {
    const proc = freshProcess();
    proc.exitCode = 3;
    let caught: unknown;
    try {
      proc.exit();
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe('RIFTY_PROCESS_EXIT');
    expect((caught as { exitCode?: number }).exitCode).toBe(3);
  });

  it("'exit' fires exactly once with the RAW code, on both natural and explicit paths", async () => {
    const proc = freshProcess();
    proc.exitCode = 257; // OS wraps to 1; the event sees the raw value (Node oracle)
    const codes: unknown[] = [];
    proc.on('exit', (code) => codes.push(code));
    // Natural-exit emission rides the keepalive dispatcher (no guest API).
    const { emitProcessExitEvent } = await import('./process-lifecycle-dispatcher.ts');
    emitProcessExitEvent(proc, proc.exitCode);
    let caught: unknown;
    try {
      proc.exit(1);
    } catch (err) {
      caught = err;
    }
    // Natural emission already claimed the once-slot; explicit exit() after it
    // must not emit again.
    expect(codes).toEqual([257]);
    expect((caught as { exitCode?: number }).exitCode).toBe(1);
  });

  it('exit() emits the exit event with its code before the terminal throw', () => {
    const proc = freshProcess();
    const codes: unknown[] = [];
    proc.on('exit', (code) => codes.push(code));
    try {
      proc.exit(2);
    } catch {
      /* RIFTY_PROCESS_EXIT expected */
    }
    expect(codes).toEqual([2]);
  });
});
