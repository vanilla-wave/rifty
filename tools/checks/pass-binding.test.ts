import { describe, expect, it } from 'vitest';
import { evaluateBinding } from './pass-binding.mjs';

const SHA = 'a'.repeat(40);
const artifact = 'docs/backlog/net/reference/x-final-green.json';
const verdict = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    checkpoint: 'Final+GREEN',
    unit_goal_source: 'docs/backlog/net/x.md @ BASE',
    axes: Array.from({ length: 8 }, (_, i) => ({ axis: `a${i}`, verdict: 'pass', findings: [] })),
    coverage: [],
    reviewed_sha: SHA,
    ...extra,
  });
const ordinaryVerdict = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    checkpoint: 'ordinary',
    verdict: 'pass — no FIX left',
    reception: [{ summary: 'naming', ruling: 'NOTE', by: 'driver', authority: '' }],
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
    // A re-pointed sha on an otherwise unchanged verdict is no review; a changed verdict is.
    expect(
      evaluateBinding(input({ readBase: () => verdict({ reviewed_sha: 'b'.repeat(40) }) })).status,
    ).toBe('fail');
    expect(
      evaluateBinding(
        input({
          readBase: () => verdict({ reviewed_sha: 'b'.repeat(40), coverage: [{ row: 'old' }] }),
        }),
      ).status,
    ).toBe('ok');
    expect(evaluateBinding(input({ isAncestor: () => false })).status).toBe('fail');
    expect(evaluateBinding(input({ diffSince: () => ['packages/x/src/b.ts'] })).status).toBe(
      'fail',
    );
  });
  it('accepts a shaped ordinary landing artifact; refuses a driver-REJECTed Fidelity blocker (REV-12)', () => {
    const ordinary = 'docs/backlog/net/reference/pr-12-ordinary.json';
    const withOrdinary = (text: string) =>
      input({
        changed: ['packages/x/src/a.ts', ordinary],
        readHead: (path) => (path === ordinary ? text : null),
      });
    expect(evaluateBinding(withOrdinary(ordinaryVerdict())).status).toBe('ok');
    expect(
      evaluateBinding(withOrdinary(JSON.stringify({ checkpoint: 'ordinary', reviewed_sha: SHA })))
        .status,
    ).toBe('fail');
    const driverReject = ordinaryVerdict({
      reception: [
        { summary: 'stub', ruling: 'REJECT', by: 'driver', authority: 'AGENTS.md §Fidelity: fake' },
      ],
    });
    expect(evaluateBinding(withOrdinary(driverReject)).status).toBe('fail');
    const criticReject = ordinaryVerdict({
      reception: [
        { summary: 'stub', ruling: 'REJECT', by: 'critic', authority: 'AGENTS.md §Fidelity: fake' },
      ],
    });
    expect(evaluateBinding(withOrdinary(criticReject)).status).toBe('ok');
  });
});
