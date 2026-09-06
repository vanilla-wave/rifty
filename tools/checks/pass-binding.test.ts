import { describe, expect, it } from 'vitest';
import { evaluateBinding } from './pass-binding.mjs';

const SHA = 'a'.repeat(40);
const artifact = 'docs/backlog/net/reference/x-final-green.json';
const verdict = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ checkpoint: 'Final+GREEN', reviewed_sha: SHA, ...extra });

const input = (over: Partial<Parameters<typeof evaluateBinding>[0]> = {}) => ({
  changed: ['packages/x/src/a.ts', artifact],
  readHead: (path: string) => (path === artifact ? verdict() : null),
  isAncestor: (sha: string) => sha === SHA,
  diffSince: () => ['docs/backlog/net/x.md', 'CHANGELOG.md'],
  draft: false,
  ...over,
});

describe('evaluateBinding (REV-8 merge-time binding)', () => {
  it('binds when the landing verdict names an ancestor and only documentation changed after it', () => {
    expect(evaluateBinding(input()).status).toBe('ok');
  });
  it('skips a draft PR and a PR with no product or test path', () => {
    expect(evaluateBinding(input({ draft: true })).status).toBe('skipped');
    expect(evaluateBinding(input({ changed: ['docs/x.md', artifact] })).status).toBe('skipped');
    // Referee tests and tooling are not the product tree (PR-4 guards them).
    expect(
      evaluateBinding(
        input({ changed: ['tools/checks/contract-drift.test.ts', 'tools/checks/x.mjs'] }),
      ).status,
    ).toBe('skipped');
    expect(evaluateBinding(input({ changed: ['tests/e2e/x.spec.ts'] })).status).toBe('fail');
  });
  it('fails a product change with no landing artifact, a forged sha, a foreign sha, or a product change after the PASS', () => {
    expect(evaluateBinding(input({ changed: ['packages/x/src/a.ts'] })).status).toBe('fail');
    expect(
      evaluateBinding(input({ readHead: () => JSON.stringify({ checkpoint: 'Final+GREEN' }) }))
        .status,
    ).toBe('fail');
    expect(evaluateBinding(input({ isAncestor: () => false })).status).toBe('fail');
    expect(evaluateBinding(input({ diffSince: () => ['packages/x/src/b.ts'] })).status).toBe(
      'fail',
    );
  });
  it('accepts an ordinary landing artifact the same way', () => {
    const ordinary = 'docs/backlog/net/reference/pr-12-ordinary.json';
    expect(
      evaluateBinding(
        input({
          changed: ['packages/x/src/a.ts', ordinary],
          readHead: (path) => (path === ordinary ? verdict({ checkpoint: 'ordinary' }) : null),
        }),
      ).status,
    ).toBe('ok');
  });
});
