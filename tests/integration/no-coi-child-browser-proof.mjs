import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { childProcessFiles } from '../no-coi/fixtures/child-process-programs.ts';
import { withClientServer } from './client-bundle-browser-proof.mjs';

const exec = promisify(execFile);
const upstreamFiles = [
  'package.json',
  'lib/main.js',
  'bin/esbuild',
  'wasm_exec_node.js',
  'wasm_exec.js',
  'esbuild.wasm',
];

/** Public packed SDK/Worker/SW, same programs and untouched archive as native Node. */
export async function provePackedNoCoiChildren(root, report, repoRoot) {
  const oracleRoot = await mkdtemp(join(tmpdir(), 'rifty-packed-child-oracle-'));
  const files = {};
  try {
    for (const [path, content] of Object.entries(childProcessFiles)) {
      await mkdir(dirname(join(oracleRoot, path)), { recursive: true });
      await writeFile(join(oracleRoot, path), content);
      files[path] = Buffer.from(content).toString('base64');
    }
    const target = join(oracleRoot, 'node_modules/esbuild-wasm');
    await mkdir(target, { recursive: true });
    await exec('tar', [
      '-xzf',
      join(
        repoRoot,
        'tests/integration/fixtures/registry/rollup-companions/packages/esbuild-wasm-0.28.0.tgz',
      ),
      '-C',
      target,
      '--strip-components=1',
    ]);
    for (const path of upstreamFiles)
      files[`node_modules/esbuild-wasm/${path}`] = (await readFile(join(target, path))).toString(
        'base64',
      );
    const entries = ['parent.cjs', 'esbuild.cjs', 'esbuild.cjs'];
    const oracle = [];
    for (const entry of entries)
      oracle.push(
        await exec(process.execPath, [entry], {
          cwd: oracleRoot,
          env: { NO_COLOR: '1', PATH: dirname(process.execPath) },
          timeout: 20_000,
        }),
      );
    await copyFile(
      join(root, 'node_modules/@riftydev/workbench/dist/assets/sw.js'),
      join(root, 'sw.js'),
    );
    await withClientServer(root, async (browser, base) => {
      const page = await browser.newPage();
      try {
        await page.goto(base);
        const observed = await page.evaluate(
          async ({ sdk, worker, files, entries }) => {
            const { createSandbox } = await import(sdk);
            const sandbox = await createSandbox({
              requireCrossOriginIsolation: false,
              serviceWorkerUrl: '/sw.js',
              storage: { persistence: 'ephemeral' },
              toolchain: { workerUrl: `.${worker}` },
            });
            globalThis.packedChildSandbox = sandbox;
            for (const [path, base64] of Object.entries(files))
              await sandbox.fs.writeFile(
                `/children/${path}`,
                Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
              );
            const runs = [];
            const project = sandbox.project({ root: '/children' });
            for (const entry of entries) {
              const run = project.run(`node ${entry}`);
              let timer;
              try {
                runs.push(
                  await Promise.race([
                    run.completion,
                    new Promise((_, reject) => {
                      timer = setTimeout(
                        () => reject(new Error(`packed child ${entry} timed out`)),
                        30_000,
                      );
                    }),
                  ]),
                );
              } finally {
                clearTimeout(timer);
              }
            }
            return {
              runs,
              coi: crossOriginIsolated,
              sab: typeof SharedArrayBuffer,
              backend: sandbox.vfs.backend,
            };
          },
          {
            sdk: report.rows.find((row) => row.name === 'main').entry,
            worker: report.rows.find((row) => row.name === 'toolchain').entry,
            files,
            entries,
          },
        );
        assert.equal(observed.coi, false);
        assert.equal(observed.sab, 'undefined');
        assert.equal(observed.backend, 'memory');
        for (let i = 0; i < oracle.length; i++) {
          assert.equal(observed.runs[i].status, 'exited', JSON.stringify(observed.runs[i]));
          assert.equal(observed.runs[i].exitCode, 0, JSON.stringify(observed.runs[i]));
          assert.equal(observed.runs[i].stdout, oracle[i].stdout);
          assert.equal(observed.runs[i].stderr, oracle[i].stderr);
        }
        await expect.poll(() => page.workers().length).toBe(1);
      } finally {
        await page.evaluate(() => globalThis.packedChildSandbox?.dispose());
        await page.close();
      }
    });
  } finally {
    await rm(oracleRoot, { recursive: true, force: true });
  }
}
