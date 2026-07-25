import { describe, expect, it } from 'vitest';
import { pickupCommit } from './run-pickup.mjs';

describe('pickupCommit', () => {
  it('returns the Contract+RED commit immediately before first source', () => {
    const git = (...args: string[]) => {
      const key = args.join(' ');
      if (key === 'rev-list --first-parent --reverse base..HEAD') return 'contract\nsource\n';
      if (key === 'rev-parse contract^') return 'base\n';
      if (key === 'rev-parse source^') return 'contract\n';
      if (key === 'diff --name-only base contract') return 'docs/backlog/epics/e.md\n';
      if (key === 'diff --name-only contract source') return 'packages/x/src/a.ts\n';
      throw new Error(`unexpected git call: ${key}`);
    };
    expect(pickupCommit('base', git)).toBe('contract');
  });

  it('keeps merge-base for a process-only PR', () => {
    const git = (...args: string[]) => {
      const key = args.join(' ');
      if (key === 'rev-list --first-parent --reverse base..HEAD') return 'docs\n';
      if (key === 'rev-parse docs^') return 'base\n';
      if (key === 'diff --name-only base docs') return 'docs/process/x.md\n';
      throw new Error(`unexpected git call: ${key}`);
    };
    expect(pickupCommit('base', git)).toBe('base');
  });
});
