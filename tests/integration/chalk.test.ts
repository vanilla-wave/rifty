import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
/**
 * Real-package integration smoke: chalk-style ANSI helper through the loader.
 *
 * We use a hand-crafted fixture (not the actual chalk tarball — that arrives
 * with M9). It mirrors chalk's public API: `chalk.red('hi')` returns a string
 * wrapped in the ANSI red escape codes.
 */
import { describe, expect, it } from 'vitest';

function setup() {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({
    '/app/node_modules/chalk/package.json':
      '{"name":"chalk","version":"5.0.0","type":"module","exports":{".":"./source/index.js"}}',
    '/app/node_modules/chalk/source/index.js': `
      const codes = { red: [31, 39], green: [32, 39], blue: [34, 39], bold: [1, 22] };
      function wrap(name, str) {
        const [open, close] = codes[name];
        return '\\u001b[' + open + 'm' + String(str) + '\\u001b[' + close + 'm';
      }
      const chalk = {};
      for (const k of Object.keys(codes)) chalk[k] = (s) => wrap(k, s);
      export default chalk;
      export const Chalk = class {};
    `,
    '/app/main.mjs': `
      import chalk from 'chalk';
      export const red = chalk.red('hi');
      export const bold = chalk.bold(chalk.green('ok'));
    `,
  });
  return createModuleLoader(vfs);
}

describe('integration — chalk', () => {
  it('chalk.red returns ANSI red wrapped string', async () => {
    const loader = setup();
    const ns = await loader.import('./main.mjs', '/app/entry.mjs');
    expect(ns.red).toBe('[31mhi[39m');
  });

  it('nested wraps compose', async () => {
    const loader = setup();
    const ns = await loader.import('./main.mjs', '/app/entry.mjs');
    expect(ns.bold).toBe('[1m[32mok[39m[22m');
  });
});
