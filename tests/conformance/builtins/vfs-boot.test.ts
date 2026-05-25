/**
 * Conformance for the VFS bootstrap detector (ADR-0013).
 *
 * In the Node test env there's no `crossOriginIsolated` and no OPFS
 * support, so `detectVfsBackend()` must return `'memory'` and
 * `initBackend()` must wire the in-memory pair as both surfaces.
 */
import { asyncVfs, detectVfsBackend, initBackend, syncMirror } from '@rifty/vfs';
import { resetSyncMirror } from '@rifty/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('vfs/boot — backend detection (ADR-0013)', () => {
  beforeEach(() => {
    resetSyncMirror();
  });

  afterEach(() => {
    resetSyncMirror();
  });

  it('detectVfsBackend() returns "memory" in the Node test env', () => {
    expect(detectVfsBackend()).toBe('memory');
  });

  it('initBackend() resolves to "memory" and wires syncMirror+asyncVfs', async () => {
    const choice = await initBackend();
    expect(choice).toBe('memory');

    // After bootstrap both surfaces must be live and pointing at the
    // same backing tree.
    syncMirror().mkdirSync('/boot', { recursive: true });
    syncMirror().writeFileSync('/boot/marker', new TextEncoder().encode('ok'));

    const a = asyncVfs();
    expect(a).not.toBeNull();
    expect(await a!.readFileText('/boot/marker')).toBe('ok');
  });
});
