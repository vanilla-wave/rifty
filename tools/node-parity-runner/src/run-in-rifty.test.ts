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
});
