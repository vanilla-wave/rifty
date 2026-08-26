import { expect, test } from '@playwright/test';
import { childFsScenario, childFsScenarioIdentity } from '../../tools/perf/child-fs/scenario.mjs';
import { validateChildFsRawSample } from '../../tools/perf/src/child-fs-artifact.mjs';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const laneFixtureUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/child-fs-product-lane.ts`;

test('canonical anchors follow the recorded real sealed-Workbench product path', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await gotoHarness(page);
  const observed = await page.evaluate(
    async ({ laneUrl, sealedUrl }) => {
      const [lane, sealed] = await Promise.all([
        import(/* @vite-ignore */ laneUrl),
        import(/* @vite-ignore */ sealedUrl),
      ]);
      const calls: Array<Record<string, unknown>> = [];
      const host = {
        coi: globalThis.crossOriginIsolated === true,
        async open(plan: unknown) {
          calls.push({ kind: 'open', plan });
          await sealed.openSealedWorkbenchFixture({
            workspaceId: 'child-fs-product-lane',
            persistence: 'ephemeral',
            plan,
          });
        },
        async writeText(path: string, contents: string) {
          calls.push({ kind: 'write', path, contents });
          await sealed.writeProjectText(`/scratch${path}`, contents);
        },
        async execute(line: string) {
          const outcome = await sealed.executeProjectLineOutcome(line);
          calls.push({ kind: 'execute', line, outcome });
          return outcome;
        },
        async readdir(path: string) {
          const entries = await sealed.currentProject().files.readdir(path);
          calls.push({ kind: 'readdir', path, entries });
          return entries;
        },
        async readText(path: string) {
          const read = await sealed.currentProject().files.readFile(path);
          const text = new TextDecoder().decode(read.bytes);
          calls.push({ kind: 'read', path, text });
          return text;
        },
        async close() {
          calls.push({ kind: 'close' });
          await sealed.closeSealedWorkbenchFixture();
        },
      };
      const result = await lane.runChildFsProductLane(1, host);
      let closed = false;
      try {
        sealed.currentProject();
      } catch {
        closed = true;
      }
      return { result, calls, closed, actualCoi: globalThis.crossOriginIsolated === true };
    },
    { laneUrl: laneFixtureUrl, sealedUrl: sealedWorkbenchFixtureUrl },
  );

  expect(observed.actualCoi).toBe(true);
  expect(observed.closed).toBe(true);
  expect(observed.result.identity).toEqual(childFsScenarioIdentity());
  expect(observed.calls[0]).toEqual({
    kind: 'open',
    plan: {
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'child-fs-product-lane',
      templateId: 'browser-unit:child-fs-product-lane-v1',
      files: childFsScenario().files,
      dependencies: childFsScenario().dependencies,
      firstMaterialization: { kind: 'install' },
      entryPath: '/express-anchor.cjs',
    },
  });
  const executes = observed.calls.filter(({ kind }) => kind === 'execute');
  expect(executes.map(({ line }) => line)).toEqual([
    'npm install',
    'vite build',
    'node express-anchor.cjs product-coi-1',
  ]);
  expect(observed.calls.at(-1)).toEqual({ kind: 'close' });
  for (const dependency of Object.keys(childFsScenario().dependencies)) {
    expect(
      observed.calls.some(
        ({ kind, path }) => kind === 'read' && path === `/node_modules/${dependency}/package.json`,
      ),
    ).toBe(true);
  }
  expect(
    observed.calls.some(({ kind, path }) => kind === 'readdir' && path === '/dist/assets'),
  ).toBe(true);
  expect(
    observed.calls.some(
      ({ kind, path }) => kind === 'read' && typeof path === 'string' && path.endsWith('.js'),
    ),
  ).toBe(true);
  expect(observed.result.lifecycle.vite).toEqual(executes[1]?.outcome);
  expect(observed.result.lifecycle.express).toEqual(executes[2]?.outcome);
  const sample = validateChildFsRawSample(observed.result.sample);
  expect(sample).toEqual(observed.result.sample);
  expect(sample.vite.transformedModules).toBe(2180);
});
