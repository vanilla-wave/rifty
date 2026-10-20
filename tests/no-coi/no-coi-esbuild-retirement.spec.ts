import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from './fixtures/test.ts';

const exec = promisify(execFile);
const root = process.cwd().replaceAll('\\', '/');
const program = `
const esbuild = require('esbuild');
esbuild.transform('let x: number = 1', {loader:'ts'}).then(result => console.log(result.code));
`;

test('installed no-COI esbuild uses upstream children without loading the legacy client', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const oracleRoot = await mkdtemp(join(tmpdir(), 'rifty-esbuild-cutover-'));
  const loaded: string[] = [];
  page.on('request', (request) => loaded.push(request.url()));
  try {
    const target = join(oracleRoot, 'node_modules/esbuild');
    await mkdir(target, { recursive: true });
    await exec('tar', [
      '-xzf',
      join(
        root,
        'tests/integration/fixtures/registry/rollup-companions/packages/esbuild-wasm-0.28.0.tgz',
      ),
      '-C',
      target,
      '--strip-components=1',
    ]);
    await writeFile(join(oracleRoot, 'probe.cjs'), program);
    const oracle = await exec(process.execPath, ['probe.cjs'], {
      cwd: oracleRoot,
      env: { NO_COLOR: '1', PATH: dirname(process.execPath) },
    });
    await page.goto('/no-coi-harness.html');
    const observed = await page.evaluate(
      async ({ root, program }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          serviceWorkerUrl: '/sw.js',
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          },
        });
        try {
          const project = sandbox.project({ root: '/cutover' });
          await project.fs.writeFile(
            'package.json',
            JSON.stringify({
              name: 'cutover',
              version: '1.0.0',
              dependencies: { esbuild: '0.28.0' },
            }),
          );
          await project.fs.writeFile('probe.cjs', program);
          await project.fs.writeFile(
            'slot.cjs',
            "console.log(Object.prototype.hasOwnProperty.call(globalThis.__riftyShadowRegistry ?? {}, 'esbuild'));",
          );
          await sandbox.toolchain.install({ cwd: '/cutover', registryUrl: '/npm-registry' });
          const first = await project.run('node probe.cjs').completion;
          const slot = await project.run('node slot.cjs').completion;
          const second = await project.run('node probe.cjs').completion;
          return { first, second, slot, coi: crossOriginIsolated };
        } finally {
          sandbox.dispose();
        }
      },
      { root, program },
    );
    expect(observed.coi).toBe(false);
    for (const result of [observed.first, observed.second])
      expect(result).toMatchObject({
        status: 'exited',
        exitCode: 0,
        stdout: oracle.stdout,
        stderr: oracle.stderr,
      });
    expect(observed.slot).toMatchObject({ status: 'exited', exitCode: 0, stdout: 'false\n' });
    expect(loaded.filter((url) => url.includes('/generated/esbuild-runtime.js'))).toEqual([]);
  } finally {
    await rm(oracleRoot, { recursive: true, force: true });
  }
});
