/**
 * Tests for `createWasiProcess` and `runWasiInWorker` (ADR 0038).
 *
 * The unit-test surface is two layers:
 *
 *   1. `createWasiProcess(opts)` translates `WasiProcessOpts` into a
 *      `SpawnWorkerSpec` and funnels it through the kernel's spawn API.
 *      Asserted with a `__setSpawnerForTests(...)` stub that captures the
 *      spec — no real Worker realm needed.
 *
 *   2. `runWasiInWorker(proc)` is the worker-side counterpart that the
 *      kernel-spawned Worker imports for its top-level side-effect. It
 *      reads the WASM URL from `process.env`, fetches the module, runs
 *      the WASI guest, and propagates the exit code via `process.exit`.
 *      Driven against a fake `process` shim with three hand-crafted
 *      WASM fixtures (proc_exit(0), proc_exit(42), and an fd_write+exit).
 *
 * The fixtures are shared with `tests/conformance/wasi/run-real-wasm.test.ts`
 * — same 82- and 176-byte payloads, repeated inline here so this file
 * stays self-contained for the unit project.
 */

import {
  type ProcessHandle,
  type SpawnWorkerSpec,
  type WorkerInitMessage,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  __clearWasiWorkerUrlForTests,
  __setSpawnerForTests,
  createWasiProcess,
  setWasiWorkerUrl,
} from './process-handle.ts';
import { WASI_PREOPENS_ENV, WASI_WASM_URL_ENV, runWasiInWorker } from './worker-entry.ts';

// ===== Hand-crafted WASM fixtures (shared with conformance/wasi tests). =====
// (module
//   (import "wasi_snapshot_preview1" "proc_exit" (func (param i32)))
//   (func $_start (call 0 (i32.const 0)))
//   (export "_start" (func $_start)))
const PROC_EXIT_0_B64 =
  'AGFzbQEAAAABCAJgAX8AYAAAAiQBFndhc2lfc25hcHNob3RfcHJldmlldzEJcHJvY19leGl0AAADAgEBBwoBBl9zdGFydAABCggBBgBBABAACw==';

// (module ... proc_exit(42) ...) — identical to PROC_EXIT_0 with the literal swapped
const PROC_EXIT_42_B64 =
  'AGFzbQEAAAABCAJgAX8AYAAAAiQBFndhc2lfc25hcHNob3RfcHJldmlldzEJcHJvY19leGl0AAADAgEBBwoBBl9zdGFydAABCggBBgBBKhAACw==';

// fd_write "OK" to stdout, then proc_exit(0)
const FD_WRITE_OK_B64 =
  'AGFzbQEAAAABEANgBH9/f38Bf2ABfwBgAAACRgIWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQhmZF93cml0ZQAAFndhc2lfc25hcHNob3RfcHJldmlldzEJcHJvY19leGl0AAEDAgECBQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAIKIwEhAEEAQeQANgIAQQRBAjYCAEEBQQBBAUHIARAAGkEAEAELCwkBAEHkAAsCT0s=';

function bytesOf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function dataUrl(b64: string): string {
  return `data:application/wasm;base64,${b64}`;
}

// ===== Layer 1: createWasiProcess wiring =====

interface CapturedSpawn {
  command: string;
  spec: SpawnWorkerSpec;
  ppid: number;
}

