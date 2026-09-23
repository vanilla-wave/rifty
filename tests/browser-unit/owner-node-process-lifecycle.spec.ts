import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';

const programs = {
  natural: `process.once('exit', code => console.log('exit', code)); console.log('body');`,
  explicit: `process.once('exit', code => console.log('exit', code)); process.exitCode = 3; process.exit();`,
  override: `process.once('exit', code => console.log('exit', code)); process.exitCode = 3; process.exit(4);`,
  timer: `process.once('exit', code => console.log('exit', code)); process.on('uncaughtException', (error, origin) => console.log('caught', error.message, origin)); setTimeout(() => { throw new Error('boom'); }, 0); setTimeout(() => console.log('after'), 50);`,
  rejection: `process.once('exit', code => console.log('exit', code)); const rejected = Promise.reject(new Error('boom')); process.on('unhandledRejection', (error, promise) => console.log('caught', error.message, promise === rejected)); setTimeout(() => console.log('after'), 50);`,
  entry: `process.once('exit', code => console.log('exit', code)); process.on('uncaughtException', (error, origin) => console.log('caught', error.message, origin)); setTimeout(() => console.log('after'), 50); throw new Error('entry');`,
  exitMutation: `process.once('exit', code => { console.log('exit', code); process.exitCode = 7; }); process.exit(4);`,
  exitReentrant: `process.once('exit', code => { console.log('exit', code); process.exit(7); }); process.exit(4);`,
  rejectionFallback: `process.once('exit', code => console.log('exit', code)); process.on('uncaughtException', (error, origin) => console.log('caught', error.message, origin)); Promise.reject(new Error('boom')); setTimeout(() => console.log('after'), 50);`,
  nextTick: `process.once('exit', code => console.log('exit', code)); process.on('uncaughtException', (error, origin) => console.log('caught', error.message, origin)); process.nextTick(() => { throw new Error('tick'); }); setTimeout(() => console.log('after'), 50);`,
};

const failures = {
  fatalTimer: `process.once('exit', code => console.log('EXIT', code)); setTimeout(() => { throw new Error('FATAL'); }, 0);`,
  fatalRejection: `process.once('exit', code => console.log('EXIT', code)); Promise.reject(new Error('FATAL'));`,
  fatalEntry: `process.once('exit', code => console.log('EXIT', code)); throw new Error('FATAL');`,
  fatalHandler: `process.once('exit', code => console.log('EXIT', code)); process.on('uncaughtException', () => { throw new Error('FATAL'); }); setTimeout(() => { throw new Error('initial'); }, 0);`,
};

test('Node program lifecycle handlers and exit status match native Node', async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), 'rifty-process-lifecycle-'));
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'browser-unit-process-lifecycle',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    expect((await execLine(page, 'npm install')).exit).toBe(0);
    for (const [name, source] of Object.entries(programs)) {
      const file = `${name}.cjs`;
      writeFileSync(join(directory, file), source);
      const oracle = spawnSync(process.execPath, [join(directory, file)], { encoding: 'utf8' });
      expect(oracle.error).toBeUndefined();
      await writeOwnerFile(page, `/scratch/${file}`, source);
      const actual = await execLine(page, `node ${file}`);
      expect.soft(actual.exit, `${name}: ${actual.out}`).toBe(oracle.status);
      expect
        .soft(stripVTControlCharacters(actual.out).replaceAll('\r', '').trim(), name)
        .toBe(stripVTControlCharacters(oracle.stdout).trim());
    }
    for (const [name, source] of Object.entries(failures)) {
      const file = `${name}.cjs`;
      writeFileSync(join(directory, file), source);
      const oracle = spawnSync(process.execPath, [join(directory, file)], { encoding: 'utf8' });
      expect(oracle.error).toBeUndefined();
      await writeOwnerFile(page, `/scratch/${file}`, source);
      const actual = await execLine(page, `node ${file}`);
      const output = stripVTControlCharacters(actual.out);
      expect.soft(actual.exit, name).toBe(oracle.status);
      expect.soft(output, name).toContain('FATAL');
      expect
        .soft(output.match(/EXIT \d+/g) ?? [], name)
        .toEqual(stripVTControlCharacters(oracle.stdout).match(/EXIT \d+/g) ?? []);
    }
  } finally {
    await closeOwner(page);
    rmSync(directory, { recursive: true, force: true });
  }
});
