import { describe, expect, it } from 'vitest';
import { pickupCommit } from './run-pickup.mjs';

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
const directoryTestPaths = roots.flatMap((root) =>
  extensions.flatMap((extension) =>
    ['test', 'tests', '__tests__', 'fixtures', '_test-fixtures', 'test-fixtures'].map(
      (directory) => `${root}/x/${directory}/a.${extension}`,
    ),
  ),
);
const basenameTestPaths = [
  'apps/x/src/test-helper.ts',
  'packages/x/src/a-test-fixture.ts',
  'apps/playground/src/glue/test-monaco-editor.ts',
  'packages/ts-language-service/src/test-workspace-typescript.ts',
  'packages/runtime-wasi/src/syscalls/fd-test-fixture.ts',
  'packages/runtime-wasi/src/syscalls/path-test-fixture.ts',
  'packages/npm-client/src/_test-fixtures/tar-builder.ts',
  'packages/workbench/src/workers/test-fixtures/durable-owner-fs.ts',
];
const testSourcePaths = [...dottedTestPaths, ...directoryTestPaths, ...basenameTestPaths];

function pickupAcrossAuthority(candidatePath: string, finalPath = 'packages/final/src/impl.ts') {
  const git = (...args: string[]) => {
    const key = args.join(' ');
    if (key === 'diff --name-only base HEAD') {
      return `${candidatePath}\ndocs/backlog/playground/save.md\n${finalPath}\n`;
    }
    if (key === 'rev-list --first-parent --reverse base..HEAD') {
      return 'red\nauthority\nsource\n';
    }
    if (key === 'rev-parse red^') return 'base\n';
    if (key === 'rev-parse authority^') return 'red\n';
    if (key === 'rev-parse source^') return 'authority\n';
    if (key === 'diff --name-only base red') return `${candidatePath}\n`;
    if (key === 'diff --name-only red authority') {
      return 'docs/backlog/playground/save.md\n';
    }
    if (key === 'diff --name-only authority source') return `${finalPath}\n`;
    throw new Error(`unexpected git call: ${key}`);
  };
  return pickupCommit('base', git);
}

describe('pickupCommit', () => {
  it('returns the Contract+RED commit immediately before first source', () => {
    const git = (...args: string[]) => {
      const key = args.join(' ');
      if (key === 'diff --name-only base HEAD') return 'packages/x/src/a.ts\n';
      if (key === 'rev-list --first-parent --reverse base..HEAD') return 'contract\nsource\n';
      if (key === 'rev-parse contract^') return 'base\n';
      if (key === 'rev-parse source^') return 'contract\n';
      if (key === 'diff --name-only base contract') return 'docs/backlog/epics/e.md\n';
      if (key === 'diff --name-only contract source') return 'packages/x/src/a.ts\n';
      throw new Error(`unexpected git call: ${key}`);
    };
    expect(pickupCommit('base', git)).toBe('contract');
  });

  it('keeps Contract+RED tests before pickup and returns their ready-authority commit', () => {
    const git = (...args: string[]) => {
      const key = args.join(' ');
      if (key === 'diff --name-only base HEAD') {
        return 'packages/x/src/save.contract.test.ts\npackages/x/src/save.ts\n';
      }
      if (key === 'rev-list --first-parent --reverse base..HEAD') {
        return 'red\nauthority\nsource\n';
      }
      if (key === 'rev-parse red^') return 'base\n';
      if (key === 'rev-parse authority^') return 'red\n';
      if (key === 'rev-parse source^') return 'authority\n';
      if (key === 'diff --name-only base red') {
        return 'packages/x/src/save.contract.test.ts\n';
      }
      if (key === 'diff --name-only red authority') {
        return 'docs/backlog/playground/save.md\n';
      }
      if (key === 'diff --name-only authority source') return 'packages/x/src/save.ts\n';
      throw new Error(`unexpected git call: ${key}`);
    };
    expect(pickupCommit('base', git)).toBe('authority');
  });

  it.each(productionPaths)('starts pickup at ordinary production source %s', (path) => {
    expect(pickupAcrossAuthority(path)).toBe('base');
  });

  it.each([
    'packages/x/src/contest.ts',
    'packages/x/src/fixture-loader.ts',
    'packages/x/src/a-test-fixture-helper.ts',
    'packages/x/mytests/a.ts',
    'packages/x/_test-fixtures-helper/a.ts',
    'packages/test-utils/src/index.ts',
  ])('keeps exact near-miss production source in scope: %s', (path) => {
    expect(pickupAcrossAuthority(path)).toBe('base');
  });

  it.each(testSourcePaths)('keeps test support before pickup for %s', (path) => {
    expect(pickupAcrossAuthority(path)).toBe('authority');
  });

  it('keeps merge-base when the final commit is also test-only', () => {
    const git = (...args: string[]) => {
      const key = args.join(' ');
      if (key === 'diff --name-only base HEAD') {
        return [
          'docs/backlog/playground/save.md',
          'packages/x/src/save.contract.test.ts',
          'services/x/tests/final.ts',
        ].join('\n');
      }
      if (key === 'rev-list --first-parent --reverse base..HEAD') {
        return 'contract\nred\nauthority\nfinal-test\n';
      }
      if (key === 'rev-parse contract^') return 'base\n';
      if (key === 'rev-parse red^') return 'contract\n';
      if (key === 'rev-parse authority^') return 'red\n';
      if (key === 'rev-parse final-test^') return 'authority\n';
      if (key === 'diff --name-only base contract') {
        return 'docs/backlog/playground/save.md\n';
      }
      if (key === 'diff --name-only contract red') {
        return 'packages/x/src/save.contract.test.ts\n';
      }
      if (key === 'diff --name-only red authority') {
        return 'docs/backlog/playground/save.md\n';
      }
      if (key === 'diff --name-only authority final-test') {
        return 'services/x/tests/final.ts\n';
      }
      throw new Error(`unexpected git call: ${key}`);
    };
    expect(pickupCommit('base', git)).toBe('base');
  });

  it('keeps merge-base for a process-only PR', () => {
    const git = (...args: string[]) => {
      const key = args.join(' ');
      if (key === 'diff --name-only base HEAD') return 'docs/process/x.md\n';
      throw new Error(`unexpected git call: ${key}`);
    };
    expect(pickupCommit('base', git)).toBe('base');
  });

  it('ignores source brought only by a main merge when the PR diff is process-only', () => {
    const git = (...args: string[]) => {
      const key = args.join(' ');
      if (key === 'diff --name-only main HEAD') return 'tools/checks/run-pickup.mjs\n';
      throw new Error(`unexpected git call: ${key}`);
    };
    expect(pickupCommit('main', git)).toBe('main');
  });
});
