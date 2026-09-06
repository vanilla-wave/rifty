import { describe, expect, it } from 'vitest';
import { REQUIRED_AXES, evaluateVerdict } from '../review/blockers.mjs';

it('drops coverage rows traced only to a rule id — a carrier note raises no row (RDY-3, REV-4)', () => {
  const traced = {
    row: 'Acceptance 1',
    source: 'x',
    trace: '→ I1',
    status: 'pass',
    citation: 'a:1',
    note: '',
  };
  const ruleOnly = {
    row: 'Acceptance 2',
    source: 'x',
    trace: '→ REV-7',
    status: 'missing',
    citation: 'a:2',
    note: 'no carrier',
  };
  const verdict = {
    checkpoint: 'Final+GREEN',
    unit_goal_source: 'docs/backlog/x/y.md',
    overall_verdict: 'pass',
    merge_call: 'merge',
    axes: REQUIRED_AXES.map((axis) => ({ axis, verdict: 'pass', findings: [] })),
    coverage: [traced, ruleOnly],
    unit_residuals: [],
    goal_residuals: [],
    goal_complete: false,
  };
  expect(evaluateVerdict(verdict).code).toBe(0);
  expect(evaluateVerdict({ ...verdict, coverage: [ruleOnly] }).code).toBe(0); // rule-id rows raise nothing
});

it('pins the REV-10 axis names in rubric order', () => {
  expect(REQUIRED_AXES).toEqual([
    'Completeness',
    'Mission and architecture',
    'Goal drift',
    'Approach cost',
    'Scope',
    'Bugs',
    'Regressions',
    'Ecosystem UX',
  ]);
});

const verdict = (overrides: Record<string, unknown> = {}) => ({
  overall_verdict: 'pass',
  merge_call: 'Proceed.',
  checkpoint: 'Final+GREEN',
  unit_goal_source: 'docs/backlog/playground/a.md@base',
  unit_residuals: [],
  goal_residuals: [],
  goal_complete: true,
  coverage: [
    {
      row: 'Acceptance 1: offline reopen restores the tree',
      source: 'acceptance',
      trace: 'I1',
      status: 'pass',
      citation: 'a.test.ts:10',
      note: '',
    },
  ],
  axes: REQUIRED_AXES.map((axis) => ({ axis, verdict: 'pass', findings: [] })),
  ...overrides,
});

