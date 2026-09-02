import { fileURLToPath } from 'node:url';

/**
 * ADR-0157 — the Node-worker GATE at the pre-entry seam + by-construction process.
 *
 * `installNodeRuntime(spec)` installs ONE seeded process for every kernel worker;
 * the rich extras (`globalThis.Buffer` + the `Promise.prototype.then` nextTick
 * patch) are gated to NODE workers. A legacy WASI worker (no node-entry envelope,
 * `spec.env.__RIFTY_WASI_WASM_URL`) gets NEITHER; a valid Node envelope wins.
 *
 * Capture native `Promise.prototype.then` at module load (the patch is global +
 * irreversible per realm), so the WASI test — which MUST run before the Node test
 * patches the realm — asserts it stayed native. `isolate: true` (vitest default)
 * gives this file a fresh realm.
 */
import {
  type KernelProcessSpec,
  publishKernelEntryBootstrap,
  publishKernelProcessSpec,
} from '@riftydev/kernel';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Buffer as RiftyBuffer } from '../builtins/buffer.ts';
import { buildNodeEntryWorkerEntry } from '../builtins/node-entry-runtime-config.ts';
import {
  NodeProcess,
  applyNodeProcessTerminalBootstrap,
  getProcessCwd,
} from '../builtins/process.ts';
import { isVmEngineReady } from '../builtins/vm/quickjs-loader.ts';
import { runRuntimeSmokeChild } from '../internal/runtime-smoke-child.test-helper.ts';
import { installNodeProcessShim, installNodeRuntime } from './install-process.ts';

const NATIVE_THEN = Promise.prototype.then;
const ORIGINAL_PROCESS = (globalThis as { process?: unknown }).process;
const ORIGINAL_BUFFER = (globalThis as { Buffer?: unknown }).Buffer;
const ORIGINAL_GLOBAL_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, 'global');
const QUICKJS_FIXTURE = fileURLToPath(
  new URL('../../tests/fixtures/install-node-runtime-quickjs.ts', import.meta.url),
);
const QUICKJS_MARKER = 'RIFTY_INSTALL_NODE_RUNTIME_QUICKJS_OK';
const openChannels = new Set<MessageChannel>();

function channel(): MessageChannel {
  const value = new MessageChannel();
  openChannels.add(value);
  return value;
}

function expectSupervisorIdentity(): void {
  const globalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'global');
  expect.soft((globalThis as { process?: unknown }).process).toBe(ORIGINAL_PROCESS);
  expect.soft((globalThis as { Buffer?: unknown }).Buffer).toBe(ORIGINAL_BUFFER);
  expect.soft(Promise.prototype.then).toBe(NATIVE_THEN);
  expect.soft(globalDescriptor?.value).toBe(ORIGINAL_GLOBAL_DESCRIPTOR?.value);
  expect.soft(globalDescriptor?.writable).toBe(ORIGINAL_GLOBAL_DESCRIPTOR?.writable);
  expect.soft(globalDescriptor?.enumerable).toBe(ORIGINAL_GLOBAL_DESCRIPTOR?.enumerable);
  expect.soft(globalDescriptor?.configurable).toBe(ORIGINAL_GLOBAL_DESCRIPTOR?.configurable);
}

function spec(env: Record<string, string> = {}): KernelProcessSpec {
  const port = (): MessagePort => channel().port1;
  const value: KernelProcessSpec = {
    pid: 7,
    ppid: 3,
    argv: ['rifty', '/srv.js', '--port', '4000'],
    env,
    cwd: '/workspace/app',
    stdio: {
      stdout: { write() {} },
      stderr: { write() {} },
      stdin: port(),
      ipc: port(),
    },
  };
  publishKernelProcessSpec(value);
  return value;
}

afterEach(() => {
  publishKernelEntryBootstrap(null);
  Object.defineProperty(globalThis, 'process', {
    value: ORIGINAL_PROCESS,
    writable: true,
    configurable: true,
  });
  (globalThis as { Buffer?: unknown }).Buffer = ORIGINAL_BUFFER;
  Reflect.deleteProperty(globalThis, 'global');
  if (ORIGINAL_GLOBAL_DESCRIPTOR) {
    Object.defineProperty(globalThis, 'global', ORIGINAL_GLOBAL_DESCRIPTOR);
  }
  for (const value of openChannels) {
    value.port1.close();
    value.port2.close();
  }
});

