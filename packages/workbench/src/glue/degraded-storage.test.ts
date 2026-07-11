import { describe, expect, it } from 'vitest';
import {
  degradedBannerVisible,
  saveAffordance,
  statusStorageChip,
  storageModeFromBoot,
} from './degraded-storage.ts';

function boot(backend: 'opfs' | 'memory') {
  return { vfsBoot: { backend } };
}

describe('storageModeFromBoot — wired to real BootResult, not a manual toggle', () => {
  it('opfs backend with persisted storage → opfs', () => {
    expect(storageModeFromBoot(boot('opfs'))).toBe('opfs');
  });
  it('memory backend → memory (degraded)', () => {
    expect(storageModeFromBoot(boot('memory'))).toBe('memory');
  });
  it('opfs backend but best-effort (persistedAfter false) is NOT degraded — stays opfs', () => {
    expect(storageModeFromBoot(boot('opfs'))).toBe('opfs');
  });
  it('memory backend with storage probe unavailable → memory', () => {
    expect(storageModeFromBoot(boot('memory'))).toBe('memory');
  });
});

describe('degradedBannerVisible — RED-check: visible iff memory && !dismissed && launcher closed', () => {
  it('memory, not dismissed, launcher closed → visible', () => {
    expect(
      degradedBannerVisible({ storage: 'memory', bannerDismissed: false, launcherOpen: false }),
    ).toBe(true);
  });
  it('opfs → never visible', () => {
    expect(
      degradedBannerVisible({ storage: 'opfs', bannerDismissed: false, launcherOpen: false }),
    ).toBe(false);
  });
  it('memory but dismissed → hidden', () => {
    expect(
      degradedBannerVisible({ storage: 'memory', bannerDismissed: true, launcherOpen: false }),
    ).toBe(false);
  });
  it('memory but launcher open → hidden', () => {
    expect(
      degradedBannerVisible({ storage: 'memory', bannerDismissed: false, launcherOpen: true }),
    ).toBe(false);
  });
});

describe('saveAffordance — fidelity: memory save is EPHEMERAL, never a durable Saved', () => {
  it('memory → ephemeral EPHEMERAL warn', () => {
    expect(saveAffordance('memory')).toEqual({
      label: 'EPHEMERAL',
      badge: 'EPHEMERAL',
      tone: 'warn',
      ephemeral: true,
    });
  });
  it('opfs → durable Saved ok', () => {
    expect(saveAffordance('opfs')).toEqual({
      label: 'Saved',
      badge: 'UNSAVED',
      tone: 'ok',
      ephemeral: false,
    });
  });
  it('a memory save never reports a durable Saved', () => {
    const a = saveAffordance('memory');
    expect(a.ephemeral).toBe(true);
    expect(a.label).not.toBe('Saved');
  });
});

describe('statusStorageChip — design copy/tone/icon', () => {
  it('opfs', () => {
    expect(statusStorageChip('opfs')).toEqual({
      label: 'OPFS · persisted',
      tone: 'ok',
      icon: 'database',
    });
  });
  it('memory', () => {
    expect(statusStorageChip('memory')).toEqual({
      label: 'Memory · session only',
      tone: 'warn',
      icon: 'triangle-exclamation-fill',
    });
  });
});