describe('evaluateVerdict', () => {
  it('passes only a complete report with no blockers or goal residuals', () => {
    expect(evaluateVerdict(verdict()).code).toBe(0);
  });

  it('allows a complete slice while keeping the wider goal visibly active', () => {
    const result = evaluateVerdict(
      verdict({
        goal_complete: false,
        goal_residuals: [
          {
            clause: 'next ready child',
            location: 'docs/backlog/epics/e.md:20',
            summary: 'Required by the goal after this slice.',
          },
        ],
      }),
    );
    expect(result.code).toBe(0);
    expect(result.goalComplete).toBe(false);
  });

  it('treats an uncovered current-slice clause as a blocker', () => {
    const result = evaluateVerdict(
      verdict({
        goal_complete: false,
        unit_residuals: [
          {
            clause: 'offline reopen',
            location: 'docs/backlog/playground/a.md:20',
            summary: 'No acceptance proof in this PR.',
          },
        ],
      }),
    );
    expect(result.code).toBe(1);
    expect(result.blockers[0].axis).toBe('Unit residual');
  });

  it('rejects missing checkpoint/residual accounting, impossible completion, and missing axes', () => {
    expect(evaluateVerdict(verdict({ checkpoint: undefined })).code).toBe(2);
    const missingResiduals = verdict();
    (missingResiduals as { goal_residuals?: unknown }).goal_residuals = undefined;
    expect(evaluateVerdict(missingResiduals).code).toBe(2);
    expect(
      evaluateVerdict(
        verdict({
          goal_complete: true,
          goal_residuals: [
            {
              clause: 'offline reopen',
              location: 'docs/backlog/epics/e.md:20',
              summary: 'Still open.',
            },
          ],
        }),
      ).code,
    ).toBe(2);
    expect(
      evaluateVerdict(
        verdict({
          goal_complete: true,
          unit_residuals: [
            {
              clause: 'current acceptance',
              location: 'docs/backlog/a.md:20',
              summary: 'Still open.',
            },
          ],
        }),
      ).code,
    ).toBe(2);
    expect(evaluateVerdict(verdict({ axes: [] })).code).toBe(2);
    expect(evaluateVerdict(verdict({ axes: [...verdict().axes].reverse() })).code).toBe(2);
  });

  it('preserves ordinary blocker behavior', () => {
    const axes = REQUIRED_AXES.map((axis) => ({
      axis,
      verdict: axis === 'Bugs' ? 'blocker' : 'pass',
      findings:
        axis === 'Bugs'
          ? [
              {
                severity: 'blocker',
                location: 'x.ts:1',
                summary: 'Wrong bytes.',
                authority: 'docs/backlog/playground/a.md:12 — Acceptance 1 requires exact bytes',
              },
            ]
          : [],
    }));
    expect(evaluateVerdict(verdict({ overall_verdict: 'blocker', axes })).code).toBe(1);
  });

  it('rejects missing coverage, non-pass rows without notes, rows without trace, and blockers without authority', () => {
    expect(evaluateVerdict(verdict({ coverage: [] })).code).toBe(0); // no traced obligation: valid, nothing to cover
    expect(
      evaluateVerdict(
        verdict({
          coverage: [
            {
              row: 'r',
              source: 'acceptance',
              trace: 'I1',
              status: 'weak',
              citation: 'a.test.ts:1',
              note: '',
            },
          ],
        }),
      ).code,
    ).toBe(2);
    const untraced = evaluateVerdict(
      verdict({
        coverage: [
          { row: 'r', source: 'acceptance', status: 'pass', citation: 'a.test.ts:1', note: '' },
        ],
      }),
    );
    expect(untraced.code).toBe(2);
    expect(untraced.errors[0]).toContain('without trace');
    const axes = REQUIRED_AXES.map((axis) => ({
      axis,
      verdict: 'pass',
      findings:
        axis === 'Bugs' ? [{ severity: 'blocker', location: 'x.ts:1', summary: 'No cite.' }] : [],
    }));
    expect(evaluateVerdict(verdict({ axes })).code).toBe(2);
  });

  it('weak coverage rows are advisory; missing rows block (REV-4)', () => {
    const row = (status: string) => ({
      row: 'r',
      source: 'fault-matrix',
      trace: 'I2',
      status,
      citation: 'a.test.ts:1',
      note: 'lossy assertion',
    });
    const weak = evaluateVerdict(verdict({ coverage: [row('weak')] }));
    expect(weak.code).toBe(0);
    expect(weak.uncovered).toHaveLength(1);
    expect(evaluateVerdict(verdict({ coverage: [row('missing')] })).code).toBe(1);
    expect(evaluateVerdict(verdict({ coverage: [row('weak')] }), []).code).toBe(0);
    expect(evaluateVerdict(verdict({ coverage: [row('missing')] }), []).code).toBe(1);
  });

  it('adjudication demotes STRETCH to concern and blocks only surviving HOLDS', () => {
    const blocker = (summary: string) => ({
      severity: 'blocker',
      location: 'x.ts:1',
      summary,
      authority: 'docs/backlog/playground/a.md:12',
    });
    const axes = REQUIRED_AXES.map((axis) => ({
      axis,
      verdict: axis === 'Bugs' ? 'blocker' : 'pass',
      findings: axis === 'Bugs' ? [blocker('Real gap.'), blocker('Taste demand.')] : [],
    }));
    const withBoth = verdict({ overall_verdict: 'blocker', goal_complete: false, axes });
    const survived = evaluateVerdict(withBoth, [
      { summary: 'Real gap.', ruling: 'HOLDS' },
      { summary: 'Taste demand.', ruling: 'STRETCH' },
    ]);
    expect(survived.code).toBe(1);
    expect(survived.blockers.map((f: { summary: string }) => f.summary)).toEqual(['Real gap.']);
    expect(survived.demoted.map((f: { summary: string }) => f.summary)).toEqual(['Taste demand.']);
    const allDemoted = evaluateVerdict(withBoth, [
      { summary: 'Real gap.', ruling: 'FALSE' },
      { summary: 'Taste demand.', ruling: 'STRETCH' },
    ]);
    expect(allDemoted.code).toBe(0);
    expect(evaluateVerdict(withBoth, [{ summary: 'No such.', ruling: 'STRETCH' }]).code).toBe(2);
  });
});
