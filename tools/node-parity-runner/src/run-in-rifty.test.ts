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

  it('gives sequential stdin cases a fresh stream lifecycle', async () => {
    const first = await runInRifty({
      stdin: [],
      code: `
        const stdin = require('node:process').stdin;
        stdin.setEncoding('utf8');
        stdin.pause();
        stdin.on('end', () => console.log('first:end'));
      `,
    });

    const second = await runInRifty({
      stdin: [new Uint8Array([0x6f, 0x6b])],
      code: `
        const stdin = require('node:process').stdin;
        console.log(
          'initial:' + stdin.readableEncoding + ':' +
          stdin._readableState.flowing + ':' + stdin.readableEnded,
        );
        stdin.on('data', (chunk) => {
          console.log('data:' + typeof chunk + ':' + Array.from(chunk).join(','));
        });
        stdin.on('end', () => console.log('second:end'));
        stdin.on('error', (err) => console.log('error:' + err.message));
      `,
    });

    expect(first).toBe('first:end\n');
    expect(second).toBe('initial:null:null:false\n' + 'data:object:111,107\n' + 'second:end\n');
  });
});
