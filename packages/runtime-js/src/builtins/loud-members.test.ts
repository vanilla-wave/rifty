/**
 * Rifty ceiling contract, not Node parity (Node returns host disk/heap/child
 * values the browser realm cannot supply): the Node-own members vitest 4.1.11
 * links or binds at load — `fs.statfsSync`, `child_process.spawnSync`,
 * `process.memoryUsage` with its own `rss` — throw a named
 * `NotImplementedError` when called, never a fabricated value. Their shape is
 * parity-pinned by `modules/builtin-loud-members-link` and
 * `child_process/pool-worker-loud-members`.
 */
import { describe, expect, it } from 'vitest';
import { ensureRuntimeJsBuiltinsRegistered, loadBuiltin } from './index.ts';
import { NodeProcess } from './process.ts';

type Callable = (...args: unknown[]) => unknown;

function member(owner: unknown, key: string): Callable {
  const value = (owner as Record<string, unknown>)[key];
  if (typeof value !== 'function') {
    throw new TypeError(`expected ${key} to be a function, got ${typeof value}`);
  }
  return value as Callable;
}

function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectNamedThrow(call: () => unknown, feature: string): void {
  const error = thrownBy(call);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ name: 'NotImplementedError', feature });
  expect((error as Error).message.startsWith(`Not implemented: ${feature}`)).toBe(true);
}

describe('browser-unsuppliable Node members are named loud throws', () => {
  ensureRuntimeJsBuiltinsRegistered();

  it('fs.statfsSync throws NotImplementedError("fs.statfsSync")', () => {
    const statfsSync = member(loadBuiltin('node:fs'), 'statfsSync');
    expectNamedThrow(() => statfsSync('/tmp'), 'fs.statfsSync');
  });

  it('child_process.spawnSync throws NotImplementedError("child_process.spawnSync")', () => {
    const spawnSync = member(loadBuiltin('node:child_process'), 'spawnSync');
    expectNamedThrow(() => spawnSync('git', ['diff', '--name-only']), 'child_process.spawnSync');
  });

  it('process.memoryUsage and its bound form throw NotImplementedError("process.memoryUsage")', () => {
    const process = loadBuiltin('node:process');
    const memoryUsage = member(process, 'memoryUsage');
    expectNamedThrow(() => memoryUsage(), 'process.memoryUsage');
    // vitest 4.1.11 worker init: `const memoryUsage = process.memoryUsage.bind(process)`.
    const bound = memoryUsage.bind(process);
    expectNamedThrow(() => bound(), 'process.memoryUsage');
  });

  it('process.memoryUsage.rss throws NotImplementedError("process.memoryUsage.rss")', () => {
    const rss = member(member(loadBuiltin('node:process'), 'memoryUsage'), 'rss');
    expectNamedThrow(() => rss(), 'process.memoryUsage.rss');
  });

  it('a kernel-seeded NodeProcess carries the same loud member', () => {
    const memoryUsage = member(new NodeProcess(), 'memoryUsage');
    expectNamedThrow(() => memoryUsage(), 'process.memoryUsage');
  });
});