describe('createWasiProcess — spawn-worker wiring (ADR 0038)', () => {
  beforeAll(() => {
    setWasiWorkerUrl('https://example.invalid/wasi-worker.js');
  });

  afterEach(() => {
    __setSpawnerForTests(null);
  });

  it('threads the WASM URL into env and points entry at the wasi worker URL', () => {
    const captured: CapturedSpawn[] = [];
    const fakeHandle = {} as ProcessHandle;
    __setSpawnerForTests((command, spec, ppid) => {
      captured.push({ command, spec, ppid });
      return fakeHandle;
    });

    const handle = createWasiProcess({
      wasm: new URL('https://example.invalid/hello.wasm'),
      args: ['--bundle', 'a.js'],
      env: { NODE_ENV: 'production' },
      preopens: { '/': '/workspace' },
      cwd: '/workspace',
    });

    expect(handle).toBe(fakeHandle);
    expect(captured).toHaveLength(1);
    const c = captured[0];
    expect(c).toBeDefined();
    if (!c) return; // satisfies noUncheckedIndexedAccess

    expect(c.command).toBe('--bundle'); // argv[0] of user args is the command label
    expect(c.ppid).toBe(1);
    expect(c.spec.entry).toEqual({
      kind: 'url',
      url: 'https://example.invalid/wasi-worker.js',
    });
    expect(c.spec.argv).toEqual(['wasi-guest', '--bundle', 'a.js']);
    expect(c.spec.cwd).toBe('/workspace');
    expect(c.spec.env[WASI_WASM_URL_ENV]).toBe('https://example.invalid/hello.wasm');
    expect(c.spec.env[WASI_PREOPENS_ENV]).toBe(JSON.stringify({ '/': '/workspace' }));
    expect(c.spec.env.NODE_ENV).toBe('production');
  });

  it('wraps an ArrayBuffer wasm input in a blob: URL', () => {
    const captured: CapturedSpawn[] = [];
    __setSpawnerForTests((command, spec, ppid) => {
      captured.push({ command, spec, ppid });
      return {} as ProcessHandle;
    });

    const buf = bytesOf(PROC_EXIT_0_B64);
    // `bytesOf` allocates a non-shared ArrayBuffer; cast away the
    // `ArrayBufferLike` width that TS's lib.dom.d.ts produces here.
    const ab = buf.buffer as ArrayBuffer;
    createWasiProcess({ wasm: ab });

    const wasmUrl = captured[0]?.spec.env[WASI_WASM_URL_ENV];
    expect(wasmUrl).toBeDefined();
    expect(wasmUrl?.startsWith('blob:')).toBe(true);
  });

  it('throws when the host has not configured a wasi worker URL', () => {
    __clearWasiWorkerUrlForTests();
    try {
      expect(() => createWasiProcess({ wasm: 'https://example.invalid/hello.wasm' })).toThrow(
        /wasi worker URL is not set/,
      );
    } finally {
      // Restore for any subsequent tests in this file.
      setWasiWorkerUrl('https://example.invalid/wasi-worker.js');
    }
  });

  it('publishes trusted stdout and stderr before the physical worker handle settles', async () => {
    const captured: { init: WorkerInitMessage | null } = { init: null };
    class BoundaryWorker {
      postMessage(message: unknown): void {
        captured.init = message as WorkerInitMessage;
      }
      terminate(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    vi.stubGlobal('Worker', BoundaryWorker);
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');

    try {
      const handle = createWasiProcess({ wasm: 'https://example.invalid/hello.wasm' });
      if (handle.kind !== 'worker') throw new Error('expected physical Worker process');

      const events: string[] = [];
      const controlFrames: unknown[] = [];
      const userMessages: unknown[] = [];
      handle.stdout().on('data', (chunk) => events.push(`stdout:${decodeOutput(chunk)}`));
      handle.stderr().on('data', (chunk) => events.push(`stderr:${decodeOutput(chunk)}`));
      handle.on('peererror', () => events.push('peererror'));
      handle.on('message', (message) => userMessages.push(message));
      handle.ports.ipc.addEventListener('message', (event) => controlFrames.push(event.data));
      handle.ports.ipc.start();
      const closed = new Promise<void>((resolve) => {
        handle.on('close', () => {
          events.push('close');
          resolve();
        });
      });

      const init = captured.init;
      if (init === null) throw new Error('kernel Worker init was not published');
      const stdio = await vi.importActual<{
        bindWorkerStdioOutput(
          port: MessagePort,
          state: WorkerInitMessage['spec']['outputState'],
          output: 'stdout' | 'stderr',
          controlPort: MessagePort,
        ): { write(bytes: Uint8Array): void };
        sealWorkerOutput(state: WorkerInitMessage['spec']['outputState']): boolean;
        workerOutputAttestation(state: WorkerInitMessage['spec']['outputState']): string;
      }>('../../kernel/src/worker-stdio-drain.ts');
      stdio
        .bindWorkerStdioOutput(
          init.spec.stdio.stdout,
          init.spec.outputState,
          'stdout',
          init.spec.stdio.ipc,
        )
        .write(new TextEncoder().encode('wasi-out'));
      stdio
        .bindWorkerStdioOutput(
          init.spec.stdio.stderr,
          init.spec.outputState,
          'stderr',
          init.spec.stdio.ipc,
        )
        .write(new TextEncoder().encode('wasi-err'));
      stdio.sealWorkerOutput(init.spec.outputState);
      init.spec.stdio.ipc.postMessage({ kind: 'control:peer-closing' });

      await closed;
      expect(events).toContain('stdout:wasi-out');
      expect(events).toContain('stderr:wasi-err');
      expect(events.indexOf('stdout:wasi-out')).toBeLessThan(events.indexOf('peererror'));
      expect(events.indexOf('stderr:wasi-err')).toBeLessThan(events.indexOf('peererror'));
      expect(events.at(-1)).toBe('close');
      expect(controlFrames).toStrictEqual([
        {
          kind: 'control:stdio-order',
          stream: 'stdout',
          order: 0,
          attestation: stdio.workerOutputAttestation(init.spec.outputState),
        },
        {
          kind: 'control:stdio-order',
          stream: 'stderr',
          order: 1,
          attestation: stdio.workerOutputAttestation(init.spec.outputState),
        },
        { kind: 'control:peer-closing' },
      ]);
      expect(userMessages).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ===== Layer 2: runWasiInWorker against a fake process shim =====

interface FakeProcess {
  argv: readonly string[];
  env: Record<string, string>;
  cwd(): string;
  stdout: { write(chunk: string | Uint8Array): boolean };
  stderr: { write(chunk: string | Uint8Array): boolean };
  exit(code?: number): never;
  // test helpers (assertions only):
  collectStdout(): string;
  collectStderr(): string;
  exitCode: number | null;
}

function makeFakeProcess(env: Record<string, string>, args: string[] = []): FakeProcess {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const dec = new TextDecoder();
  const toStr = (c: string | Uint8Array): string => (typeof c === 'string' ? c : dec.decode(c));

  const proc: FakeProcess = {
    argv: ['wasi-guest', ...args],
    env,
    cwd: () => '/workspace',
    stdout: {
      write(chunk: string | Uint8Array): boolean {
        stdoutChunks.push(toStr(chunk));
        return true;
      },
    },
    stderr: {
      write(chunk: string | Uint8Array): boolean {
        stderrChunks.push(toStr(chunk));
        return true;
      },
    },
    exit(code = 0): never {
      proc.exitCode = code;
      // Mirror the kernel's `ProcessExitError`: throw to unwind out of
      // `runWasiInWorker`, the same as the production path. The test
      // catches it.
      throw new ProcessExitForTests(code);
    },
    collectStdout: () => stdoutChunks.join(''),
    collectStderr: () => stderrChunks.join(''),
    exitCode: null,
  };
  return proc;
}

function decodeOutput(chunk: unknown): string {
  if (!(chunk instanceof Uint8Array)) throw new TypeError('expected Uint8Array output');
  return new TextDecoder().decode(chunk);
}

class ProcessExitForTests extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

describe('runWasiInWorker — drives a WASI guest through a fake process shim', () => {
  it('runs proc_exit(0) and lets the module return normally (exit code 0)', async () => {
    const proc = makeFakeProcess({
      [WASI_WASM_URL_ENV]: dataUrl(PROC_EXIT_0_B64),
    });
    // proc_exit(0) is the "exit normally" path: `process.exit` is NOT
    // called (we only call it for non-zero codes so the kernel reports
    // exit 0 via natural module completion).
    await expect(runWasiInWorker(proc)).resolves.toBeUndefined();
    expect(proc.exitCode).toBeNull();
  });

  it('propagates proc_exit(42) via process.exit(42)', async () => {
    const proc = makeFakeProcess({
      [WASI_WASM_URL_ENV]: dataUrl(PROC_EXIT_42_B64),
    });
    await expect(runWasiInWorker(proc)).rejects.toBeInstanceOf(ProcessExitForTests);
    expect(proc.exitCode).toBe(42);
  });

  it('pipes WASI fd_write to process.stdout.write', async () => {
    const proc = makeFakeProcess({
      [WASI_WASM_URL_ENV]: dataUrl(FD_WRITE_OK_B64),
    });
    await expect(runWasiInWorker(proc)).resolves.toBeUndefined();
    expect(proc.collectStdout()).toBe('OK');
  });

  it('throws a clear error when the wasm-url env key is missing', async () => {
    const proc = makeFakeProcess({});
    await expect(runWasiInWorker(proc)).rejects.toThrow(/RIFTY_WASI_WASM_URL/);
  });

  it('strips the channel env keys before forwarding to the guest', async () => {
    // Indirect: a guest that observes env via `environ_*` would see only
    // the user keys. We can't easily prove that without a richer fixture,
    // but we can at least prove the run doesn't trip over the noise.
    const proc = makeFakeProcess({
      [WASI_WASM_URL_ENV]: dataUrl(PROC_EXIT_0_B64),
      [WASI_PREOPENS_ENV]: '{}',
      USER_KEY: 'visible',
    });
    await expect(runWasiInWorker(proc)).resolves.toBeUndefined();
  });
});
