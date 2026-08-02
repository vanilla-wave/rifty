/**
 * Regression: spawned-child process was missing Node identity fields (versions/platform/…).
 * cowsay → yargs reads `process.versions.electron` → TypeError if versions=undefined.
 * (ADR-0150: supervised child worker running a foreground CLI)
 */
import type { KernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('exposes the exact isolated Node v24.0.0 release identity (ADR-0345)', () => {
    const first = installNodeProcessShim(spec());
    const second = installNodeProcessShim(spec());
    const expected = {
      name: 'node',
      sourceUrl: 'https://nodejs.org/download/release/v24.0.0/node-v24.0.0.tar.gz',
      headersUrl:
        'https://nodejs.org/download/release/v24.0.0/node-v24.0.0-headers.tar.gz',
    };

    expect(first.release).toEqual(expected);
    expect(first.release).not.toBe(second.release);
    expect(Object.getOwnPropertyDescriptor(first, 'release')).toMatchObject({
      writable: false,
      enumerable: true,
      configurable: true,
    });
    for (const key of Object.keys(expected)) {
      expect(Object.getOwnPropertyDescriptor(first.release, key)).toMatchObject({
        writable: false,
        enumerable: true,
        configurable: true,
      });
    }
    expect(Object.isExtensible(first.release)).toBe(true);
    expect(Object.isFrozen(first.release)).toBe(false);
    expect(Reflect.deleteProperty(first.release, 'name')).toBe(true);
    expect(second.release).toEqual(expected);
  });
});
