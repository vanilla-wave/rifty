import { describe, expect, it } from 'vitest';
import { analyzeMilestones, classifySpec } from './e2e-coverage.mjs';

describe('e2e-coverage spec classification', () => {
  it('classifies an env-gated suite as gated (skipped in default CI)', () => {
    const content = `const enabled = process.env.RIFTY_E2E_HMR === '1';
      test.describe('M10', () => {
        test.skip(!enabled, 'set RIFTY_E2E_HMR=1');
        test('does a thing', async () => {});
      });`;
    expect(classifySpec(content)).toBe('gated');
  });

  it('classifies an unconditional retired skip as inert', () => {
    const content = `test.describe('M10 dev', () => {
      test.skip('dev-hmr preset was retired', async () => {});
    });`;
    expect(classifySpec(content)).toBe('inert');
  });

  it('classifies a normal runnable spec as active', () => {
    const content = `test('boots', async () => { await page.goto('/'); });`;
    expect(classifySpec(content)).toBe('active');
  });

  it('does not count a milestone with only gated/inert specs as CI-active', () => {
    const result = analyzeMilestones([
      {
        milestone: 10,
        name: 'm10-hmr.spec.ts',
        content: "const enabled = process.env.RIFTY_E2E_HMR === '1'; test.skip(!enabled,'x'); test('t',()=>{});",
      },
      { milestone: 10, name: 'm10-dev-hmr.spec.ts', content: "test.skip('retired', ()=>{});" },
      { milestone: 0, name: 'm0-boot.spec.ts', content: "test('boots', ()=>{});" },
    ]);
    expect(result.active).toContain(0);
    expect(result.active).not.toContain(10);
    expect(result.gatedOnly).toContain(10);
  });
});
