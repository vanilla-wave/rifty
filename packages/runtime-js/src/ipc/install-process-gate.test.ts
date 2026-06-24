/**
 * ADR-0157 — the Node-worker GATE at the pre-entry seam + by-construction process.
 *
 * `installNodeRuntime(spec)` installs ONE seeded process for every kernel worker;
 * the rich extras (`globalThis.Buffer` + the `Promise.prototype.then` nextTick
 * patch) are gated to NODE workers. A WASI worker (`spec.env.__RIFTY_WASI_WASM_URL`)
 * must get NEITHER — no Node over-implementation where it shouldn't be.
 *
 * Capture native `Promise.prototype.then` at module load (the patch is global +
 * irreversible per realm), so the WASI test — which MUST run before the Node test
 * patches the realm — asserts it stayed native. `isolate: true` (vitest default)
 * gives this file a fresh realm.
 */
import type { WorkerSpawnSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { Buffer as RiftyBuffer } from '../builtins/buffer.ts';
import { NodeProcess, getProcessCwd } from '../builtins/process.ts';
import { installNodeProcessShim, installNodeRuntime } from './install-process.ts';

const NATIVE_THEN = Promise.prototype.then;
const ORIGINAL_PROCESS = (globalThis as { process?: unknown }).process;
const ORIGINAL_BUFFER = (globalThis as { Buffer?: unknown }).Buffer;
const ORIGINAL_GLOBAL = (globalThis as { global?: unknown }).global;

function spec(env: Record<string, string> = {}): WorkerSpawnSpec {
  const port = (): MessagePort => new MessageChannel().port1;
  return {
    pid: 7,
    ppid: 3,
    argv: ['rifty', '/srv.js', '--port', '4000'],
    env,
    cwd: '/workspace/app',
    stdio: { stdout: port(), stderr: port(), stdin: port(), ipc: port() },
  } as unknown as WorkerSpawnSpec;
}

afterEach(() => {
  Object.defineProperty(globalThis, 'process', {
    value: ORIGINAL_PROCESS,
    writable: true,
    configurable: true,
  });
  (globalThis as { Buffer?: unknown }).Buffer = ORIGINAL_BUFFER;
  (globalThis as { global?: unknown }).global = ORIGINAL_GLOBAL;
});

describe('pre-entry gate (ADR-0157)', () => {
  // MUST be first: asserts the realm is still un-patched.
  it('WASI worker: seeds the process but installs NO Buffer / NO Promise patch', () => {
    installNodeRuntime(spec({ __RIFTY_WASI_WASM_URL: 'https://x/app.wasm' }));
    expect((globalThis as { process?: unknown }).process).toBeInstanceOf(NodeProcess);
    // NEGATIVE: no Node over-implementation for a non-Node worker.
    expect(Promise.prototype.then).toBe(NATIVE_THEN);
    expect((globalThis as { Buffer?: unknown }).Buffer).not.toBe(RiftyBuffer);
    expect((globalThis as { global?: unknown }).global).toBe(ORIGINAL_GLOBAL);
  });

  it('Node worker: seeds the process AND installs Buffer + global + the nextTick Promise patch', () => {
    (globalThis as { global?: unknown }).global = undefined;
    installNodeRuntime(spec());
    expect((globalThis as { process?: unknown }).process).toBeInstanceOf(NodeProcess);
    expect(Promise.prototype.then).not.toBe(NATIVE_THEN);
    expect((globalThis as { Buffer?: unknown }).Buffer).toBe(RiftyBuffer);
    expect((globalThis as { global?: unknown }).global).toBe(globalThis);
  });

  it('Node worker: maps kernel TTY metadata onto process stdio streams', () => {
    installNodeRuntime(
      spec({
        RIFTY_STDIN_IS_TTY: '1',
        RIFTY_STDOUT_IS_TTY: '1',
        RIFTY_STDERR_IS_TTY: '1',
      }),
    );
    const proc = (globalThis as { process?: unknown }).process as NodeProcess;
    expect(proc.stdin.isTTY).toBe(true);
    expect(proc.stdout.isTTY).toBe(true);
    expect(proc.stderr.isTTY).toBe(true);
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
});
