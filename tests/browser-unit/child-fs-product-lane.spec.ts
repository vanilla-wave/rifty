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
  const ordinal = 7;
  await gotoHarness(page);
  const observed = await page.evaluate(
    async ({ laneUrl, ordinal, sealedUrl }) => {
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
      const result = await lane.runChildFsProductLane(ordinal, host);
      let closed = false;
      try {
        sealed.currentProject();
      } catch {
        closed = true;
      }
      return { result, calls, closed, actualCoi: globalThis.crossOriginIsolated === true };
    },
    { laneUrl: laneFixtureUrl, ordinal, sealedUrl: sealedWorkbenchFixtureUrl },
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
  expect(observed.calls.filter(({ kind }) => kind === 'open')).toHaveLength(1);
  const executes = observed.calls.filter(({ kind }) => kind === 'execute');
  expect(executes.map(({ line }) => line)).toEqual([
    'npm install',
    'vite build',
    `node express-anchor.cjs product-coi-${ordinal}`,
  ]);
  const callIndex = (predicate: (call: Record<string, unknown>) => boolean): number =>
    observed.calls.findIndex(predicate);
  const openIndex = callIndex(({ kind }) => kind === 'open');
  const installIndex = callIndex(({ kind, line }) => kind === 'execute' && line === 'npm install');
  const dependencyReadIndexes = Object.keys(childFsScenario().dependencies).map((dependency) =>
    callIndex(
      ({ kind, path }) => kind === 'read' && path === `/node_modules/${dependency}/package.json`,
    ),
  );
  for (const [dependency, version] of Object.entries(childFsScenario().dependencies)) {
    const manifestRead = observed.calls.find(
      ({ kind, path }) => kind === 'read' && path === `/node_modules/${dependency}/package.json`,
    );
    if (typeof manifestRead?.text !== 'string') {
      throw new TypeError(`missing recorded manifest text for ${dependency}`);
    }
    expect(JSON.parse(manifestRead.text)).toMatchObject({ version });
  }
  const marker = `product-coi-${ordinal}`;
  const panelSeed = childFsScenario().files['/src/Panel.jsx'];
  if (panelSeed === undefined) throw new TypeError('canonical Panel seed is missing');
  const markerSource = panelSeed
    .replace('bench-seed', marker)
    .replace('bench-seed', `run-${ordinal}`);
  const writes = observed.calls.filter(({ kind }) => kind === 'write');
  expect(writes).toEqual([{ kind: 'write', path: '/src/Panel.jsx', contents: markerSource }]);
  const markerWriteIndex = callIndex(({ kind }) => kind === 'write');
  const viteIndex = callIndex(({ kind, line }) => kind === 'execute' && line === 'vite build');
  const assetsIndex = callIndex(({ kind, path }) => kind === 'readdir' && path === '/dist/assets');
  const emittedReadIndexes = observed.calls
    .map((call, index) => ({ call, index }))
    .filter(
      ({ call: { kind, path } }) =>
        kind === 'read' &&
        typeof path === 'string' &&
        path.startsWith('/dist/assets/') &&
        path.endsWith('.js'),
    )
    .map(({ index }) => index);
  const expressIndex = callIndex(
    ({ kind, line }) =>
      kind === 'execute' && line === `node express-anchor.cjs product-coi-${ordinal}`,
  );
  const closeIndexes = observed.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call: { kind } }) => kind === 'close')
    .map(({ index }) => index);
  expect(dependencyReadIndexes.every((index) => index > installIndex)).toBe(true);
  expect(emittedReadIndexes).not.toHaveLength(0);
  expect(Math.min(...emittedReadIndexes)).toBeGreaterThan(assetsIndex);
  const phaseIndexes = [
    openIndex,
    installIndex,
    Math.max(...dependencyReadIndexes),
    markerWriteIndex,
    viteIndex,
    assetsIndex,
    Math.max(...emittedReadIndexes),
    expressIndex,
    closeIndexes[0] ?? -1,
  ];
  expect(phaseIndexes).toEqual(phaseIndexes.toSorted((left, right) => left - right));
  expect(closeIndexes).toHaveLength(1);
  expect(closeIndexes[0]).toBe(observed.calls.length - 1);
  expect(observed.result.lifecycle.vite).toEqual(executes[1]?.outcome);
  expect(observed.result.lifecycle.express).toEqual(executes[2]?.outcome);
  type RecordedOutcome = {
    readonly exitCode: number;
    readonly exit: { readonly code: number | null; readonly signal: string | null };
    readonly closeExit: { readonly code: number | null; readonly signal: string | null };
    readonly closeShared: boolean;
    readonly settlements: number;
    readonly out: string;
  };
  const viteOutcome = executes[1]?.outcome as RecordedOutcome | undefined;
  const expressOutcome = executes[2]?.outcome as RecordedOutcome | undefined;
  for (const outcome of [viteOutcome, expressOutcome]) {
    expect(outcome).toMatchObject({
      exitCode: 0,
      exit: { code: 0, signal: null },
      closeExit: { code: 0, signal: null },
      closeShared: true,
      settlements: 1,
    });
    expect(outcome?.exit).toEqual(outcome?.closeExit);
  }
  const emittedJavaScript = observed.calls
    .filter(
      ({ kind, path }) =>
        kind === 'read' &&
        typeof path === 'string' &&
        path.startsWith('/dist/assets/') &&
        path.endsWith('.js'),
    )
    .map(({ text }) => {
      if (typeof text !== 'string') throw new TypeError('recorded emitted asset must be text');
      return text;
    })
    .join('\n');
  expect(observed.result.sample).toEqual({
    lane: 'product-coi',
    topology: 'owner-sync-rpc-kernel-child',
    ordinal,
    ownerLoad: 'idle',
    vite: {
      exitCode: viteOutcome?.exitCode,
      rawOutput: viteOutcome?.out,
      emittedJavaScript,
      marker,
    },
    express: {
      exitCode: expressOutcome?.exitCode,
      rawOutput: expressOutcome?.out,
      marker,
    },
  });
  const sample = validateChildFsRawSample(observed.result.sample);
  expect(sample.vite.transformedModules).toBe(2180);
});
