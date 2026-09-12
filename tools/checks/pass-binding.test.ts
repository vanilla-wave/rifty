import { describe, expect, it } from 'vitest';
import { REQUIRED_AXES } from '../review/blockers.mjs';
import { evaluateBinding } from './pass-binding.mjs';

const SHA = 'a'.repeat(40);
const artifact = 'docs/backlog/net/reference/x-final-green.json';
const verdict = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    checkpoint: 'Final+GREEN',
    unit_goal_source: 'PR #312',
    axes: REQUIRED_AXES.map((axis) => ({ axis, verdict: 'pass', findings: [] })),
    overall_verdict: 'pass',
    merge_call: 'Proceed.',
    unit_residuals: [],
    goal_residuals: [],
    goal_complete: false,
    coverage: [],
    reviewed_sha: SHA,
    ...extra,
  });
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
    // Parity cases are product tests: they need a landing verdict too.
    expect(
      evaluateBinding(input({ changed: ['tools/node-parity-runner/cases/fs/x.case.ts'] })).status,
    ).toBe('fail');
  });
  it('fails a product change with no landing artifact, an unshaped or re-pointed artifact, a foreign sha, or a product change after the PASS', () => {
    expect(evaluateBinding(input({ changed: ['packages/x/src/a.ts'] })).status).toBe('fail');
    expect(
      evaluateBinding(input({ readHead: () => JSON.stringify({ checkpoint: 'Final+GREEN' }) }))
        .status,
    ).toBe('fail');
    // A one-field JSON with a sha is not a verdict.
    expect(
      evaluateBinding(input({ readHead: () => JSON.stringify({ reviewed_sha: SHA }) })).status,
    ).toBe('fail');
    expect(evaluateBinding(input({ isAncestor: () => false })).status).toBe('fail');
    expect(evaluateBinding(input({ diffSince: () => ['packages/x/src/b.ts'] })).status).toBe(
      'fail',
    );
  });
  it('checks surviving contract content and reads deleted contracts at the reviewed revision', () => {
    const contract = 'docs/backlog/net/x.md';
    const before = '## Acceptance\n1. bytes → I1\n';
    const report = verdict({
      unit_goal_source: contract,
      coverage: [
        {
          row: 'bytes',
          source: 'acceptance',
          trace: 'I1',
          status: 'pass',
          citation: 'x.test.ts:1',
          note: '',
        },
      ],
    });
    const run = (head: string | null) =>
      evaluateBinding(
        input({
          readHead: (path) => (path === artifact ? report : head),
          readReviewed: (path) => (path === contract ? before : null),
        }),
      );
    expect(run(before).status).toBe('ok');
    expect(run('## Acceptance\n1. roughly bytes → I1\n').status).toBe('fail');
    expect(run(null).status).toBe('ok');
  });
});
