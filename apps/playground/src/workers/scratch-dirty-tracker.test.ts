import { describe, expect, it, vi } from 'vitest';
import { createScratchDirtyTracker } from './scratch-dirty-tracker.ts';

describe('scratch dirty tracker', () => {
  it('marks only a user-run mutation under /scratch', () => {
    const markScratchDirty = vi.fn();
    const tracker = createScratchDirtyTracker();
    tracker.bind(markScratchDirty);

    tracker.startRun({ sid: 'terminal-1', rid: 'boot', origin: 'boot' });
    tracker.onWorkspaceMutation({ op: 'write', paths: ['/scratch/package-lock.json'] });
    tracker.settleRun({
      sid: 'terminal-1',
      rid: 'boot',
      origin: 'boot',
      mayOutlivePty: true,
    });
    expect(markScratchDirty).not.toHaveBeenCalled();

    tracker.startRun({ sid: 'terminal-1', rid: 'read', origin: 'user' });
    tracker.settleRun({
      sid: 'terminal-1',
      rid: 'read',
      origin: 'user',
      mayOutlivePty: false,
    });
    expect(markScratchDirty).not.toHaveBeenCalled();

    tracker.startRun({ sid: 'terminal-1', rid: 'write', origin: 'user' });
    tracker.onWorkspaceMutation({ op: 'write', paths: ['/scratch/note.txt'] });
    tracker.settleRun({
      sid: 'terminal-1',
      rid: 'write',
      origin: 'user',
      mayOutlivePty: false,
    });
    expect(markScratchDirty).toHaveBeenCalledTimes(1);
  });

  it('ignores profile metadata, named projects, and mutations after the user run settled', () => {
    const markScratchDirty = vi.fn();
    const tracker = createScratchDirtyTracker();
    tracker.bind(markScratchDirty);
    tracker.startRun({ sid: 'terminal-2', rid: 'r1', origin: 'user' });

    tracker.onWorkspaceMutation({ op: 'write', paths: ['/.rifty/projects.json'] });
    tracker.onWorkspaceMutation({ op: 'write', paths: ['/projects/p-1/main.js'] });
    tracker.settleRun({
      sid: 'terminal-2',
      rid: 'r1',
      origin: 'user',
      mayOutlivePty: false,
    });
    tracker.onWorkspaceMutation({ op: 'write', paths: ['/scratch/late.txt'] });

    expect(markScratchDirty).not.toHaveBeenCalled();
  });
});
