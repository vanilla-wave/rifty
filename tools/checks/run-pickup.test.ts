import { describe, expect, it } from 'vitest';
import { classifyAutonomousRunPath } from './run-pickup.mjs';

const roots = ['apps', 'packages', 'services'];
const extensions = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];
const productionPaths = roots.flatMap((root) =>
  extensions.map((extension) => `${root}/x/src/a.${extension}`),
);
const dottedTestPaths = roots.flatMap((root) =>
  extensions.flatMap((extension) =>
    ['test', 'spec', 'test-fixture', 'contract-fixtures'].map(
      (suffix) => `${root}/x/src/a.${suffix}.${extension}`,
    ),
  ),
);
const multiPartDottedTestPaths = ['test', 'spec', 'test-fixture', 'contract-fixtures'].map(
  (suffix) => `packages/x/src/a.${suffix}.d.ts`,
);
const directoryTestPaths = roots.flatMap((root) =>
  extensions.flatMap((extension) =>
    ['test', 'tests', '__tests__', 'fixtures', '_test-fixtures', 'test-fixtures'].map(
      (directory) => `${root}/x/${directory}/a.${extension}`,
    ),
  ),
);
const basenameTestPaths = [
  ...extensions.flatMap((extension) => [
    `apps/x/src/test-helper.${extension}`,
    `packages/x/src/a-test-fixture.${extension}`,
  ]),
  'apps/playground/src/glue/test-monaco-editor.ts',
  'packages/ts-language-service/src/test-workspace-typescript.ts',
  'packages/runtime-wasi/src/syscalls/fd-test-fixture.ts',
  'packages/runtime-wasi/src/syscalls/path-test-fixture.ts',
  'packages/npm-client/src/_test-fixtures/tar-builder.ts',
  'packages/workbench/src/workers/test-fixtures/durable-owner-fs.ts',
];
const testSourcePaths = [
  ...dottedTestPaths,
  ...multiPartDottedTestPaths,
  ...directoryTestPaths,
  ...basenameTestPaths,
];

describe('classifyAutonomousRunPath', () => {
  it.each(productionPaths)('classifies ordinary production source: %s', (path) => {
    expect(classifyAutonomousRunPath(path)).toBe('production');
  });

  it.each([
    'packages/x/src/contest.ts',
    'packages/x/src/fixture-loader.ts',
    'packages/x/src/a-test-fixture-helper.ts',
    'packages/x/mytests/a.ts',
    'packages/x/_test-fixtures-helper/a.ts',
    'packages/test-utils/src/index.ts',
  ])('keeps exact near-miss production source in scope: %s', (path) => {
    expect(classifyAutonomousRunPath(path)).toBe('production');
  });

  it.each(testSourcePaths)('classifies test support: %s', (path) => {
    expect(classifyAutonomousRunPath(path)).toBe('test-support');
  });

  it.each([
    'packages/x/src/a.test.d.ts',
    'tools/checks/a.test.ts.snap',
    'docs/process/a.test.coverage.md',
  ])('keeps a multi-part dotted test tail as test support: %s', (path) => {
    expect(classifyAutonomousRunPath(path)).toBe('test-support');
  });

  it.each([
    'docs/backlog/process-meta/test-coverage-debt.md',
    'docs/process/a-test-fixture.md',
    'docs/backlog/playground/save.md',
    'tools/checks/contract-drift.mjs',
  ])('keeps non-production paths as other: %s', (path) => {
    expect(classifyAutonomousRunPath(path)).toBe('other');
  });
});
