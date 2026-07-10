import { describe, expect, it, vi } from 'vitest';
import { createScratchDirtyTracker } from './scratch-dirty-tracker.ts';

describe('scratch dirty tracker fault matrix', () => {
  it('delayed background user work protects scratch before its post-exit mutation', () => {
    const markScratchDirty = vi.fn();
    const tracker = createScratchDirtyTracker();
    tracker.bind(markScratchDirty);
    tracker.startRun({ sid: 'user-terminal', rid: 'background', origin: 'user' });

    tracker.settleRun({
      sid: 'user-terminal',
      rid: 'background',
      origin: 'user',
      mayOutlivePty: true,
    });
    expect(markScratchDirty).toHaveBeenCalledTimes(1);

    tracker.onWorkspaceMutation({ op: 'write', paths: ['/scratch/delayed.txt'] });
    expect(markScratchDirty).toHaveBeenCalledTimes(2);
  });

  it('concurrent-same-key: protects scratch when a boot write overlaps a user run', () => {
    const markScratchDirty = vi.fn();
    const tracker = createScratchDirtyTracker();
    tracker.bind(markScratchDirty);
    tracker.startRun({ sid: 'boot-terminal', rid: 'boot', origin: 'boot' });
    tracker.startRun({ sid: 'user-terminal', rid: 'pwd', origin: 'user' });

    // The shared VFS has no async-context identity. Conservatively attribute an
    // overlapping scratch mutation to the open user protection window: an extra
    // discard prompt is preferable to silently wiping bytes.
    tracker.onWorkspaceMutation({ op: 'write', paths: ['/scratch/package-lock.json'] });
    expect(markScratchDirty).toHaveBeenCalledTimes(1);

    tracker.settleRun({
      sid: 'user-terminal',
      rid: 'pwd',
      origin: 'user',
      mayOutlivePty: false,
    });
    tracker.onWorkspaceMutation({ op: 'write', paths: ['/scratch/node_modules/pkg/index.js'] });
    expect(markScratchDirty).toHaveBeenCalledTimes(2);
  });
});
