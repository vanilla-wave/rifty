import { describe, expect, it } from 'vitest';
import type { BootResult } from '../boot.ts';
import {
  degradedBannerVisible,
  saveAffordance,
  statusStorageChip,
  storageModeFromBoot,
  workspaceSaveMessage,
} from './degraded-storage.ts';

function boot(over: Partial<BootResult> & { backend: 'opfs' | 'memory' }): BootResult {
  const { backend, ...rest } = over;
  return {
    vfsBoot: { backend },
    storage: { available: true, persistedBefore: true, persistedAfter: true },
    ...rest,
  } as BootResult;
}

describe('storageModeFromBoot — wired to real BootResult, not a manual toggle', () => {
  it('opfs backend with persisted storage → opfs', () => {
    expect(storageModeFromBoot(boot({ backend: 'opfs' }))).toBe('opfs');
  });
  it('memory backend → memory (degraded)', () => {
    expect(storageModeFromBoot(boot({ backend: 'memory' }))).toBe('memory');
  });
  it('opfs backend but best-effort (persistedAfter false) is NOT degraded — stays opfs', () => {
    const b = boot({ backend: 'opfs' });
    (b.storage as { persistedAfter: boolean }).persistedAfter = false;
    expect(storageModeFromBoot(b)).toBe('opfs');
  });
  it('memory backend with storage probe unavailable → memory', () => {
    const b = boot({ backend: 'memory' });
    (b as { storage: unknown }).storage = { available: false };
    expect(storageModeFromBoot(b)).toBe('memory');
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

describe('workspaceSaveMessage — truthful Cmd/Ctrl+S acknowledgement', () => {
  it('names memory-backed saves as session-only and ephemeral', () => {
    expect(workspaceSaveMessage('memory')).toBe('Saved for this session · EPHEMERAL');
  });

  it('uses the durable Saved acknowledgement only for OPFS', () => {
    expect(workspaceSaveMessage('opfs')).toBe('Saved');
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
