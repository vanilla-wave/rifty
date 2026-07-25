import { describe, expect, it } from 'vitest';
import { REQUIRED_AXES, evaluateVerdict } from '../review/blockers.mjs';

const verdict = (overrides: Record<string, unknown> = {}) => ({
  overall_verdict: 'pass',
  merge_call: 'Proceed.',
  checkpoint: 'Final+GREEN',
  unit_goal_source: 'docs/backlog/playground/a.md@base',
  unit_residuals: [],
  goal_residuals: [],
  goal_complete: true,
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
          ? [{ severity: 'blocker', location: 'x.ts:1', summary: 'Wrong bytes.' }]
          : [],
    }));
    expect(evaluateVerdict(verdict({ overall_verdict: 'blocker', axes })).code).toBe(1);
  });
});
