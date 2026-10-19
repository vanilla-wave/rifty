import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { childProcessFiles } from './fixtures/child-process-programs.ts';
import { expect, test } from './fixtures/test.ts';

const exec = promisify(execFile);
const root = process.cwd().replaceAll('\\', '/');
const archive = join(
  root,
  'tests/integration/fixtures/registry/rollup-companions/packages/esbuild-wasm-0.28.0.tgz',
);
const upstreamFiles = [
  'package.json',
  'lib/main.js',
  'bin/esbuild',
  'wasm_exec_node.js',
  'wasm_exec.js',
  'esbuild.wasm',
];

const cases = [
  ...[
    'parent.cjs',
    'esbuild.cjs',
    'errors.cjs',
    'kill.cjs',
    'nested.cjs',
    'fork.cjs',
    'signal.cjs',
    'unref-pipes.cjs',
  ].map((entry) => ({ entry, persistence: 'preferred' as const })),
  ...['parent.cjs', 'esbuild.cjs'].map((entry) => ({ entry, persistence: 'ephemeral' as const })),
];
for (const { entry, persistence } of cases) {
  test(`no-COI child processes match Node: ${entry} (${persistence})`, async ({ page }) => {
    test.setTimeout(120_000);
    const directory = await mkdtemp(join(tmpdir(), 'rifty-no-coi-child-'));
    try {
      const files: Record<string, string> = {};
      for (const [path, source] of Object.entries(childProcessFiles)) {
        await mkdir(dirname(join(directory, path)), { recursive: true });
        await writeFile(join(directory, path), source);
        files[path] = Buffer.from(source).toString('base64');
      }
      if (entry === 'esbuild.cjs') {
        const target = join(directory, 'node_modules/esbuild-wasm');
        await mkdir(target, { recursive: true });
        await exec('tar', ['-xzf', archive, '-C', target, '--strip-components=1']);
        for (const path of upstreamFiles) {
          files[`node_modules/esbuild-wasm/${path}`] = (
            await readFile(join(target, path))
          ).toString('base64');
        }
      }
      const oracle = await exec(process.execPath, [entry], {
        cwd: directory,
        timeout: 20_000,
        env: { NO_COLOR: '1', PATH: dirname(process.execPath) },
      });
      await test.info().attach('node-oracle', {
        body: JSON.stringify({ version: process.version, entry, ...oracle }),
        contentType: 'application/json',
      });
      await page.goto('/no-coi-harness.html');
      const observed = await page.evaluate(
        async ({ root, files, entry, persistence }) => {
          const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
          const sandbox = await createSandbox({
            requireCrossOriginIsolation: false,
            serviceWorkerUrl: '/sw.js',
            storage: { persistence },
            toolchain: {
              workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            },
          });
          Reflect.set(globalThis, 'noCoiChildSandbox', sandbox);
          try {
            for (const [path, base64] of Object.entries(files)) {
              await sandbox.fs.writeFile(
                `/children/${path}`,
                Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
              );
            }
            const result = await Promise.race([
              sandbox.project({ root: '/children' }).run(`node ${entry}`).completion,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('child acceptance timed out')), 30_000),
              ),
            ]);
            return {
              coi: crossOriginIsolated,
              sab: typeof SharedArrayBuffer,
              backend: sandbox.vfs.backend,
              result,
            };
          } catch (error) {
            sandbox.dispose();
            throw error;
          }
        },
        { root, files, entry, persistence },
      );
      expect(observed.coi).toBe(false);
      expect(observed.sab).toBe('undefined');
      if (persistence === 'ephemeral') expect(observed.backend).toBe('memory');
      expect(observed.result, JSON.stringify(observed.result)).toMatchObject({
        status: 'exited',
        exitCode: 0,
        stdout: oracle.stdout,
        stderr: oracle.stderr,
      });
      await expect
        .poll(() => page.workers().length, {
          message: 'only the SDK owner remains after process completion',
        })
        .toBe(1);
    } finally {
      await page.evaluate(() => Reflect.get(globalThis, 'noCoiChildSandbox')?.dispose());
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('no SW refuses children while ordinary SDK functions remain usable', async ({ page }) => {
  await page.goto('/no-coi-harness.html');
  const observed = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    try {
      await sandbox.fs.writeFile('/without-sw/child.cjs', "console.log('child must not run');");
      await sandbox.fs.writeFile(
        '/without-sw/probe.cjs',
        `
try { require('node:child_process').spawn('node', ['child.cjs']); }
catch(error) { console.log(error.name, error.feature); }
`,
      );
      const project = sandbox.project({ root: '/without-sw' });
      return {
        child: await project.run('node probe.cjs').completion,
        ordinary: await project.run('echo usable').completion,
        file: await project.fs.readFile('child.cjs', 'utf8'),
      };
    } finally {
      sandbox.dispose();
    }
  }, root);
  expect(observed.ordinary).toMatchObject({ status: 'exited', exitCode: 0, stdout: 'usable\n' });
  expect(observed.file).toBe("console.log('child must not run');");
  expect(observed.child).toMatchObject({
    status: 'exited',
    exitCode: 0,
    stdout: 'NotImplementedError child_process.spawn.service-worker\n',
  });
});

test('native child startup error settles and leaves the SDK owner usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/no-coi-harness.html');
  const observed = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      serviceWorkerUrl: '/sw.js',
      toolchain: {
        workerUrl: `/@fs${root}/tests/no-coi/fixtures/no-coi-child-startup-fault-worker.ts`,
      },
    });
    Reflect.set(globalThis, 'noCoiChildSandbox', sandbox);
    await sandbox.fs.writeFile(
      '/startup/parent.cjs',
      `
const child = require('node:child_process').spawn('node', ['child.cjs']);
child.stderr.on('data', chunk=>process.stderr.write(chunk));
child.on('close', code=>console.log('child-close',code));
`,
    );
    const project = sandbox.project({ root: '/startup' });
    return {
      failed: await project.run('node parent.cjs').completion,
      next: await project.run('echo still-usable').completion,
    };
  }, root);
  try {
    expect(observed.failed).toMatchObject({
      status: 'exited',
      exitCode: 0,
      stdout: 'child-close 1\n',
    });
    expect(observed.failed.stderr).toContain('child-startup-failure');
    expect(observed.next).toMatchObject({
      status: 'exited',
      exitCode: 0,
      stdout: 'still-usable\n',
    });
    await expect.poll(() => page.workers().length).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => Reflect.get(globalThis, 'noCoiChildSandbox')?.dispose());
  }
});
