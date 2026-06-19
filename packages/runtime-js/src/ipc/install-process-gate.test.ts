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
import { NodeProcess } from '../builtins/process.ts';
import { installNodeProcessShim, installNodeRuntime } from './install-process.ts';

const NATIVE_THEN = Promise.prototype.then;
const ORIGINAL_PROCESS = (globalThis as { process?: unknown }).process;
const ORIGINAL_BUFFER = (globalThis as { Buffer?: unknown }).Buffer;

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
});

describe('pre-entry gate (ADR-0157)', () => {
  // MUST be first: asserts the realm is still un-patched.
  it('WASI worker: seeds the process but installs NO Buffer / NO Promise patch', () => {
    installNodeRuntime(spec({ __RIFTY_WASI_WASM_URL: 'https://x/app.wasm' }));
    expect((globalThis as { process?: unknown }).process).toBeInstanceOf(NodeProcess);
    // NEGATIVE: no Node over-implementation for a non-Node worker.
    expect(Promise.prototype.then).toBe(NATIVE_THEN);
    expect((globalThis as { Buffer?: unknown }).Buffer).not.toBe(RiftyBuffer);
  });

  it('Node worker: seeds the process AND installs Buffer + the nextTick Promise patch', () => {
    installNodeRuntime(spec());
    expect((globalThis as { process?: unknown }).process).toBeInstanceOf(NodeProcess);
    expect(Promise.prototype.then).not.toBe(NATIVE_THEN);
    expect((globalThis as { Buffer?: unknown }).Buffer).toBe(RiftyBuffer);
  });

  it('Node worker: process.nextTick beats Promise.then (Node ordering)', async () => {
    installNodeRuntime(spec());
    const proc = (globalThis as { process: NodeProcess }).process;
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
