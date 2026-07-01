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
});
