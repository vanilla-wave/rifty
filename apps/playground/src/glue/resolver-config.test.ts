import { describe, expect, it, vi } from 'vitest';
import { getEddyPin } from './resolver-config.ts';

describe('getEddyPin (VITE_RIFTY_EDDY_PINS, ADR-0186 §5)', () => {
  it('returns the pin for a mapped preset slug, undefined otherwise', () => {
    const raw = JSON.stringify({ 'real-vite': 'sha256-abc', 'hono-api': 'sha256-def' });
    expect(getEddyPin('real-vite', raw)).toBe('sha256-abc');
    expect(getEddyPin('koa-api', raw)).toBeUndefined();
  });

  it('is inert when the env var is absent/empty', () => {
    expect(getEddyPin('real-vite', undefined)).toBeUndefined();
    expect(getEddyPin('real-vite', '')).toBeUndefined();
  });

  it('warns (once) and ignores pins on malformed JSON — a bad deploy env must not break installs', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(getEddyPin('real-vite', '{not json')).toBeUndefined();
      expect(getEddyPin('real-vite', '{not json')).toBeUndefined();
      expect(warnSpy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('ignores non-string / non-object shapes', () => {
    expect(getEddyPin('real-vite', JSON.stringify(['sha256-abc']))).toBeUndefined();
    expect(getEddyPin('real-vite', JSON.stringify({ 'real-vite': 42 }))).toBeUndefined();
  });
});
