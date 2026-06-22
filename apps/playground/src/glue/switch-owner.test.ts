import { describe, expect, it } from 'vitest';
import { requestSwitch } from './switch-owner.ts';

/** Minimal slice of WorkspaceOwnerHandle the orchestrator awaits. */
function fakeOwner(id: string, events: string[]) {
  let resolveClosed!: (n: number) => void;
  const closed = new Promise<number>((r) => {
    resolveClosed = r;
  });
  return {
    id,
    closed,
    close() {
      events.push(`close:${id}`);
      // Real worker exit is async; resolve on a microtask so a synchronous
      // re-spawn before exit would be observable as a two-owner window.
      queueMicrotask(() => resolveClosed(0));
    },
  };
}

describe('requestSwitch — strictly sequential owner teardown+respawn', () => {
  it('does not spawn the new owner until the old owner has exited (no two-owner window)', async () => {
    const events: string[] = [];
    const oldOwner = fakeOwner('A', events);
    let spawnedWhileOldAlive = false;
    let oldExited = false;
    oldOwner.closed.then(() => {
      oldExited = true;
    });

    await requestSwitch({
      currentOwner: oldOwner,
      nextRoot: '/projects/p2',
      nextSlug: 'p2',
      isDirty: () => false,
      confirmDiscard: async () => true,
      save: async () => {
        events.push('save');
      },
      discard: async () => {
        events.push('discard');
      },
      spawn: ({ root, slug }) => {
        if (!oldExited) spawnedWhileOldAlive = true;
        events.push(`spawn:${root}:${slug}`);
        return fakeOwner('B', events);
      },
      awaitReady: async () => {
        events.push('ready');
      },
      rewireBridges: () => {
        events.push('rewire');
      },
      restartDevServer: async () => {
        events.push('restart');
      },
      clearTerminal: () => {
        events.push('clear');
      },
    });

    expect(spawnedWhileOldAlive).toBe(false);
    // Exact lifecycle order — close BEFORE spawn, ready BEFORE rewire, rewire
    // BEFORE restart, restart BEFORE clear.
    expect(events).toEqual([
      'close:A',
      'spawn:/projects/p2:p2',
      'ready',
      'rewire',
      'restart',
      'clear',
    ]);
  });

  it('on a clean (non-dirty) scratch switch runs neither save nor discard', async () => {
    const events: string[] = [];
    const oldOwner = fakeOwner('A', events);
    await requestSwitch({
      currentOwner: oldOwner,
      nextRoot: '/projects/p2',
      nextSlug: 'p2',
      isDirty: () => false,
      confirmDiscard: async () => true,
      save: async () => {
        events.push('save');
      },
      discard: async () => {
        events.push('discard');
      },
      spawn: () => fakeOwner('B', events),
      awaitReady: async () => {},
      rewireBridges: () => {},
      restartDevServer: async () => {},
      clearTerminal: () => {},
    });
    expect(events).not.toContain('save');
    expect(events).not.toContain('discard');
  });

  it('a dirty scratch with a discard-confirm discards (does not save) and still respawns', async () => {
    const events: string[] = [];
    const oldOwner = fakeOwner('A', events);
    await requestSwitch({
      currentOwner: oldOwner,
      nextRoot: '/scratch',
      nextSlug: 'scratch',
      isDirty: () => true,
      confirmDiscard: async () => true,
      save: async () => {
        events.push('save');
      },
      discard: async () => {
        events.push('discard');
      },
      spawn: () => fakeOwner('B', events),
      awaitReady: async () => {},
      rewireBridges: () => {},
      restartDevServer: async () => {},
      clearTerminal: () => {},
    });
    expect(events).toContain('discard');
    expect(events).not.toContain('save');
    expect(events).toContain('close:A');
  });

  it('a dirty scratch the user does NOT confirm aborts before any teardown', async () => {
    const events: string[] = [];
    const oldOwner = fakeOwner('A', events);
    const switched = await requestSwitch({
      currentOwner: oldOwner,
      nextRoot: '/projects/p2',
      nextSlug: 'p2',
      isDirty: () => true,
      confirmDiscard: async () => false, // user cancels
      save: async () => {
        events.push('save');
      },
      discard: async () => {
        events.push('discard');
      },
      spawn: () => fakeOwner('B', events),
      awaitReady: async () => {},
      rewireBridges: () => {},
      restartDevServer: async () => {},
      clearTerminal: () => {},
    });
    expect(switched).toBe(false);
    expect(events).toEqual([]); // no close, no spawn — fully aborted
  });
});
