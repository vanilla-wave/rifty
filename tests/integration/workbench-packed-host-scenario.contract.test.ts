import { describe, expect, it } from 'vitest';
import {
  produceFromInstalledWorkbenchTarball,
  provePackedHostOrphanRetain,
} from './workbench-packed-host-scenario.mjs';

describe('packed host scenario composition (I7 + I1 residual)', () => {
  it('produces a dep snapshot from the installed workbench tarball', async () => {
    const baked = await produceFromInstalledWorkbenchTarball();
    expect(baked.snapshotId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(baked.tarBytes.byteLength).toBeGreaterThan(0);
    expect(baked.entry).toBe('@riftydev/workbench/dep-snapshot');
  });

  it('downloads planted orphan Scratch after packed-host reopen', async () => {
    const proof = await provePackedHostOrphanRetain();
    expect(proof.downloaded).toBe('orphan bytes');
    expect(proof.host).toMatchObject({
      scope: '/sandbox/',
      previewPrefix: '/sandbox/preview',
      snapshotOnly: true,
    });
  });
});
