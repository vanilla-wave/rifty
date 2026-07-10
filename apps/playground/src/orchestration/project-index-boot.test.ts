/**
 * Behavioral contract of the extracted project-index mirror + boot decision
 * core (ADR-0197 slice 2) — replaces the App.test.ts source-greps for the
 * project-index hydration and first-run launcher groups. Drives the module
 * through its injected ports (ADR-0197 §4).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ProjectIndex } from '../glue/project-index.ts';
import {
  type IndexMirrorPort,
  type ProjectIndexBoot,
  createProjectIndexBoot,
} from './project-index-boot.ts';

const NEEDS_CHOICE: ProjectIndex = { activeId: 'scratch', scratch: null, projects: [] };
const SCRATCH_DRAFT: ProjectIndex = {
  activeId: 'scratch',
  scratch: { starter: 'react', dirty: true, editedAt: 'x' },
  projects: [],
};
const HIDDEN_EMPTY: ProjectIndex = {
  activeId: 'scratch',
  scratch: { starter: 'hidden-empty', dirty: false, editedAt: 'no edits yet' },
  projects: [],
};
function projIdx(...ids: string[]): ProjectIndex {
  return {
    activeId: ids[0] ?? 'scratch',
    scratch: null,
    projects: ids.map((id) => ({ id, name: id, starter: 'react', editedAt: 'x' })),
  };
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(cond: () => boolean, limitMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > limitMs) throw new Error('until() timed out');
    await tick(10);
  }
}

class FakeMirror implements IndexMirrorPort {
  cbs = new Set<(idx: ProjectIndex) => void>();
  requests = 0;
  disposed = false;
  buffered: ProjectIndex | null = null;
  subscribe(cb: (idx: ProjectIndex) => void): () => void {
    this.cbs.add(cb);
    if (this.buffered) cb(this.buffered); // replay a buffered frame synchronously
    return () => this.cbs.delete(cb);
  }
  request(): void {
    this.requests += 1;
  }
  dispose(): void {
    this.disposed = true;
  }
  publish(idx: ProjectIndex): void {
    this.buffered = idx;
    for (const cb of [...this.cbs]) cb(idx);
  }
}

class Harness {
  hydrated: ProjectIndex[] = [];
  hints: ProjectIndex[] = [];
  presenceHint = true;
  deletesPosted: string[] = [];
  openedStarters = 0;
  closedLauncher = 0;
  resetEditor = 0;
  warmedEditor = 0;
  restored: ProjectIndex[] = [];
  deepPicks: string[] = [];
  hiddenActivations = 0;
  activateHiddenImpl: () => Promise<ProjectIndex> = async () => HIDDEN_EMPTY;
  fallbackMs = 30;

  boot(): ProjectIndexBoot {
    return createProjectIndexBoot({
      hydrateIndex: (idx) => this.hydrated.push(idx),
      recordPresenceHint: (idx) => this.hints.push(idx),
      hasPresenceHint: () => this.presenceHint,
      postDeleteProjectTree: async (id) => {
        this.deletesPosted.push(id);
      },
      activateHiddenEmptyScratch: () => {
        this.hiddenActivations += 1;
        return this.activateHiddenImpl();
      },
      openLauncherOnStarters: () => {
        this.openedStarters += 1;
      },
      closeLauncher: () => {
        this.closedLauncher += 1;
      },
      resetEditorInitialFiles: () => {
        this.resetEditor += 1;
      },
      warmEditorStack: () => {
        this.warmedEditor += 1;
      },
      restore: (idx) => this.restored.push(idx),
      pickDeepLinkStarter: (id) => this.deepPicks.push(id),
      firstRunFallbackMs: this.fallbackMs,
    });
  }
}

function setup(): { h: Harness; boot: ProjectIndexBoot; mirror: FakeMirror } {
  const h = new Harness();
  const boot = h.boot();
  const mirror = new FakeMirror();
  boot.attachOwner(mirror);
  return { h, boot, mirror };
}

describe('index mirror handshake (ADR-0165 §3 pull-not-spray)', () => {
  it('requests on attach and retries until the owner bridge answers, then stops', async () => {
    const { boot, mirror } = setup();
    expect(mirror.requests).toBe(1); // handshake request on subscribe
    await until(() => mirror.requests >= 3); // 250ms retry beat until a reply
    mirror.publish(projIdx('p1'));
    const after = mirror.requests;
    await tick(600);
    expect(mirror.requests).toBe(after); // first reply stops the retry
    boot.dispose();
  });

  it('re-attach disposes the previous bridge and unhooks its subscription', async () => {
    const { h, boot, mirror } = setup();
    const second = new FakeMirror();
    boot.attachOwner(second);
    expect(mirror.disposed).toBe(true);
    mirror.publish(projIdx('p1')); // dead bridge → no hydrate
    expect(h.hydrated).toEqual([]);
    second.publish(projIdx('p2'));
    expect(h.hydrated).toHaveLength(1);
    boot.dispose();
    expect(second.disposed).toBe(true);
  });
});

describe('owner publish → hydrate flow', () => {
  it('folds each publish into the store mirror and keeps the presence hint current', () => {
    const { h, mirror } = setup();
    const idx = projIdx('p1');
    mirror.publish(idx);
    expect(h.hydrated).toEqual([idx]);
    expect(h.hints).toEqual([idx]);
  });

  it('flips editor readiness on a real index and reopens initial tabs once (false→true edge)', () => {
    const { h, boot, mirror } = setup();
    expect(boot.editorProjectContextReady()).toBe(false);
    mirror.publish(projIdx('p1'));
    expect(boot.editorProjectContextReady()).toBe(true);
    expect(h.resetEditor).toBe(1);
    mirror.publish(projIdx('p1'));
    expect(h.resetEditor).toBe(1); // already ready → no re-open
  });

  it('a lagging needs-choice publish never re-hides an editor already shown', () => {
    const { h, boot, mirror } = setup();
    mirror.publish(projIdx('p1')); // boot decision made, editor shown
    mirror.publish(NEEDS_CHOICE); // stale/in-flight owner mirror
    expect(boot.editorProjectContextReady()).toBe(true);
    expect(h.openedStarters).toBe(0); // and no chooser flash either
  });
});

describe('one-shot boot decision (project-first, ADR-0165)', () => {
  it('needs-choice publish opens the first-run chooser and the decision sticks (no late restore)', () => {
    const { h, mirror } = setup();
    mirror.publish(NEEDS_CHOICE);
    expect(h.openedStarters).toBe(1);
    expect(h.restored).toEqual([]);
    mirror.publish(projIdx('p1'));
    // The chooser IS the decision: a later index never yanks it away mid-choice.
    expect(h.closedLauncher).toBe(0);
    expect(h.restored).toEqual([]);
  });

  it('decides once: later publishes neither re-open the chooser nor re-restore', () => {
    const { h, mirror } = setup();
    mirror.publish(projIdx('p1'));
    mirror.publish(projIdx('p1'));
    expect(h.restored).toHaveLength(1);
    expect(h.openedStarters).toBe(0);
    expect(h.hydrated).toHaveLength(2); // hydration still folds every publish
  });

  it('a dirty scratch draft restores too (no chooser)', () => {
    const { h, mirror } = setup();
    mirror.publish(SCRATCH_DRAFT);
    expect(h.openedStarters).toBe(0);
    expect(h.restored).toEqual([SCRATCH_DRAFT]);
  });

  it('closing the first-run launcher activates + restores an honest hidden-empty scratch', async () => {
    const { h, boot, mirror } = setup();
    mirror.publish(NEEDS_CHOICE);
    boot.closeLauncher();
    await tick();
    expect(h.closedLauncher).toBe(1);
    expect(h.hiddenActivations).toBe(1);
    expect(h.restored).toEqual([HIDDEN_EMPTY]);
    expect(boot.editorProjectContextReady()).toBe(true);
    expect(h.resetEditor).toBe(1);
  });

  it('close before the first index defers activation so a persisted project wins', async () => {
    const { h, boot, mirror } = setup();
    h.presenceHint = false;
    boot.startBootPolicy(undefined);

    boot.closeLauncher();
    expect(h.closedLauncher).toBe(1);
    expect(h.hiddenActivations).toBe(0);

    const persisted = projIdx('p1');
    mirror.publish(persisted);
    await tick();

    expect(h.hiddenActivations).toBe(0);
    expect(h.restored).toEqual([persisted]);
  });

  it('close before a needs-choice publish activates only after that authoritative publish', async () => {
    const { h, boot, mirror } = setup();
    h.presenceHint = false;
    boot.startBootPolicy(undefined);
    boot.closeLauncher();

    mirror.publish(NEEDS_CHOICE);
    await tick();

    expect(h.openedStarters).toBe(1); // initial instant open only; close stays closed
    expect(h.hiddenActivations).toBe(1);
    expect(h.restored).toEqual([HIDDEN_EMPTY]);
  });

  it('closing an ordinary launcher over a ready project never activates hidden scratch', () => {
    const { h, boot, mirror } = setup();
    mirror.publish(projIdx('p1'));

    boot.closeLauncher();

    expect(h.closedLauncher).toBe(1);
    expect(h.hiddenActivations).toBe(0);
  });
});

describe('boot policy (deep link / presence hint / degraded fallback)', () => {
  it('a preset deep-link pre-empts the chooser synchronously and auto-picks', () => {
    const { h, boot, mirror } = setup();
    boot.startBootPolicy('react-ts');
    expect(h.deepPicks).toEqual(['react-ts']);
    mirror.publish(NEEDS_CHOICE); // fast owner publish during the pick
    expect(h.openedStarters).toBe(0); // no first-run launcher flash
    expect(h.restored).toEqual([]);
  });

  it('a TRUE first run (no presence hint) opens the chooser instantly', () => {
    const { h, boot, mirror } = setup();
    h.presenceHint = false;
    boot.startBootPolicy(undefined);
    expect(h.openedStarters).toBe(1); // NOW — not after the first owner publish
    // The publish still arbitrates: a stale hint (project exists) closes + restores.
    mirror.publish(projIdx('p1'));
    expect(h.closedLauncher).toBe(1);
    expect(h.restored).toHaveLength(1);
  });

  it('returning user: the fallback beat opens the gallery ONLY when no index arrived at all', async () => {
    const first = setup();
    first.boot.startBootPolicy(undefined);
    expect(first.h.openedStarters).toBe(0); // index-driven, no blind open
    await until(() => first.h.openedStarters === 1); // degraded: no index within the beat
    const second = setup();
    second.boot.startBootPolicy(undefined);
    second.mirror.publish(projIdx('p1')); // publish beats the timer
    await tick(second.h.fallbackMs + 30);
    expect(second.h.openedStarters).toBe(0);
  });

  it('warms the editor stack for returning/project-ready boots, never first-run chooser idle', () => {
    const firstRun = setup();
    firstRun.h.presenceHint = false;
    firstRun.boot.startBootPolicy(undefined);
    expect(firstRun.h.warmedEditor).toBe(0);

    const returning = setup();
    returning.boot.startBootPolicy(undefined);
    expect(returning.h.warmedEditor).toBe(1);

    const staleNoHint = setup();
    staleNoHint.h.presenceHint = false;
    staleNoHint.boot.startBootPolicy(undefined);
    staleNoHint.mirror.publish(projIdx('p1'));
    expect(staleNoHint.h.warmedEditor).toBe(1);
  });

  it('the returned cancel clears the fallback timer', async () => {
    const { h, boot } = setup();
    const cancel = boot.startBootPolicy(undefined);
    cancel();
    await tick(h.fallbackMs + 30);
    expect(h.openedStarters).toBe(0);
  });
});

describe('eventually-consistent on-disk delete (ADR-0165 §56)', () => {
  it('posts the delete now, re-fires it on every owner re-attach until a publish confirms it gone', () => {
    const { h, boot } = setup();
    boot.recordOnDiskDelete('p1');
    expect(h.deletesPosted).toEqual(['p1']);
    const respawned = new FakeMirror();
    boot.attachOwner(respawned); // owner respawn (switch) — the post may have been dropped
    expect(h.deletesPosted).toEqual(['p1', 'p1']);
    respawned.publish(projIdx('p2')); // p1 no longer listed → confirmed
    boot.attachOwner(new FakeMirror());
    expect(h.deletesPosted).toEqual(['p1', 'p1']); // no re-fire after confirmation
  });

  it('a publish still listing the id keeps it pending', () => {
    const { h, boot, mirror } = setup();
    boot.recordOnDiskDelete('p1');
    mirror.publish(projIdx('p2', 'p1')); // still listed → not confirmed
    boot.attachOwner(new FakeMirror());
    expect(h.deletesPosted).toEqual(['p1', 'p1']);
  });

  it('a failed delete post logs, never throws into the caller', async () => {
    const boot = createProjectIndexBoot({
      hydrateIndex: () => {},
      recordPresenceHint: () => {},
      hasPresenceHint: () => true,
      postDeleteProjectTree: () => Promise.reject(new Error('owner gone')),
      activateHiddenEmptyScratch: async () => HIDDEN_EMPTY,
      openLauncherOnStarters: () => {},
      closeLauncher: () => {},
      resetEditorInitialFiles: () => {},
      warmEditorStack: () => {},
      restore: () => {},
      pickDeepLinkStarter: () => {},
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => boot.recordOnDiskDelete('p1')).not.toThrow();
    await tick(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
