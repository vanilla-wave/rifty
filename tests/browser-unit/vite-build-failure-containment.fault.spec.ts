import { type Page, type Worker, expect, test } from '@playwright/test';
import { DEFAULT_VITE8_CONFIG_JS } from '../../apps/playground/src/vite-project-policy.ts';
import {
  bootOwner,
  closeOwner,
  execLine,
  execLineOutcome,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';
import nodeOracle from './fixtures/vite8-unresolved-import-node-oracle.json' with { type: 'json' };

const PROVEN_VITE8_WASI_RUNTIME_OVERRIDE = {
  '@napi-rs/wasm-runtime': 'npm:@napi-rs/wasm-runtime@1.1.6',
} as const;
const NORMAL_BUILD_ATTEMPTS = 2;
const LATE_FAILURE_MODULE_COUNT = nodeOracle.fixture.moduleCount;
const LATE_FAILURE_MODULES = Object.freeze(
  Object.fromEntries(
    Array.from({ length: LATE_FAILURE_MODULE_COUNT }, (_unused, index) => {
      const next = index + 1;
      return [
        `/src/chain/${String(index)}.js`,
        next === LATE_FAILURE_MODULE_COUNT
          ? `import '${nodeOracle.fixture.missingSpecifier}';\nexport const value = 1;\n`
          : `import { value as next } from './${String(next)}.js';\nexport const value = next + 1;\n`,
      ];
    }),
  ),
);
const WORKER_TEARDOWN_FAULT_CONFIG = `export default {
  server: { hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: 'issue-247-worker-teardown-fault',
    async buildEnd(error) {
      if (!error) throw new Error('expected the unresolved-import build failure');
      process.stderr.write('BUILD_REJECTION_BEFORE_WORKER_FAULT:' + error.message + '\\n');
      setTimeout(() => {
        throw new Error('issue-247-late-worker-teardown-fault');
      }, 0);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    },
  }],
};
`;

async function expectHealthyOwner(page: Page): Promise<void> {
  const health = await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    return fixture.currentWorkbench().health.snapshot();
  }, sealedWorkbenchFixtureUrl);
  expect(health).toEqual({ disposition: 'healthy', issues: [] });
}

async function expectWorkerQuiescence(page: Page, baseline: readonly Worker[]): Promise<void> {
  await expect
    .poll(() => page.workers().filter((worker) => !baseline.includes(worker)).length)
    .toBe(0);
  expect(page.workers()).toEqual(baseline);
}

async function expectCleanProcessProbe(page: Page, baseline?: string): Promise<string> {
  const probe = await execLineOutcome(page, 'node post-failure-process-probe.mjs');
  expect(probe.exitCode, probe.out).toBe(0);
  expect(probe.exit).toEqual({ code: 0, signal: null });
  expect(probe.closeExit).toEqual(probe.exit);
  expect(probe.closeShared).toBe(true);
  expect(probe.settlements).toBe(1);
  const snapshot = probe.out.match(/OWNER_HEALTHY\|[^\r\n]+/u)?.[0];
  if (snapshot === undefined) throw new Error(`missing process snapshot in output:\n${probe.out}`);
  expect(snapshot).toBe(baseline ?? 'OWNER_HEALTHY|dist=false|probeChildren=1|orphans=0');
  return snapshot;
}

test('Vite 8 unresolved imports stay command failures without killing the owner', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-vite8-build-failure-containment',
    persistence: 'ephemeral',
    plan: {
      kind: 'vite',
      id: 'scratch',
      starterId: 'vite8-build-failure-containment',
      templateId: 'browser-unit:vite8-build-failure-containment',
      files: {
        '/package.json': JSON.stringify({
          private: true,
          type: 'module',
          overrides: PROVEN_VITE8_WASI_RUNTIME_OVERRIDE,
        }),
        '/index.html': '<div id="app"></div><script type="module" src="/src/main.js"></script>',
        '/src/main.js':
          "import { value } from './chain/0.js';\n\ndocument.getElementById('app').textContent = String(value);\n",
        '/vite.config.js': DEFAULT_VITE8_CONFIG_JS,
        ...LATE_FAILURE_MODULES,
      },
      viteVersion: nodeOracle.environment.vite,
      firstMaterialization: { kind: 'install' },
      port: 5174,
    },
  });

  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    const version = await execLine(page, 'vite --version');
    expect(version).toMatchObject({ exit: 0 });
    expect(version.out).toContain(`vite/${nodeOracle.environment.vite}`);
    const baselineWorkers = page.workers();
    expect(baselineWorkers.length).toBeGreaterThan(0);

    await writeOwnerFile(
      page,
      '/scratch/post-failure-process-probe.mjs',
      `import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';

const ps = await new Promise((resolve, reject) =>
  exec('ps -A -o ppid,pid', (error, stdout) => error ? reject(error) : resolve(stdout)));
const rows = ps.toString().trim().split(/\\r?\\n/u).slice(1).map((line) =>
  line.trim().split(/\\s+/u).map(Number));
const probeChildren = rows.filter(([ppid, pid]) => ppid === process.pid && pid !== process.pid);
const orphans = rows.filter(([ppid, pid]) =>
  pid !== 1 && pid !== process.pid && ppid !== process.pid);
process.stdout.write(
  'OWNER_HEALTHY|dist=' + existsSync('dist') +
  '|probeChildren=' + probeChildren.length + '|orphans=' + orphans.length + '\\n');
`,
    );
    const baselineProcesses = await expectCleanProcessProbe(page);

    for (let attempt = 0; attempt < NORMAL_BUILD_ATTEMPTS; attempt += 1) {
      const build = await execLineOutcome(page, 'vite build');
      expect(build.exitCode, build.out).toBe(nodeOracle.result.exitCode);
      expect(build.exit).toEqual({ code: nodeOracle.result.exitCode, signal: null });
      expect(build.closeExit).toEqual(build.exit);
      expect(build.closeShared).toBe(true);
      expect(build.settlements).toBe(1);
      expect(build.out).toContain(`[${nodeOracle.result.diagnosticCode}]`);
      expect(build.out).toContain(nodeOracle.result.diagnostic);
      expect(build.out.match(/\[UNRESOLVED_IMPORT\]/gu)).toHaveLength(
        nodeOracle.result.diagnosticOccurrences,
      );

      await expectHealthyOwner(page);
      await expectWorkerQuiescence(page, baselineWorkers);
      await expectCleanProcessProbe(page, baselineProcesses);
    }

    await writeOwnerFile(page, '/scratch/vite.config.js', WORKER_TEARDOWN_FAULT_CONFIG);
    const faultBuild = await execLineOutcome(page, 'vite build');
    expect(faultBuild.exitCode, faultBuild.out).toBe(nodeOracle.result.exitCode);
    expect(faultBuild.exit).toEqual({ code: nodeOracle.result.exitCode, signal: null });
    expect(faultBuild.closeExit).toEqual(faultBuild.exit);
    expect(faultBuild.closeShared).toBe(true);
    expect(faultBuild.settlements).toBe(1);
    expect(faultBuild.out).toContain('BUILD_REJECTION_BEFORE_WORKER_FAULT:');
    expect(faultBuild.out).toContain(nodeOracle.fixture.missingSpecifier);

    await expectHealthyOwner(page);
    await expectWorkerQuiescence(page, baselineWorkers);
    await expectCleanProcessProbe(page, baselineProcesses);
  } finally {
    await closeOwner(page).catch(() => {});
  }
});
