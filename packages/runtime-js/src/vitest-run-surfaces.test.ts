import { Readable } from '@riftydev/io';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { spawnSync } from './builtins/child_process.ts';
import { fork } from './builtins/child_process.ts';
import { writeFileSync } from './builtins/fs.ts';
import { loadBuiltin } from './builtins/index.ts';
import { riftyProcess } from './builtins/process.ts';
import { setTimeout as nodeSetTimeout } from './builtins/timers.ts';
import { runInThisContext } from './builtins/vm/index.ts';
import { Worker } from './builtins/worker_threads.ts';
import { activeRefs } from './internal/event-loop-keepalive.ts';
import { createModuleLoader } from './module-loader/loader.ts';

describe('vitest run surfaces', () => {
  it('links node:path/posix, node:path/win32, and import { cwd } from node:process', async () => {
    const posix = loadBuiltin('path/posix') as { join: (...p: string[]) => string };
    const win32 = loadBuiltin('path/win32') as { join: (...p: string[]) => string };
    expect(posix.join('a', 'b')).toBe('a/b');
    expect(win32.join('a', 'b')).toBe('a/b');
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/main.mjs': `import { cwd } from 'node:process'; export const kind = typeof cwd;`,
    });
    const ns = await createModuleLoader(vfs).import('/main.mjs');
    expect(ns.kind).toBe('function');
  });

  it('exposes statfsSync, spawnSync, and memoryUsage as loud functions', () => {
    const fs = loadBuiltin('fs') as { statfsSync: () => never };
    expect(typeof fs.statfsSync).toBe('function');
    expect(typeof spawnSync).toBe('function');
    expect(typeof riftyProcess.memoryUsage).toBe('function');
    expect(() => fs.statfsSync()).toThrow(/fs\.statfsSync/);
    expect(() => spawnSync()).toThrow(/child_process\.spawnSync/);
    expect(() => riftyProcess.memoryUsage()).toThrow(/process\.memoryUsage/);
  });

  it('accepts a const Symbol key write on globalThis from ESM and CJS', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/main.mjs': `
        const SAFE = Symbol.for('rifty.test.symbol-key');
        globalThis[SAFE] = { ok: true };
        export const ok = globalThis[SAFE].ok;
      `,
      '/def.cjs': `
        const key = Symbol.for('undici.globalDispatcher.2');
        Object.defineProperty(globalThis, key, { value: 7, configurable: true });
        module.exports = globalThis[key];
      `,
    });
    const loader = createModuleLoader(vfs);
    const ns = await loader.import('/main.mjs');
    expect(ns.ok).toBe(true);
    expect(loader.require('/def.cjs', '/entry.cjs')).toBe(7);
    const defines = new MemoryFsSync();
    defines.loadFixture({
      '/defines.mjs': `
        const config = { MODE: 'test' };
        for (const key in config) globalThis[key] = config[key];
        const prop = 'STUB';
        Object.defineProperty(globalThis, prop, { value: 1, configurable: true });
        export const mode = globalThis.MODE;
        export const stub = globalThis.STUB;
      `,
    });
    const defined = await createModuleLoader(defines).import('/defines.mjs');
    expect(defined.mode).toBe('test');
    expect(defined.stub).toBe(1);
  });

  it('does not end process.stdout when a readable pipes into it', async () => {
    const chunks: string[] = [];
    const stdout = riftyProcess.stdout as { write: (chunk: string) => boolean; fd: number };
    const original = stdout.write.bind(stdout);
    stdout.write = (chunk: string) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      await new Promise<void>((resolve) => {
        Readable.from(['a\n']).pipe(stdout as never);
        nodeSetTimeout(() => resolve(), 20);
      });
      stdout.write('still-writable\n');
      expect(chunks.join('')).toContain('a');
      expect(chunks.join('')).toContain('still-writable');
    } finally {
      stdout.write = original;
    }
  });

  it('process.exit() uses process.exitCode and emits exit', () => {
    const codes: number[] = [];
    riftyProcess.once('exit', (...args: unknown[]) => {
      codes.push(args[0] as number);
    });
    riftyProcess.exitCode = 3;
    expect(() => riftyProcess.exit()).toThrow(expect.objectContaining({ exitCode: 3 }));
    expect(codes).toEqual([3]);
    riftyProcess.exitCode = 0;
  });

  it('shifts vm stack locations by lineOffset and columnOffset', () => {
    let stack = '';
    try {
      runInThisContext('throw new Error("boom")', {
        filename: '/virtual/mod.js',
        columnOffset: -20,
      });
    } catch (error) {
      stack = (error as Error).stack ?? '';
    }
    expect(stack).toContain('/virtual/mod.js:1:1');
    try {
      runInThisContext('function f(){ throw new Error("boom"); }\nf()', {
        filename: '/virtual/mod2.js',
        lineOffset: 10,
        columnOffset: 5,
      });
    } catch (error) {
      stack = (error as Error).stack ?? '';
    }
    expect(stack).toMatch(/\/virtual\/mod2\.js:1[12]:/);
  });

  it('a timer throw reaches uncaughtException and the process continues', async () => {
    const seen: string[] = [];
    const onUncaught = (...args: unknown[]) => {
      seen.push((args[0] as Error).message);
    };
    riftyProcess.on('uncaughtException', onUncaught);
    try {
      nodeSetTimeout(() => {
        throw new Error('boom');
      }, 0);
      await new Promise<void>((resolve) => {
        nodeSetTimeout(() => resolve(), 30);
      });
      expect(seen).toEqual(['boom']);
    } finally {
      riftyProcess.off('uncaughtException', onUncaught);
    }
  });

  it('accepts an explicit empty execArgv and a stdout Readable', async () => {
    writeFileSync('/worker-stdio.js', 'parentPort.postMessage(1);');
    const before = activeRefs();
    const worker = new Worker('/worker-stdio.js', {
      execArgv: [],
      stdout: true,
      stderr: true,
    });
    expect(activeRefs()).toBe(before + 1);
    expect(typeof worker.stdout?.pipe).toBe('function');
    worker.unref();
    expect(activeRefs()).toBe(before);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker did not exit')), 2000);
      worker.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      worker.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  });

  it('round-trips advanced ipc values and rejects a function', async () => {
    writeFileSync(
      '/child-adv.cjs',
      `
        process.on('message', (value) => {
          process.send({
            date: value.date instanceof Date,
            map: value.map instanceof Map,
            hole: value.list[0] === undefined,
            bytes: value.bytes instanceof Uint8Array,
          });
          process.exit(0);
        });
      `,
    );
    const child = fork('/child-adv.cjs', [], { serialization: 'advanced', stdio: 'pipe' });
    const reply = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('advanced ipc timed out')), 3000);
      child.on('message', (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    expect(() => child.send?.(() => {})).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
    );
    child.send?.({
      date: new Date('2020-01-01T00:00:00.000Z'),
      map: new Map([['a', 1]]),
      list: [undefined],
      bytes: new Uint8Array([1, 2]),
    });
    await expect(reply).resolves.toEqual({ date: true, map: true, hole: true, bytes: true });
  });
});
