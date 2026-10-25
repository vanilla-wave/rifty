import { describe, expect, it } from 'vitest';
import { REQUIRED_AXES, evaluateVerdict } from '../review/blockers.mjs';
import { evaluate } from './contract-drift.mjs';
import { evaluateBinding } from './pass-binding.mjs';
import { TASKS } from './pr-check.mjs';

describe('delivery without process-created PR boundaries', () => {
  it.each([
    ['packages/runtime-js/package.json'],
    ['packages/runtime-js/src/index.ts', 'packages/runtime-js/package.json'],
    ['packages/runtime-js/src/index.ts', 'tools/node-parity-runner/src/diff.ts'],
  ])(
    'allows one delivery containing %j; independent review owns changes to its judges',
    (...paths) => {
      expect(
        evaluate(
          paths.map((path) => ({ status: 'M', path })),
          () => null,
        ),
      ).toEqual([]);
    },
  );

  it('accepts a recorded user amendment without closing and recreating the goal', () => {
    const goal = 'docs/backlog/epics/example/goal.md';
    const before = '---\nstatus: ready\n---\n## Outcome\nA\n## Invariants\n1. A works.\n';
    const after = before.replace('1. A works.', '1. B works.');
    const entries = [{ status: 'M', path: goal }];
    expect(
      evaluate(entries, (_path, side) => (side === 'base' ? before : after)).length,
    ).toBeGreaterThan(0);
    expect(
      evaluate(entries, (_path, side) =>
        side === 'base'
          ? before
          : `${after}\n## Decisions\namend: 2026-09-07 — user: replace A with B\n`,
      ),
    ).toEqual([]);
  });
});

describe('one verdict validator at review and merge', () => {
  const sha = 'a'.repeat(40);
  const artifact = 'docs/backlog/process-meta/reference/example-final-green.json';
  const report = {
    checkpoint: 'Final+GREEN',
    unit_goal_source: 'PR #312',
    overall_verdict: 'blocker',
    merge_call: 'Do not merge.',
    axes: REQUIRED_AXES.map((axis) => ({ axis, verdict: 'pass', findings: [] })),
    coverage: [],
    unit_residuals: [],
    goal_residuals: [],
    goal_complete: false,
    reviewed_sha: sha,
  };
  const input = (verdict: unknown) => ({
    changed: ['packages/runtime-js/src/index.ts', artifact],
    readHead: (path: string) => (path === artifact ? JSON.stringify(verdict) : null),
    isAncestor: () => true,
    diffSince: () => [],
    draft: false,
  });

  it('a correctly shaped BLOCK is still a BLOCK at merge', () => {
    expect(evaluateBinding(input(report)).status).toBe('fail');
  });

  it('a missing ADR proof cannot be hidden behind a landing artifact', () => {
    expect(
      evaluateBinding(
        input({
          ...report,
          overall_verdict: 'pass',
          coverage: [
            {
              row: 'durable write',
              source: 'acceptance',
              trace: 'ADR-0358',
              status: 'missing',
              citation: 'example.md:1',
              note: 'No durability proof.',
            },
          ],
        }),
      ).status,
    ).toBe('fail');
  });

  const disputed = () => ({
    ...report,
    axes: REQUIRED_AXES.map((axis) => ({
      axis,
      verdict: 'pass',
      findings:
        axis === 'Bugs'
          ? [
              {
                severity: 'blocker',
                summary: 'disputed I1',
                authority: 'I1',
                location: 'x.ts:1',
              },
            ]
          : [],
    })),
    adjudication: [
      { summary: 'disputed I1', ruling: 'FALSE', clause: 'x.test.ts:1', by: 'critic' },
    ],
  });

  it('rejecting one finding cannot erase an unrelated required residual', () => {
    const result = {
      ...disputed(),
      unit_residuals: [{ clause: 'I2', location: 'goal.md:2', summary: 'I2 still absent' }],
    };
    expect(evaluateVerdict(result).code).toBe(1);
    expect(evaluateBinding(input(result)).status).toBe('fail');
  });

  it('a dismissal must name an independent critic', () => {
    const result = {
      ...disputed(),
      adjudication: [{ summary: 'disputed I1', ruling: 'FALSE', clause: 'x.test.ts:1' }],
    };
    expect(evaluateVerdict(result).code).toBe(2);
  });

  it.each(['Outcome', 'Invariants'])(
    'changing goal %s invalidates its review even with a user amendment',
    (section) => {
      const goal = 'docs/backlog/epics/example/goal.md';
      const before = `---\nkind: epic\nstatus: ready\ntier: works\n---\n## ${section}\noriginal promise\n`;
      const after = `${before.replace('original promise', 'new promise')}\n## Decisions\namend: 2026-09-07 — user: new promise\n`;
      const result = { ...report, overall_verdict: 'pass', unit_goal_source: goal };
      expect(
        evaluateBinding({
          ...input(result),
          readHead: (path) =>
            path === artifact ? JSON.stringify(result) : path === goal ? after : null,
          readReviewed: (path) => (path === goal ? before : null),
          diffSince: () => [goal],
        }).status,
      ).toBe('fail');
    },
  );
});

it('pre-review tests do not require a review that has not happened yet', () => {
  expect(TASKS.some((task) => task.name === 'check:pass-binding')).toBe(false);
});
