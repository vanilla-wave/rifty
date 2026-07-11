import { getProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { describe, expect, it } from 'vitest';
import { runInRifty } from './run-in-rifty.ts';

describe('runInRifty', () => {
  it('waits for keepalive-backed timers before restoring console capture', async () => {
    const stdout = await runInRifty({
      code: `
        const { setTimeout } = require('node:timers/promises');
        (async () => {
          await setTimeout(35);
          console.log('after-drain');
        })();
      `,
    });

    expect(stdout).toBe('after-drain\n');
  });

  it('tracks global timers instead of truncating async output after a fixed grace', async () => {
    const stdout = await runInRifty({
      code: `
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 75));
          console.log('after-global-timer');
        })();
      `,
    });

    expect(stdout).toBe('after-global-timer\n');
  });

  it('exec-sync mode surfaces missing child scripts as ENOENT through the runtime handler', async () => {
    const stdout = await runInRifty({
      kind: 'exec-sync',
      code: `
        const { execSync } = require('node:child_process');
        try {
          execSync('node missing.js', { cwd: '/' });
        } catch (err) {
          console.log(err.code);
        }
      `,
    });

    expect(stdout).toBe('ENOENT\n');
  });

  it('tty-resize mode drives a seeded process and restores globals plus cwd', async () => {
    // Reproduce the CLI's sequential-case order: an earlier default case loads
    // and process-wide-caches `node:process` before the TTY mode swaps realms.
    await runInRifty({ code: `require('node:process');` });

    const priorProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
    const priorResize = Object.getOwnPropertyDescriptor(globalThis, '__riftyTtyResize');
    const priorCwd = getProcessCwd();
    const sentinel = (): void => {};
    Object.defineProperty(globalThis, '__riftyTtyResize', {
      value: sentinel,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    const sentinelDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__riftyTtyResize');

    try {
      const stdout = await runInRifty({
        kind: 'tty-resize',
        cwd: '/tty-case',
        code: `
          const process = require('node:process');
          const events = [];
          process.stdout.on('resize', () => events.push('stdout'));
          process.stderr.on('resize', () => events.push('stderr'));
          process.on('SIGWINCH', () => events.push('SIGWINCH'));
          globalThis.__riftyTtyResize(120, 40);
          setTimeout(() => console.log(
            process.cwd() + ':' + process.stdout.getWindowSize().join('x') + ':' + events.join(','),
          ), 20);
        `,
      });

      expect(stdout).toBe('/tty-case:120x40:stdout,stderr,SIGWINCH\n');
      expect(Object.getOwnPropertyDescriptor(globalThis, 'process')).toEqual(priorProcess);
      expect(Object.getOwnPropertyDescriptor(globalThis, '__riftyTtyResize')).toEqual(
        sentinelDescriptor,
      );
      expect(getProcessCwd()).toBe(priorCwd);
    } finally {
      if (priorResize) Object.defineProperty(globalThis, '__riftyTtyResize', priorResize);
      else Reflect.deleteProperty(globalThis, '__riftyTtyResize');
    }
  });
});
