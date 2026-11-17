// pdfjs-dist / pdf-parse select their Node path by `String(process) === '[object process]'`
// (ADR-0345): real PDFs extract the same text in the no-COI toolchain as in native Node.
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from './fixtures/test.ts';

const exec = promisify(execFile);
const root = process.cwd().replaceAll('\\', '/');
const fixtures = join(process.cwd(), 'tests/no-coi/fixtures/pdf-text');
const pdfs = ['invoice.pdf', 'report.pdf'];
const manifest = JSON.stringify({ name: 'pdf-text', version: '1.0.0', private: true });
const scenarios = [
  {
    name: 'pdfjs-dist',
    version: '6.5.438',
    api: 'legacy getDocument → getTextContent',
    script: 'pdfjs-text.mjs',
  },
  { name: 'pdf-parse', version: '2.4.5', api: 'getText', script: 'pdf-parse-text.cjs' },
];

// Declared residual (backlog: runtime-js/process-module-loader-surface): no
// `process.getBuiltinModule`, so the bundled pdfjs warns once before the same text path.
const NO_GET_BUILTIN_MODULE =
  'Warning: Cannot access the `require` function: "TypeError: process.getBuiltinModule is not a function".\n';

async function nativeRun(spec: string, name: string, script: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'rifty-pdf-text-'));
  try {
    await writeFile(join(cwd, 'package.json'), manifest);
    await exec('npm', ['install', spec, '--no-audit', '--no-fund', '--prefer-online'], {
      cwd,
      timeout: 180_000,
    });
    for (const file of [...pdfs, script]) await copyFile(join(fixtures, file), join(cwd, file));
    const { stdout, stderr } = await exec(process.execPath, [script], { cwd, timeout: 60_000 });
    const installed = JSON.parse(
      await readFile(join(cwd, 'node_modules', name, 'package.json'), 'utf8'),
    ).version;
    return { stdout, stderr, installed };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

for (const scenario of scenarios) {
  const spec = `${scenario.name}@${scenario.version}`;
  test(`${spec} ${scenario.api} extracts PDF text like native Node`, async ({ page }) => {
    test.setTimeout(300_000);
    const native = await nativeRun(spec, scenario.name, scenario.script);
    await test.info().attach('node-oracle', {
      body: JSON.stringify({ node: process.version, ...native }),
      contentType: 'application/json',
    });
    const files: Record<string, string> = {};
    for (const file of [...pdfs, scenario.script])
      files[file] = (await readFile(join(fixtures, file))).toString('base64');
    await page.goto('/no-coi-harness.html');
    // One sandbox per library: no-COI commands share a realm, and each pdfjs
    // build publishes its fake worker on `globalThis.pdfjsWorker`.
    const observed = await page.evaluate(
      async ({ root, files, manifest, spec, name, script }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          storage: { persistence: 'ephemeral' },
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
            registryUrl: '/npm-registry',
          },
        });
        try {
          const project = sandbox.project({ root: '/pdf-text' });
          await project.fs.writeFile('package.json', manifest);
          for (const [file, base64] of Object.entries(files))
            await project.fs.writeFile(
              file,
              Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
            );
          const install = await project.run(`npm install ${spec}`).completion;
          const installed = JSON.parse(
            await project.fs.readFile(`node_modules/${name}/package.json`, 'utf8'),
          ).version;
          const run = await project.run(`node ${script}`).completion;
          return { coi: crossOriginIsolated, install, installed, run };
        } finally {
          sandbox.dispose();
        }
      },
      { root, files, manifest, spec, name: scenario.name, script: scenario.script },
    );
    expect(observed.coi).toBe(false);
    expect(observed.install, observed.install.stderr).toMatchObject({
      status: 'exited',
      exitCode: 0,
    });
    expect([native.installed, observed.installed]).toEqual([scenario.version, scenario.version]);
    for (const token of ['INV-2026-0419', '12,345.67', 'PDF-LIBERATION-HERON-37', 'Osaka'])
      expect(native.stdout).toContain(token);
    expect(observed.run, observed.run.stderr).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(observed.run.stdout).toBe(native.stdout);
    expect(observed.run.stderr).toBe(NO_GET_BUILTIN_MODULE + native.stderr);
  });
}
