import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import {
  type TerminalSessionTarget,
  bootShell,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

const fixtures = {
  'lifecycle.cjs': `
process.on('uncaughtException', error => console.log('caught', error.message));
process.on('unhandledRejection', error => console.log('rejection', error.message));
process.once('exit', code => console.log('EXIT', code));
setTimeout(() => { throw new Error('boom'); }, 5);
setTimeout(() => Promise.reject(new Error('reject')), 15);
setTimeout(() => { console.log('after'); process.exitCode = 3; }, 30);
`,
  'top-exception.cjs': `process.on('uncaughtException', (error, origin) => console.log('TOP', error.message, origin)); process.once('exit', code => console.log('EXIT', code)); setTimeout(() => console.log('after'), 5); throw new Error('entry-boom');`,
  'top-exception.mjs': `process.on('uncaughtException', (error, origin) => console.log('TOP', error.message, origin)); process.on('unhandledRejection', () => console.log('WRONG-ENTRY-REJECTION')); process.once('exit', code => console.log('EXIT', code)); setTimeout(() => console.log('after'), 5); throw new Error('entry-boom');`,
  'eval-source.cjs': `process.on('uncaughtException', (error, origin) => console.log('EVAL', error.message, origin)); process.once('exit', code => console.log('EXIT', code)); setTimeout(() => console.log('after'), 5); throw new Error('eval-boom');`,
  'explicit-exit.cjs': `process.once('exit', code => console.log('EXIT', code)); process.exitCode = 7; process.exit();`,
  'port-ref.cjs': `const {Worker, MessageChannel} = require('node:worker_threads'); const channel = new MessageChannel(); const w = new Worker('./worker.cjs', {stdout:true, stderr:true}); w.on('message', msg => {console.log('PORT-REF', msg); channel.port1.unref(); channel.port1.close(); channel.port2.close();}); w.unref(); channel.port1.ref();`,
  'worker.cjs': `const { parentPort } = require('node:worker_threads'); setTimeout(() => { console.log('worker-stdout'); console.error('worker-stderr'); parentPort.postMessage('hi'); }, 700);`,
  'worker-parent.cjs': `const { Worker } = require('node:worker_threads'); const w = new Worker('./worker.cjs'); w.on('message', msg => console.log('got', msg)); w.on('exit', code => console.log('wexit', code)); process.on('exit', code => console.log('EXIT', code));`,
  'worker-unref.cjs': `const { Worker } = require('node:worker_threads'); new Worker('./worker.cjs').unref(); process.on('exit', code => console.log('EXIT', code));`,
  'worker-capture.cjs': `const { Worker } = require('node:worker_threads'); const w = new Worker('./worker.cjs', {execArgv: [], stdout:true, stderr:true}); let out = '', err = ''; w.stdout.on('data', c => out += c); w.stderr.on('data', c => err += c); w.on('exit', code => console.log('CAPTURE', code, JSON.stringify(out), JSON.stringify(err)));`,
  'package.json': JSON.stringify({
    type: 'module',
    imports: {
      '#choice': { public: './public.mjs', custom: './custom.mjs', default: './base.mjs' },
    },
  }),
  'base.mjs': "export default 'base';",
  'public.mjs': "export default 'public';",
  'custom.mjs': "export default 'custom';",
  'node_modules/pick/package.json': JSON.stringify({
    exports: { public: './public.mjs', custom: './custom.mjs', default: './base.mjs' },
  }),
  'node_modules/pick/base.mjs': "export default 'base';",
  'node_modules/pick/public.mjs': "export default 'public';",
  'node_modules/pick/custom.mjs': "export default 'custom';",
  'other/node_modules/pick/package.json': JSON.stringify({
    exports: { custom: './custom.mjs', default: './base.mjs' },
  }),
  'other/node_modules/pick/custom.mjs': "export default 'other';",
  'other/node_modules/pick/base.mjs': "export default 'other-base';",
  'pre.cjs':
    'globalThis.preCount = (globalThis.preCount || 0) + 1; module.exports = globalThis.preObject = { count: globalThis.preCount };',
  'flags-child.mjs': `import {Worker, workerData, parentPort} from 'node:worker_threads'; import chosen from 'pick'; import alias from '#choice'; import pre from './pre.cjs'; const other = new URL('./other/parent.mjs', import.meta.url).href; console.log('FLAGS', JSON.stringify(process.execArgv), chosen, alias, pre.count, pre === globalThis.preObject, import.meta.resolve('./missing.js', other).endsWith('/other/missing.js'), import.meta.resolve('pick', other).endsWith('/other/node_modules/pick/custom.mjs')); if (workerData === 0) { process.execArgv.splice(0, process.execArgv.length, '--conditions=public'); new Worker(new URL('./flags-child.mjs', import.meta.url), {workerData:1}); } if (process.send) process.send('done');`,
  'flags-parent.cjs': `const {Worker} = require('node:worker_threads'); const {fork} = require('node:child_process'); const flags = ['--experimental-import-meta-resolve', '--require', './pre.cjs', '--require=./pre.cjs', '--conditions=custom']; const w = new Worker('./flags-child.mjs', {execArgv:flags, workerData:0}); w.on('exit', () => { process.execArgv.push('--conditions=public', '--require=./pre.cjs'); const c = fork('./flags-child.mjs'); c.on('message', () => c.disconnect()); c.on('exit', () => { const empty = new Worker('./flags-child.mjs', {execArgv:[],workerData:1}); empty.on('exit', () => { new Worker('./flags-child.mjs', {execArgv:['-e', "console.log('MUST-NOT-REPLAY')"],workerData:1}); }); }); });`,
  'pre-throw.cjs': "console.log('PRELOAD'); throw new Error('preload-boom');",
  'must-not-run.cjs': "console.log('MUST-NOT-RUN');",
  'flags-errors.cjs': `const {Worker} = require('node:worker_threads'); for (const arg of ['--require','--conditions']) { try { new Worker('./must-not-run.cjs', {execArgv:[arg]}); } catch (e) { console.log('SYNC', e.code); } } for (const pre of ['./missing.cjs','./pre-throw.cjs']) { let deferred = false; const w = new Worker('./must-not-run.cjs', {execArgv:['--require',pre]}); w.on('error', e => console.log('ASYNC', deferred, pre, e.code || e.message)); w.on('exit', code => console.log('FAIL-EXIT', pre, code)); deferred = true; }`,
};

function nativeOracle(
  file: keyof typeof fixtures,
  evalEntry = false,
): { output: string; code: number | null } {
  const dir = mkdtempSync(join(tmpdir(), 'rifty-vitest-oracle-'));
  try {
    for (const [name, source] of Object.entries(fixtures)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), source.replaceAll('\n', ' '));
    }
    const result = spawnSync(process.execPath, evalEntry ? ['-e', fixtures[file]] : [file], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 30_000,
    });
    if (result.error) throw result.error;
    return {
      output: (result.stdout + result.stderr).replace(
        new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'),
        '',
      ),
      code: result.status,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const sessions = new WeakMap<Page, TerminalSessionTarget>();

async function run(
  page: Page,
  line: string,
  timeout = 60_000,
): Promise<{ output: string; code: number | null }> {
  const target = sessions.get(page);
  if (!target) throw new Error('Missing shell session');
  const before = await terminalBuffer(page, target);
  await runTerminalLine(page, line, target);
  try {
    await expect
      .poll(
        async () => {
          const running = await page
            .locator(
              `.rf-terminal-tab:has(.rf-terminal-tab__select[data-session-id="${target.sessionId}"])`,
            )
            .getAttribute('data-running');
          const buffer = await terminalBuffer(page, target);
          return (
            running !== 'true' &&
            buffer.lastIndexOf(`> ${line}`) >= before.length - 2 &&
            />\s*$/u.test(buffer)
          );
        },
        { timeout },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(`Stalled ${line}: ${await terminalBuffer(page, target)}`, { cause: error });
  }
  const buffer = await terminalBuffer(page, target);
  const start = buffer.lastIndexOf(`> ${line}`);
  if (start < 0) throw new Error(`Missing command echo: ${line}: ${buffer}`);
  return {
    output: buffer.slice(start + line.length + 2),
    code: await terminalHistoryExitCode(page, line, target),
  };
}

async function seed(page: Page, files: Record<string, string>): Promise<void> {
  const command = Object.entries(files)
    .map(([name, source]) => `echo ${quote(source.replaceAll('\n', ' '))} > ${name}`)
    .join(' && ');
  expect((await run(page, command, 30_000)).code).toBe(0);
}

test('Node lifecycle and physical Worker contracts used by Vitest', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium');
  test.setTimeout(240_000);
  await bootShell(page);
  const starter = page
    .locator('.rf-terminal-tab:has(.rf-terminal-tab__select[data-session-id])')
    .first();
  await expect(starter).toHaveAttribute('data-running', 'true', { timeout: 60_000 });
  await starter.locator('.rf-terminal-tab__select').click();
  await page.locator('.rf-terminal-slot[data-active="true"] [data-testid="terminal"]').click();
  await page.keyboard.press('Control+c');
  await expect(starter).toHaveAttribute('data-running', 'false', { timeout: 30_000 });
  sessions.set(page, await openShellTerminal(page));
  expect(
    (await run(page, 'rm -rf node_modules && mkdir -p node_modules/pick other/node_modules/pick'))
      .code,
  ).toBe(0);
  await seed(page, { 'package.json': fixtures['package.json'] });
  expect((await run(page, 'npm install', 60_000)).code).toBe(0);
  expect((await run(page, 'mkdir -p node_modules/pick other/node_modules/pick')).code).toBe(0);
  await seed(
    page,
    Object.fromEntries(Object.entries(fixtures).filter(([name]) => name !== 'package.json')),
  );
  for (const file of [
    'lifecycle.cjs',
    'explicit-exit.cjs',
    'top-exception.cjs',
    'top-exception.mjs',
    'eval-source.cjs',
    'port-ref.cjs',
    'worker-parent.cjs',
    'worker-unref.cjs',
    'worker-capture.cjs',
    'flags-parent.cjs',
    'flags-errors.cjs',
  ] as (keyof typeof fixtures)[]) {
    const evalEntry = file === 'eval-source.cjs';
    const oracle = nativeOracle(file, evalEntry);
    const result = await run(page, evalEntry ? `node -e ${quote(fixtures[file])}` : `node ${file}`);
    expect(result.code, `${file}: ${result.output}`).toBe(oracle.code);
    for (const line of new Set(oracle.output.trim().split('\n'))) {
      expect(result.output, file).toContain(line);
      const count = oracle.output
        .trim()
        .split('\n')
        .filter((value) => value === line).length;
      expect(result.output.split(line).length - 1, `${file}: ${line}`).toBe(count);
    }
    if (file === 'flags-parent.cjs')
      expect(result.output).not.toMatch(/(?:^|\r?\n)MUST-NOT-REPLAY(?:\r?\n|$)/);
    if (file === 'flags-errors.cjs')
      expect(result.output).not.toMatch(/(?:^|\r?\n)MUST-NOT-RUN(?:\r?\n|$)/);
    if (file === 'worker-unref.cjs') expect(result.output).not.toContain('worker-stdout');
  }
});

test('real Vitest TS config and tests on forks and threads', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium');
  test.setTimeout(600_000);
  await bootShell(page);
  const starter = page
    .locator('.rf-terminal-tab:has(.rf-terminal-tab__select[data-session-id])')
    .first();
  await expect(starter).toHaveAttribute('data-running', 'true', { timeout: 60_000 });
  await starter.locator('.rf-terminal-tab__select').click();
  await page.locator('.rf-terminal-slot[data-active="true"] [data-testid="terminal"]').click();
  await page.keyboard.press('Control+c');
  await expect(starter).toHaveAttribute('data-running', 'false', { timeout: 30_000 });
  sessions.set(page, await openShellTerminal(page));
  expect(
    (await run(page, 'mkdir -p src ignored && rm -rf node_modules && rm -f package-lock.json'))
      .code,
  ).toBe(0);
  const manifest = {
    type: 'module',
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '4.1.11' },
    overrides: { vite: '8.0.16' },
  };
  const passing = `import { expect, test } from 'vitest'; import { sum } from './sum'; test('adds', () => expect(sum(1,2)).toBe(3)); test('second', () => expect(sum(1,2)).toBe(3));`;
  await seed(page, {
    'package.json': JSON.stringify(manifest),
    'vitest.config.ts': `import { defineConfig } from 'vitest/config'; export default defineConfig({test:{include:['src/**/*.test.ts']}});`,
    'src/sum.ts': 'export const sum = (a: number, b: number): number => a + b;',
    'src/sum.test.ts': passing.replace(
      "test('second', () => expect(sum(1,2)).toBe(3))",
      "test('second', () => expect(sum(1,2)).toBe(4))",
    ),
    'ignored/outside.test.ts': `throw new Error('CONFIG_INCLUDE_IGNORED');`,
  });
  const installed = await run(page, 'npm install', 180_000);
  expect(installed.code).toBe(0);
  expect(installed.output).toContain('vite@8.0.16');
  const versions = await run(
    page,
    `node -e ${quote("console.log(require('./node_modules/vite/package.json').version); const fs = require('node:fs'); console.log(fs.existsSync('node_modules/vitest/node_modules/vite')); ")}`,
  );
  expect(versions.output).toContain('8.0.16');
  expect(versions.output).toContain('false');
  for (const command of [
    'vitest run',
    'vitest run --pool=threads',
    'npm test',
    'vitest run --reporter=verbose',
  ]) {
    const failed = await run(page, command, 120_000);
    expect(failed.code, `${command}: ${failed.output}`).toBe(1);
    expect(failed.output, command).toContain('src/sum.test.ts');
    expect(failed.output, command).toMatch(/1 failed.*1 passed/);
    expect(failed.output, command).toMatch(/Expected|expected|AssertionError/);
    expect(failed.output, command).not.toContain('CONFIG_INCLUDE_IGNORED');
  }
  await seed(page, { 'src/sum.test.ts': passing });
  for (const command of [
    'vitest run',
    'vitest run --pool=threads',
    'npm test',
    'vitest run --reporter=verbose',
  ]) {
    const passed = await run(page, command, 120_000);
    expect(passed.code, command).toBe(0);
    expect(passed.output, command).toMatch(/2 passed/);
  }
  for (const command of [
    'vitest --version',
    'vitest --help',
    'vitest run --help',
    'vitest run --pool=threads --help',
  ]) {
    const info = await run(page, command, 60_000);
    expect(info.code, info.output).toBe(0);
    if (command.endsWith('--version'))
      expect(info.output.split('vitest/4.1.11').length - 1).toBe(1);
    else expect(info.output.split('Usage:').length - 1).toBe(1);
  }
  for (const [command, feature] of [
    ['vitest --watch', 'vitest.watch'],
    ['vitest run --pool=vmThreads', 'NotImplemented'],
    ['vitest run --pool=vmForks', 'vitest.pool.vmForks'],
    ['vitest run --coverage', 'vitest.coverage'],
    ['vitest run --environment=jsdom', 'vitest.environment.jsdom'],
    ['vitest run --environment=happy-dom', 'vitest.environment.happy-dom'],
    ['vitest run --browser.enabled', 'vitest.browser'],
  ]) {
    const unsupported = await run(page, command!, 60_000);
    expect(unsupported.code, unsupported.output).not.toBe(0);
    expect(unsupported.output, command).toContain(feature!);
  }
  await seed(page, {
    'vitest.config.ts': `import {defineConfig} from 'vitest/config'; export default defineConfig({test:{include:['src/**/*.test.ts'],watch:true}});`,
  });
  const forcedRun = await run(page, 'vitest run', 120_000);
  expect(forcedRun.code, forcedRun.output).toBe(0);
  expect(forcedRun.output).toMatch(/2 passed/);
  const defaultMode = await run(page, 'vitest', 60_000);
  expect(defaultMode.code).not.toBe(0);
  expect(defaultMode.output).toContain('vitest.watch');
  expect(defaultMode.output).not.toContain('2 passed');
  const extended = {
    ...manifest,
    devDependencies: {
      ...manifest.devDependencies,
      jsdom: '30.0.1',
      'happy-dom': '20.0.0',
      '@vitest/coverage-v8': '4.1.11',
    },
  };
  await seed(page, { 'package.json': JSON.stringify(extended) });
  expect((await run(page, 'npm install', 180_000)).code).toBe(0);
  for (const [settings, feature] of [
    ["environment:'jsdom'", 'vm.constants.DONT_CONTEXTIFY'],
    ["environment:'happy-dom'", 'Not implemented'],
    ['coverage:{enabled:true}', 'inspector/promises.Session'],
  ]) {
    await seed(page, {
      'vitest.config.ts': `import {defineConfig} from 'vitest/config'; export default defineConfig({test:{include:['src/**/*.test.ts'],${settings}}});`,
    });
    const unsupported = await run(page, 'vitest run', 120_000);
    expect(unsupported.code, unsupported.output).not.toBe(0);
    expect(unsupported.output).toContain(feature!);
  }
});
