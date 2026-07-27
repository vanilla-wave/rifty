import { describe, expect, it } from 'vitest';
import { pickupCommit } from './run-pickup.mjs';

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
