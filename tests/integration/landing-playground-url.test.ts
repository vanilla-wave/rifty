import { describe, expect, it } from 'vitest';
import { buildPlaygroundHref, buildPresetHref } from '../../apps/landing/src/playground-url';

describe('landing playground URL config', () => {
  it('builds the direct playground exit from explicit self-hosted config', () => {
    expect(buildPlaygroundHref('/play/')).toBe('/play/');
    expect(buildPlaygroundHref('https://play.example.test/runtime/')).toBe(
      'https://play.example.test/runtime/',
    );
  });

  it('requires a playground mount instead of inventing a local fallback', () => {
    expect(() => buildPlaygroundHref(undefined)).toThrow('VITE_RIFTY_PLAYGROUND_URL');
    expect(() => buildPresetHref('real-vite', undefined)).toThrow('VITE_RIFTY_PLAYGROUND_URL');
  });

  it('uses an explicitly configured absolute playground origin', () => {
    expect(buildPresetHref('cli-report', 'https://play.example.test/runtime/')).toBe(
      'https://play.example.test/runtime/?preset=cli-report&autorun=1',
    );
  });

  it('rejects ambiguous relative config instead of linking somewhere accidental', () => {
    expect(() => buildPlaygroundHref('playground')).toThrow('VITE_RIFTY_PLAYGROUND_URL');
    expect(() => buildPresetHref('real-vite', 'playground')).toThrow('VITE_RIFTY_PLAYGROUND_URL');
  });
});
