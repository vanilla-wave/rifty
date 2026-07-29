/**
 * Regression: spawned-child process was missing Node identity fields (versions/platform/…).
 * cowsay → yargs reads `process.versions.electron` → TypeError if versions=undefined.
 * (ADR-0150: supervised child worker running a foreground CLI)
 */
import { type KernelProcessSpec, publishKernelEntryBootstrap } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { NODE_ENTRY_BOOTSTRAP_PROTOCOL } from '../builtins/node-entry-runtime-config.ts';
import { installNodeProcessShim } from './install-process.ts';

const originalProcess = (globalThis as { process?: unknown }).process;

function spec(): KernelProcessSpec {
  const stdout = new MessageChannel();
  const stderr = new MessageChannel();
  const stdin = new MessageChannel();
  const ipc = new MessageChannel();
  return {
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env: {},
    cwd: '/workspace',
    stdio: {
      stdout: { write: (bytes) => stdout.port1.postMessage(bytes) },
      stderr: { write: (bytes) => stderr.port1.postMessage(bytes) },
      stdin: stdin.port1,
      ipc: ipc.port1,
    },
  };
}

afterEach(() => {
  publishKernelEntryBootstrap(null);
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
});

describe('installNodeProcessShim identity fields (ADR-0150: supervised child worker)', () => {
  it('exposes versions object so process.versions.electron is defined-access-safe', () => {
    const proc = installNodeProcessShim(spec());
    // Exact cowsay/yargs trigger: reading .electron on undefined versions → TypeError
    expect(proc.versions).toBeDefined();
    expect(Object.hasOwn(proc.versions, 'node')).toBe(true);
    expect(proc.versions.node).toBe('24.0.0');
    expect(proc.versions.electron).toBeUndefined();
  });

  it('exposes all Node identity fields', () => {
    const proc = installNodeProcessShim(spec());
    expect(proc.version).toBe('v24.0.0');
    expect(proc.platform).toBe('rifty');
    expect(proc.arch).toBe('wasm');
    expect(proc.argv0).toBe('rifty');
    expect(proc.execPath).toBe('/usr/local/bin/rifty');
    expect(proc.title).toBe('rifty');
  });

  it('gives each process its own mutable execArgv array', () => {
    const first = installNodeProcessShim(spec()) as ReturnType<typeof installNodeProcessShim> & {
      execArgv: string[];
    };
    const second = installNodeProcessShim(spec()) as ReturnType<typeof installNodeProcessShim> & {
      execArgv: string[];
    };

    expect(first.execArgv).toEqual([]);
    expect(second.execArgv).toEqual([]);

    first.execArgv.push('--trace-warnings');

    expect(first.execArgv).toEqual(['--trace-warnings']);
    expect(second.execArgv).toEqual([]);
  });

  it('copies the exact eval execArgv from the node-entry launch', () => {
    const source = "require('./package.json').name";
    const originalExecArgv = ['--print', source];
    publishKernelEntryBootstrap({
      protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
      payload: {
        hostRuntime: { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' },
        launch: {
          kind: 'eval',
          source,
          print: true,
          execArgv: originalExecArgv,
          remoteFs: true,
        },
      },
    });

    const proc = installNodeProcessShim(spec()) as ReturnType<typeof installNodeProcessShim> & {
      execArgv: string[];
    };
    proc.execArgv.push('--trace-warnings');

    expect(proc.execArgv).toEqual(['--print', source, '--trace-warnings']);
    expect(originalExecArgv).toEqual(['--print', source]);
  });

  it('exposes the exact isolated Node v24.0.0 release identity (ADR-0345)', () => {
    const first = installNodeProcessShim(spec());
    const second = installNodeProcessShim(spec());
    const expected = {
      name: 'node',
      sourceUrl: 'https://nodejs.org/download/release/v24.0.0/node-v24.0.0.tar.gz',
      headersUrl: 'https://nodejs.org/download/release/v24.0.0/node-v24.0.0-headers.tar.gz',
    };

    expect(first.release).toStrictEqual(expected);
    expect(first.release).not.toBe(second.release);
    expect(Reflect.ownKeys(first.release)).toStrictEqual(['name', 'sourceUrl', 'headersUrl']);
    expect(Object.getPrototypeOf(first.release)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(first, 'release')).toStrictEqual({
      value: first.release,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    for (const [key, value] of Object.entries(expected)) {
      expect(Object.getOwnPropertyDescriptor(first.release, key)).toStrictEqual({
        value,
        writable: false,
        enumerable: true,
        configurable: true,
      });
    }
    expect(Object.isExtensible(first.release)).toBe(true);
    expect(Object.isFrozen(first.release)).toBe(false);
    expect(Reflect.deleteProperty(first.release, 'name')).toBe(true);
    expect(second.release).toStrictEqual(expected);
  });
});
