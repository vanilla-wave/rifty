import { describe, expect, it } from 'vitest';
import { resolveDevServerChildConfig } from './dev-server-child-config.ts';

describe('resolveDevServerChildConfig', () => {
  it('resolves spec/cfg/port/root/slug/fromScratch from the spawn env', () => {
    const r = resolveDevServerChildConfig({
      RIFTY_RFV_TEMPLATE: 'vite',
      RIFTY_RFV_SLUG: 'vite',
      RIFTY_RFV_SETUP: 'from-scratch',
      RIFTY_RFV_ROOT: '/workspace',
      RIFTY_DEV_PORT: '5174',
    });
    expect(r.spec.id).toBe('vite');
    expect(r.cfg.root).toBe('/workspace');
    expect(r.port).toBe(5174);
    expect(r.root).toBe('/workspace');
    expect(r.slug).toBe('vite');
    expect(r.fromScratch).toBe(true);
  });

  it('treats a non-from-scratch setup as instant', () => {
    const r = resolveDevServerChildConfig({
      RIFTY_RFV_TEMPLATE: 'vite',
      RIFTY_RFV_SLUG: 'vite',
      RIFTY_RFV_SETUP: 'instant',
      RIFTY_RFV_ROOT: '/workspace',
      RIFTY_DEV_PORT: '5174',
    });
    expect(r.fromScratch).toBe(false);
  });

  it('throws loud when a required env var is missing (no silent default)', () => {
    expect(() => resolveDevServerChildConfig({ RIFTY_RFV_ROOT: '/workspace' })).toThrow(/RIFTY_/);
  });

  it('throws loud on a non-integer RIFTY_DEV_PORT (no silent NaN port)', () => {
    expect(() =>
      resolveDevServerChildConfig({
        RIFTY_RFV_TEMPLATE: 'vite',
        RIFTY_RFV_SLUG: 'vite',
        RIFTY_RFV_SETUP: 'instant',
        RIFTY_RFV_ROOT: '/workspace',
        RIFTY_DEV_PORT: 'not-a-port',
      }),
    ).toThrow(/RIFTY_DEV_PORT/);
  });
});
