import { describe, expect, it } from 'vitest';
import { resolveDevServerChildConfig } from './dev-server-child-config.ts';

describe('resolveDevServerChildConfig', () => {
  it('resolves a node-server spec/cfg/port/root from the spawn env', () => {
    const r = resolveDevServerChildConfig({
      RIFTY_RFV_TEMPLATE: 'express-sqlite',
      RIFTY_RFV_ROOT: '/workspace',
      RIFTY_DEV_PORT: '3210',
    });
    expect(r.spec.id).toBe('express-sqlite');
    expect(r.spec.runtime).toBe('node-server');
    expect(r.cfg.root).toBe('/workspace');
    expect(r.cfg.runtime).toBe('node-server');
    expect(r.port).toBe(3210);
    expect(r.root).toBe('/workspace');
  });

  it('rejects Vite loudly because the installed .bin path owns it', () => {
    expect(() =>
      resolveDevServerChildConfig({
        RIFTY_RFV_TEMPLATE: 'vite',
        RIFTY_RFV_ROOT: '/workspace',
        RIFTY_DEV_PORT: '5174',
      }),
    ).toThrow(/expected a node-server template/);
  });

  it('throws loud when a required env var is missing (no silent default)', () => {
    expect(() => resolveDevServerChildConfig({ RIFTY_RFV_ROOT: '/workspace' })).toThrow(/RIFTY_/);
  });

  it('throws loud on a non-integer RIFTY_DEV_PORT (no silent NaN port)', () => {
    expect(() =>
      resolveDevServerChildConfig({
        RIFTY_RFV_TEMPLATE: 'express-sqlite',
        RIFTY_RFV_ROOT: '/workspace',
        RIFTY_DEV_PORT: 'not-a-port',
      }),
    ).toThrow(/RIFTY_DEV_PORT/);
  });
});
