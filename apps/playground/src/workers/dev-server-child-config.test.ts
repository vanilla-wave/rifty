import { describe, expect, it } from 'vitest';
import { resolveDevServerChildConfig } from './dev-server-child-config.ts';

describe('resolveDevServerChildConfig', () => {
  it('resolves spec/cfg/port/root/slug/fromScratch/ownerToken from the spawn env', () => {
    const r = resolveDevServerChildConfig({
      RIFTY_RFV_TEMPLATE: 'vite',
      RIFTY_RFV_SLUG: 'vite',
      RIFTY_RFV_SETUP: 'from-scratch',
      RIFTY_RFV_ROOT: '/workspace',
      RIFTY_DEV_PORT: '5174',
      RIFTY_PREVIEW_OWNER_TOKEN: 'tok',
    });
    expect(r.spec.id).toBe('vite');
    expect(r.cfg.root).toBe('/workspace');
    expect(r.port).toBe(5174);
    expect(r.root).toBe('/workspace');
    expect(r.slug).toBe('vite');
    expect(r.fromScratch).toBe(true);
    expect(r.ownerToken).toBe('tok');
  });

  it('treats an empty owner token as undefined and non-from-scratch as instant', () => {
    const r = resolveDevServerChildConfig({
      RIFTY_RFV_TEMPLATE: 'vite',
      RIFTY_RFV_SLUG: 'vite',
      RIFTY_RFV_SETUP: 'instant',
      RIFTY_RFV_ROOT: '/workspace',
      RIFTY_DEV_PORT: '5174',
      RIFTY_PREVIEW_OWNER_TOKEN: '',
    });
    expect(r.fromScratch).toBe(false);
    expect(r.ownerToken).toBeUndefined();
  });

  it('throws loud when a required env var is missing (no silent default)', () => {
    expect(() => resolveDevServerChildConfig({ RIFTY_RFV_ROOT: '/workspace' })).toThrow(/RIFTY_/);
  });
});
