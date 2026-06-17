import { describe, expect, it } from 'vitest';
import {
  type DevServerChildSpawnParams,
  buildDevServerChildSpawnSpec,
} from './owner-child-dev-server.ts';

const params: DevServerChildSpawnParams = {
  templateId: 'm7-preview-sw',
  slug: 'm7-preview-sw',
  setup: 'instant',
  root: '/workspace',
  devPort: 5174,
  ownerToken: 'tok-123',
};

describe('buildDevServerChildSpawnSpec', () => {
  it('builds a serve:true remote-fs dev-server child spawn spec', () => {
    const spec = buildDevServerChildSpawnSpec(params, 'blob:dev-server-url');
    expect(spec.entry).toEqual({ kind: 'url', url: 'blob:dev-server-url' });
    expect(spec.argv).toEqual(['rifty', 'dev-server']);
    expect(spec.cwd).toBe('/workspace');
    expect(spec.serve).toBe(true); // long-lived server (vs P6a run-to-completion)
    expect(spec.env.RIFTY_REMOTE_FS).toBe('1');
    expect(spec.env.RIFTY_DEV_SERVER).toBe('1');
    expect(spec.env.RIFTY_RFV_TEMPLATE).toBe('m7-preview-sw');
    expect(spec.env.RIFTY_RFV_SLUG).toBe('m7-preview-sw');
    expect(spec.env.RIFTY_RFV_SETUP).toBe('instant');
    expect(spec.env.RIFTY_RFV_ROOT).toBe('/workspace');
    expect(spec.env.RIFTY_DEV_PORT).toBe('5174');
    expect(spec.env.RIFTY_PREVIEW_OWNER_TOKEN).toBe('tok-123');
  });

  it('maps an undefined ownerToken to an empty string', () => {
    const spec = buildDevServerChildSpawnSpec({ ...params, ownerToken: undefined }, 'blob:x');
    expect(spec.env.RIFTY_PREVIEW_OWNER_TOKEN).toBe('');
  });
});
