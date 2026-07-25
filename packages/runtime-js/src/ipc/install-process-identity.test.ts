/**
 * Regression: spawned-child process was missing Node identity fields (versions/platform/…).
 * cowsay → yargs reads `process.versions.electron` → TypeError if versions=undefined.
 * (ADR-0150: supervised child worker running a foreground CLI)
 */
import { loadBuiltin } from '@riftydev/io';
import type { KernelProcessSpec } from '@riftydev/kernel';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureRuntimeJsBuiltinsRegistered,
  refreshRuntimeJsProcessBuiltin,
} from '../builtins/index.ts';
import { NodeProcess } from '../builtins/process.ts';
import { createModuleLoader } from '../module-loader/loader.ts';
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
      stdout: stdout.port1,
      stderr: stderr.port1,
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
  refreshRuntimeJsProcessBuiltin();
});

describe('installNodeProcessShim identity fields (ADR-0150: supervised child worker)', () => {
  it('exposes versions object so process.versions.electron is defined-access-safe', () => {
    const proc = installNodeProcessShim(spec());
    // Exact cowsay/yargs trigger: reading .electron on undefined versions → TypeError
    expect(proc.versions).toBeDefined();
    expect(proc.versions.node).toBe('24.0.0');
    expect(proc.versions.electron).toBeUndefined();
  });

  it('exposes all Node identity fields', () => {
    const proc = installNodeProcessShim(spec());
    expect(proc.version).toBe('v24.0.0');
    expect(proc.versions.rifty).toBe('0.0.0');
    expect(proc.platform).toBe('rifty');
    expect(proc.arch).toBe('wasm');
    expect(proc.argv0).toBe('rifty');
    expect(proc.execPath).toBe('/usr/local/bin/rifty');
    expect(proc.title).toBe('rifty');
  });

  it('exposes the descriptor-correct process.release on the live node:process module', () => {
    const proc = installNodeProcessShim(spec());
    ensureRuntimeJsBuiltinsRegistered();
    refreshRuntimeJsProcessBuiltin();

    const release = (proc as typeof proc & { release: { name: string } }).release;
    const processModule = loadBuiltin('node:process');
    expect(processModule).toBe(proc);
    expect(processModule?.versions).toMatchObject({ node: '24.0.0', rifty: '0.0.0' });
    expect(release).toEqual({ name: 'node' });
    expect(Object.getOwnPropertyDescriptor(proc, 'release')).toEqual({
      value: release,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    expect(Object.getOwnPropertyDescriptor(release, 'name')).toEqual({
      value: 'node',
      writable: false,
      enumerable: true,
      configurable: true,
    });
  });

  it.each([
    [
      'no-spec',
      () => {
        const proc = new NodeProcess();
        Object.defineProperty(globalThis, 'process', {
          value: proc,
          writable: true,
          configurable: true,
          enumerable: false,
        });
        return proc;
      },
    ],
    ['kernel-spec', () => installNodeProcessShim(spec())],
  ])(
    'executes the exact Sass selector through every process alias in a %s realm',
    (_realm, seedProcess) => {
      const proc = seedProcess();
      ensureRuntimeJsBuiltinsRegistered();
      refreshRuntimeJsProcessBuiltin();

      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/entry.cjs': `
          const bareProcess = require('process');
          const nodeProcess = require('node:process');
          module.exports = {
            sassSelector: process.release.name === 'node',
            globalIsBare: process === bareProcess,
            globalIsNode: process === nodeProcess,
            sharedRelease:
              process.release === bareProcess.release &&
              process.release === nodeProcess.release,
          };
        `,
      });

      const observation = createModuleLoader(vfs, { cwd: '/' }).require(
        '/entry.cjs',
        '/__entry.cjs',
      );
      expect(observation).toEqual({
        sassSelector: true,
        globalIsBare: true,
        globalIsNode: true,
        sharedRelease: true,
      });
      expect(loadBuiltin('process')).toBe(proc);
      expect(loadBuiltin('node:process')).toBe(proc);
    },
  );
});
