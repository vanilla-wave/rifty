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

for (const entry of ['parent.cjs', 'esbuild.cjs', 'errors.cjs', 'kill.cjs']) {
  test(`no-COI child processes match Node: ${entry}`, async ({ page }) => {
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
        env: { NO_COLOR: '1' },
      });
      expect(oracle.stderr).toBe('');
      await test.info().attach('node-oracle', {
        body: JSON.stringify({ version: process.version, entry, ...oracle }),
        contentType: 'application/json',
      });
      await page.goto('/no-coi-harness.html');
      const observed = await page.evaluate(
        async ({ root, files, entry }) => {
          const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
          const sandbox = await createSandbox({
            requireCrossOriginIsolation: false,
            serviceWorkerUrl: '/sw.js',
            toolchain: {
              workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            },
          });
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
            return { coi: crossOriginIsolated, sab: typeof SharedArrayBuffer, result };
          } finally {
            sandbox.dispose();
          }
        },
        { root, files, entry },
      );
      expect(observed.coi).toBe(false);
      expect(observed.sab).toBe('undefined');
      test.fail(true, 'no-coi-child-processes acceptance carrier: baseline RED');
      expect(observed.result, JSON.stringify(observed.result)).toMatchObject({
        status: 'exited',
        exitCode: 0,
        stdout: oracle.stdout,
      });
    } finally {
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
  test.fail(true, 'no-coi-child-processes acceptance carrier: baseline RED');
  expect(observed.child).toMatchObject({
    status: 'exited',
    exitCode: 0,
    stdout: 'NotImplementedError child_process.spawn.service-worker\n',
  });
});