afterAll(() => {
  Promise.prototype.then = NATIVE_THEN;
});

describe('pre-entry gate (ADR-0157)', () => {
  // MUST be first: asserts the realm is still un-patched.
  it('WASI worker: seeds the process but installs NO Buffer / NO Promise patch', () => {
    Reflect.deleteProperty(globalThis, 'global');
    const readiness = installNodeRuntime(spec({ __RIFTY_WASI_WASM_URL: 'https://x/app.wasm' }));
    expect((globalThis as { process?: unknown }).process).toBeInstanceOf(NodeProcess);
    // NEGATIVE: no Node over-implementation for a non-Node worker.
    expect(Promise.prototype.then).toBe(NATIVE_THEN);
    expect((globalThis as { Buffer?: unknown }).Buffer).not.toBe(RiftyBuffer);
    expect(Object.prototype.hasOwnProperty.call(globalThis, 'global')).toBe(false);
    expect(readiness).toBeUndefined();
    expect(isVmEngineReady()).toBe(false);
  });

  it('QuickJS readiness runs in a child without mutating the Vitest supervisor', async () => {
    const completion = runRuntimeSmokeChild({
      fixture: QUICKJS_FIXTURE,
      marker: QUICKJS_MARKER,
      timeoutMs: 30_000,
    });
    expectSupervisorIdentity();
    await expect(completion).resolves.toContain(QUICKJS_MARKER);
    expectSupervisorIdentity();
  });

  it('rewrite Node worker installs globals synchronously without QuickJS readiness', () => {
    const readiness = installNodeRuntime(spec({ __RIFTY_VM_ENGINE: 'rewrite' }));

    expect(readiness).toBeUndefined();
    expect(isVmEngineReady()).toBe(false);
    expect((globalThis as { process?: unknown }).process).toBeInstanceOf(NodeProcess);
  });

  it('Node-entry bootstrap outranks a guest __RIFTY_WASI_WASM_URL key', () => {
    const entry = buildNodeEntryWorkerEntry(
      'https://host.test/node-entry.js',
      { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' },
      { kind: 'worker-thread', remoteFs: true, threadId: 7 },
    );
    publishKernelEntryBootstrap(entry.bootstrap ?? null);
    Reflect.deleteProperty(globalThis, 'global');

    installNodeRuntime(spec({ __RIFTY_WASI_WASM_URL: 'guest-poison' }));

    const proc = (globalThis as { process?: unknown }).process as NodeProcess;
    expect(proc.env.__RIFTY_WASI_WASM_URL).toBe('guest-poison');
    expect(Promise.prototype.then).not.toBe(NATIVE_THEN);
    expect((globalThis as { Buffer?: unknown }).Buffer).toBe(RiftyBuffer);
    expect((globalThis as { global?: unknown }).global).toBe(globalThis);
  });

  it('Node worker: seeds the process AND installs Buffer + global + the nextTick Promise patch', () => {
    (globalThis as { global?: unknown }).global = undefined;
    installNodeRuntime(spec());
    expect((globalThis as { process?: unknown }).process).toBeInstanceOf(NodeProcess);
    expect(Promise.prototype.then).not.toBe(NATIVE_THEN);
    expect((globalThis as { Buffer?: unknown }).Buffer).toBe(RiftyBuffer);
    expect((globalThis as { global?: unknown }).global).toBe(globalThis);
  });

  it('Node worker: typed terminal bootstrap shapes process stdio streams', () => {
    installNodeRuntime(spec());
    const proc = (globalThis as { process?: unknown }).process as NodeProcess;
    applyNodeProcessTerminalBootstrap(proc, {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 80,
      rows: 24,
    });
    expect(proc.stdin.isTTY).toBe(true);
    expect(proc.stdout.isTTY).toBe(true);
    expect(proc.stderr.isTTY).toBe(true);
  });

  it('Node-entry terminal bootstrap ignores colliding guest env without rewriting it', () => {
    const entry = buildNodeEntryWorkerEntry(
      'https://host.test/node-entry.js',
      { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' },
      {
        kind: 'program',
        bin: true,
        remoteFs: true,
        nodeServe: true,
        terminal: {
          stdinIsTTY: false,
          stdoutIsTTY: true,
          stderrIsTTY: true,
          cols: 132,
          rows: 43,
        },
      },
    );
    publishKernelEntryBootstrap(entry.bootstrap ?? null);
    installNodeRuntime(
      spec({
        RIFTY_STDIN_IS_TTY: 'guest-stdin',
        RIFTY_STDOUT_IS_TTY: 'guest-stdout',
        RIFTY_STDERR_IS_TTY: 'guest-stderr',
        RIFTY_TTY_COLS: 'wide',
        RIFTY_TTY_ROWS: 'tall',
      }),
    );

    const proc = (globalThis as { process?: unknown }).process as NodeProcess;
    expect(proc.env).toEqual({
      RIFTY_STDIN_IS_TTY: 'guest-stdin',
      RIFTY_STDOUT_IS_TTY: 'guest-stdout',
      RIFTY_STDERR_IS_TTY: 'guest-stderr',
      RIFTY_TTY_COLS: 'wide',
      RIFTY_TTY_ROWS: 'tall',
    });
    expect(proc.stdin.isTTY).toBe(false);
    expect(proc.stdout).toMatchObject({ isTTY: true, columns: 132, rows: 43 });
    expect(proc.stderr).toMatchObject({ isTTY: true, columns: 132, rows: 43 });
  });

  it('keeps process argv/cwd public when the host launch carries a private remote-FS root', () => {
    const remoteFsRoot = '/.rifty/workbench/v1/projects/project-a/tree';
    const entry = buildNodeEntryWorkerEntry(
      'https://host.test/node-entry.js',
      { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' },
      {
        kind: 'program',
        bin: false,
        remoteFs: true,
        remoteFsRoot,
        nodeServe: true,
      },
    );
    publishKernelEntryBootstrap(entry.bootstrap ?? null);
    const publicSpec = {
      ...spec({ USER_VALUE: 'kept' }),
      argv: ['rifty', '/src/server.js', '--port', '3000'],
      cwd: '/',
    };
    publishKernelProcessSpec(publicSpec);

    installNodeRuntime(publicSpec);

    const proc = (globalThis as { process?: unknown }).process as NodeProcess;
    expect(proc.argv).toEqual(['rifty', '/src/server.js', '--port', '3000']);
    expect(proc.cwd()).toBe('/');
    expect(proc.env).toEqual({ USER_VALUE: 'kept' });
    expect(JSON.stringify({ argv: proc.argv, cwd: proc.cwd(), env: proc.env })).not.toContain(
      remoteFsRoot,
    );
  });

  it('Node worker: TTY stdout exposes cursor helpers and writes ANSI control sequences', async () => {
    const stdout = channel();
    const s = spec();
    const proc = installNodeProcessShim({
      ...s,
      stdio: {
        ...s.stdio,
        stdout: {
          write(bytes) {
            stdout.port1.postMessage(bytes);
          },
        },
      },
    });
    applyNodeProcessTerminalBootstrap(proc, {
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: false,
      cols: 80,
      rows: 24,
    });
    const stream = proc.stdout as typeof proc.stdout & {
      clearLine(dir?: number, cb?: () => void): boolean;
      cursorTo(x: number, y?: number, cb?: () => void): boolean;
      moveCursor(dx: number, dy: number, cb?: () => void): boolean;
      clearScreenDown(cb?: () => void): boolean;
    };
    const nextChunk = new Promise<unknown>((resolve) => {
      stdout.port2.onmessage = (ev) => resolve(ev.data);
      stdout.port2.start();
    });

    expect(typeof stream.clearLine).toBe('function');
    expect(typeof stream.cursorTo).toBe('function');
    expect(typeof stream.moveCursor).toBe('function');
    expect(typeof stream.clearScreenDown).toBe('function');
    expect(stream.clearLine(0)).toBe(true);

    const chunk = await nextChunk;
    expect(new TextDecoder().decode(chunk as Uint8Array)).toBe('\x1b[2K');
  });

  it('Node worker: process.nextTick beats Promise.then (Node ordering)', async () => {
    installNodeRuntime(spec());
    const proc = (globalThis as { process?: unknown }).process as NodeProcess;
    const order: string[] = [];
    await new Promise<void>((resolve) => {
      // .then registered FIRST; nextTick must still run before it.
      Promise.resolve().then(() => {
        order.push('promise');
        resolve();
      });
      proc.nextTick(() => order.push('nextTick'));
    });
    expect(order).toEqual(['nextTick', 'promise']);
  });
});

describe('seeded NodeProcess by construction (ADR-0157)', () => {
  it('carries spec argv/cwd; env is an isolated mutable copy (no leak into the spec)', () => {
    const s = spec({ FOO: 'bar' });
    const proc = installNodeProcessShim(s);
    expect(proc.argv).toEqual(['rifty', '/srv.js', '--port', '4000']);
    expect(proc.cwd()).toBe('/workspace/app');
    // D1 (ADR-0157 review): the fs/path cwd SOURCE (getProcessCwd, read by
    // builtins/fs + path.resolve) is seeded from spec.cwd too — so the loader
    // (process.cwd()) and node:fs relative reads agree at a NON-/workspace cwd.
    // RED-check: drop `currentCwd = spec.cwd` in the NodeProcess ctor → this stays
    // '/workspace' and a child's fs.readFileSync('./x') resolves to the wrong dir.
    expect(getProcessCwd()).toBe('/workspace/app');
    // Node-faithful fds: stdout is 1, stderr is 2 (not both 1).
    expect(proc.stdout.fd).toBe(1);
    expect(proc.stderr.fd).toBe(2);
    expect(proc.env.FOO).toBe('bar');
    proc.env.FOO = 'mutated';
    expect(proc.env.FOO).toBe('mutated');
    expect(s.env.FOO).toBe('bar'); // copy, not by reference
  });

  it('exposes the mutable rich surface that kernel children previously lacked', () => {
    const proc = installNodeProcessShim(spec());
    expect(typeof proc.nextTick).toBe('function');
    expect(typeof proc.hrtime).toBe('function');
    expect(typeof (proc.hrtime as unknown as { bigint?: unknown }).bigint).toBe('function');
    expect(typeof proc.chdir).toBe('function');
    expect(typeof proc.uptime).toBe('function');
    proc.exitCode = 3;
    expect(proc.exitCode).toBe(3);
    expect(() => proc.exit(2)).toThrow(
      expect.objectContaining({ code: 'RIFTY_PROCESS_EXIT', exitCode: 2 }),
    );
  });
});

describe('process.exitCode / exit coercion is Node-faithful (ADR-0157 review)', () => {
  it('the exitCode setter coerces a numeric string (like Node)', () => {
    const proc = installNodeProcessShim(spec());
    proc.exitCode = '7' as unknown as number;
    expect(proc.exitCode).toBe(7);
    proc.exitCode = '0x10' as unknown as number;
    expect(proc.exitCode).toBe(16);
    proc.exitCode = 256; // stored as-is; uint8 wrap happens only at exit
    expect(proc.exitCode).toBe(256);
  });

  it('the exitCode setter THROWS loudly on an invalid value (never silently 0)', () => {
    const proc = installNodeProcessShim(spec());
    expect(() => {
      proc.exitCode = 1.9;
    }).toThrow(expect.objectContaining({ code: 'ERR_OUT_OF_RANGE' }));
    expect(() => {
      proc.exitCode = 'abc' as unknown as number;
    }).toThrow(expect.objectContaining({ code: 'ERR_OUT_OF_RANGE' }));
    expect(() => {
      proc.exitCode = true as unknown as number;
    }).toThrow(expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }));
  });

  it('exit() coerces a string code and uint8-wraps an out-of-range one', () => {
    const proc = installNodeProcessShim(spec());
    expect(() => proc.exit('7' as unknown as number)).toThrow(
      expect.objectContaining({ code: 'RIFTY_PROCESS_EXIT', exitCode: 7 }),
    );
    expect(() => proc.exit(257)).toThrow(
      expect.objectContaining({ code: 'RIFTY_PROCESS_EXIT', exitCode: 1 }),
    );
    // An invalid exit() arg throws the coercion error, NOT a RIFTY_PROCESS_EXIT.
    expect(() => proc.exit(1.9)).toThrow(expect.objectContaining({ code: 'ERR_OUT_OF_RANGE' }));
  });

  it('leaves no test-owned process MessagePort handle active', async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const hostProcess = ORIGINAL_PROCESS as typeof process & {
      _getActiveHandles(): unknown[];
    };
    const handles = hostProcess._getActiveHandles();
    const leaked = [...openChannels]
      .flatMap(({ port1, port2 }) => [port1, port2])
      .filter((port) => handles.includes(port));
    try {
      expect(leaked).toEqual([]);
    } finally {
      for (const value of openChannels) {
        value.port1.close();
        value.port2.close();
      }
      openChannels.clear();
    }
  });
});
