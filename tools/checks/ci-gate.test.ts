import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error plain .mjs module without type declarations
import { evaluateGate } from './ci-gate.mjs';

function gate(overrides: Record<string, string>): string[] {
  return evaluateGate({
    code: 'true',
    changeScope: 'success',
    lint: 'success',
    unit: 'success',
    e2e: 'success',
    browserUnit: 'success',
    noCoi: 'success',
    ...overrides,
  });
}

describe('CI gate reducer', () => {
  it('passes a code-affecting PR with every job green', () => {
    expect(gate({})).toEqual([]);
  });

  it('passes a docs-only PR with heavy jobs skipped', () => {
    expect(
      gate({
        code: 'false',
        unit: 'skipped',
        e2e: 'skipped',
        browserUnit: 'skipped',
        noCoi: 'skipped',
      }),
    ).toEqual([]);
  });

  it('fails a docs-only PR whose heavy jobs unexpectedly ran', () => {
    expect(gate({ code: 'false' })).not.toEqual([]);
  });

  it('fails on any heavy job failure', () => {
    expect(gate({ e2e: 'failure' })).not.toEqual([]);
    expect(gate({ unit: 'cancelled' })).not.toEqual([]);
  });

  it('fails on lint failure regardless of classification', () => {
    expect(
      gate({
        code: 'false',
        lint: 'failure',
        unit: 'skipped',
        e2e: 'skipped',
        browserUnit: 'skipped',
        noCoi: 'skipped',
      }),
    ).not.toEqual([]);
  });

  // false-fallback fault row: classifier death must degrade to the full suite,
  // never let heavy coverage silently skip (ADR-0323 §2/§4).
  it('names only the dead classifier when heavy jobs failed open and ran green', () => {
    const errors = gate({ code: '', changeScope: 'failure' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('change-scope');
    expect(errors[0]).toContain('fails open');
    expect(errors[0]).not.toContain('invalid');
  });

  it('rejects skipped heavy jobs when the classifier died', () => {
    const errors = gate({
      code: '',
      changeScope: 'failure',
      unit: 'skipped',
      e2e: 'skipped',
      browserUnit: 'skipped',
      noCoi: 'skipped',
    });
    expect(errors.filter((e: string) => e.includes("expected 'success'"))).toHaveLength(4);
  });

  it('rejects garbage classifier output from a successful job', () => {
    const errors = gate({ code: 'maybe' });
    expect(errors.some((e: string) => e.includes("invalid code='maybe'"))).toBe(true);
  });
});
