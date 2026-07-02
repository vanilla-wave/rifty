/**
 * Behavioral contract of the extracted workspace-owner lifecycle core
 * (ADR-0197 slice 2) — replaces the App.test.ts source-greps for the owner
 * start gate, project switch, and reload-restore groups. Drives the module
 * through its injected ports; these ARE its public contract (the real fabric is
 * covered by e2e + the browser-unit lane).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ProjectIndex } from '../glue/project-index.ts';
import {
  type WorkspaceLifecycle,
  type WorkspaceLifecycleDeps,
  createWorkspaceLifecycle,
} from './workspace-lifecycle.ts';

class FakeOwner {
  alive = true;
  readonly ready = Promise.resolve();
  private resolveClosed!: (v: unknown) => void;
  readonly closed = new Promise((resolve) => {
    this.resolveClosed = resolve;
  });
  constructor(
    readonly root: string,
    private readonly log?: string[],
  ) {}
  close(): void {
    this.alive = false;
    this.log?.push(`close:${this.root}`);
    this.resolveClosed(0);
  }
  isAlive(): boolean {
    return this.alive;
  }
}

function projIdx(activeId: string): ProjectIndex {
  return {
    activeId,
    scratch: activeId === 'scratch' ? { starter: 'react', dirty: true, editedAt: 'x' } : null,
    projects:
      activeId === 'scratch'
        ? []
        : [{ id: activeId, name: 'proj', starter: 'react', editedAt: 'x' }],
  };
}

class Harness {
  log: string[] = [];
  owner = new FakeOwner('/scratch', this.log);
  spawned: FakeOwner[] = [];
  ephemeral = false;
  persistedIds: string[] = [];
  devRunning = false;
  devSessionId: string | null = null;
  restarted: string[] = [];
  cleared: string[] = [];
  errors: string[] = [];
  relaunches = 0;
  awaitOwnerReadyImpl: (owner: FakeOwner) => Promise<void> = async () => {};

  deps(): WorkspaceLifecycleDeps<FakeOwner> & { initiallyStarted: boolean } {
    return {
      initiallyStarted: true,
      currentOwner: () => this.owner,
      setOwner: (next) => {
        this.owner = next;
        this.log.push(`setOwner:${next.root}`);
      },
      createActiveOwner: () => {
        const next = new FakeOwner('/scratch', this.log);
        this.spawned.push(next);
        this.log.push('createActiveOwner');
        return next;
      },
      spawnOwner: ({ root, slug }) => {
        const next = new FakeOwner(root, this.log);
        this.spawned.push(next);
        this.log.push(`spawn:${root}:${slug}`);
        return next;
      },
      rebindTerminal: async (owner) => {
        this.log.push(`rebind:${owner.root}`);
      },
      awaitOwnerReady: (owner) => {
        this.log.push(`awaitReady:${owner.root}`);
        return this.awaitOwnerReadyImpl(owner);
      },
      awaitActiveSnapshotFrame: async () => {
        this.log.push('awaitSnapshot');
      },
      flushEditorWrites: async () => {
        this.log.push('flush');
      },
      ephemeralStorage: this.ephemeral,
      persistActiveId: async (id) => {
        this.persistedIds.push(id);
        this.log.push(`persist:${id}`);
      },
      transition: {
        begin: () => this.log.push('transition:begin'),
        end: () => this.log.push('transition:end'),
      },
      devServer: {
        lifecycleRunning: () => this.devRunning,
        sessionId: () => this.devSessionId,
        markStopped: () => this.log.push('devMarkStopped'),
        restart: async (sessionId) => {
          this.restarted.push(sessionId);
          this.log.push(`devRestart:${sessionId}`);
        },
      },
      clearTerminal: (sessionId) => this.cleared.push(sessionId),
      resetEditorInitialFiles: () => this.log.push('resetEditor'),
      confirmDiscard: async () => true,
      showSwitchError: (message) => this.errors.push(message),
      relaunchDevServer: () => {
        this.relaunches += 1;
        this.log.push('relaunch');
      },
    };
  }
}

function setup(prep?: (deps: ReturnType<Harness['deps']>) => void): {
  h: Harness;
  ws: WorkspaceLifecycle<FakeOwner>;
} {
  const h = new Harness();
  const deps = h.deps();
  prep?.(deps);
  return { h, ws: createWorkspaceLifecycle(deps) };
}

describe('workspace owner start gate (ensureStarted)', () => {
  it('already started: awaits ready + marks ready without a respawn', async () => {
    const { h, ws } = setup();
    const owner = await ws.ensureStarted();
    expect(owner).toBe(h.owner);
    expect(h.spawned).toEqual([]);
    expect(ws.ownerReady()).toBe(true);
    expect(ws.started()).toBe(true);
  });

  it('not started: closes the hidden owner, spawns the ACTIVE owner only after its exit, rebinds the terminal', async () => {
    const { h, ws } = setup((deps) => {
      deps.initiallyStarted = false;
    });
    expect(ws.started()).toBe(false);
    const next = await ws.ensureStarted();
    expect(h.spawned).toEqual([next]);
    expect(h.owner).toBe(next);
    // close (and its exit) strictly precedes the respawn — no two-owner window.
    expect(h.log.indexOf('close:/scratch')).toBeLessThan(h.log.indexOf('createActiveOwner'));
    expect(h.log.indexOf('createActiveOwner')).toBeLessThan(h.log.indexOf('setOwner:/scratch'));
    expect(h.log.indexOf('setOwner:/scratch')).toBeLessThan(h.log.indexOf('rebind:/scratch'));
    expect(ws.started()).toBe(true);
    expect(ws.ownerReady()).toBe(true);
  });

  it('markReady=false starts the owner without flipping readiness (pick paints first)', async () => {
    const { ws } = setup((deps) => {
      deps.initiallyStarted = false;
    });
    await ws.ensureStarted(false);
    expect(ws.started()).toBe(true);
    expect(ws.ownerReady()).toBe(false);
  });

  it('concurrent calls coalesce on one in-flight start', async () => {
    const { h, ws } = setup((deps) => {
      deps.initiallyStarted = false;
    });
    const [a, b] = await Promise.all([ws.ensureStarted(), ws.ensureStarted()]);
    expect(a).toBe(b);
    expect(h.spawned).toHaveLength(1);
  });
});

describe('project switch (ADR-0165 §3 sequential teardown → respawn)', () => {
  it('flushes editor writes, persists activeId to the STILL-ALIVE owner, then tears down and respawns at the new root', async () => {
    const { h, ws } = setup();
    const switched = await ws.switchTo('p1');
    expect(switched).toBe(true);
    const order = [
      'transition:begin',
      'flush',
      'persist:p1',
      'close:/scratch',
      'spawn:/projects/p1:p1',
      'awaitReady:/projects/p1',
      'setOwner:/projects/p1',
      'devMarkStopped',
      'rebind:/projects/p1',
      'awaitSnapshot',
      'resetEditor',
      'transition:end',
    ];
    expect(h.log).toEqual(order);
    expect(h.owner.root).toBe('/projects/p1');
    expect(ws.started()).toBe(true);
    expect(ws.ownerReady()).toBe(true);
    // No lifecycle dev session was running → nothing restarted or cleared.
    expect(h.restarted).toEqual([]);
    expect(h.cleared).toEqual([]);
  });

  it('memory mode skips the durable activeId persist (no index to write)', async () => {
    const { h, ws } = setup((deps) => {
      (deps as { ephemeralStorage: boolean }).ephemeralStorage = true;
    });
    await ws.switchTo('p1');
    expect(h.persistedIds).toEqual([]);
  });

  it('restarts ONLY the lifecycle-owned dev session captured before teardown, then clears its console', async () => {
    const { h, ws } = setup();
    h.devRunning = true;
    h.devSessionId = 't7';
    await ws.switchTo('p1');
    expect(h.restarted).toEqual(['t7']);
    expect(h.cleared).toEqual(['t7']);
    expect(h.log.indexOf('devMarkStopped')).toBeLessThan(h.log.indexOf('devRestart:t7'));
  });

  it('parks started/ready false during the respawn window, true after the rewire', async () => {
    const { ws, h } = setup();
    let release!: () => void;
    h.awaitOwnerReadyImpl = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const run = ws.switchTo('p1');
    await new Promise((resolve) => setTimeout(resolve, 10)); // held at awaitOwnerReady
    expect(ws.started()).toBe(false);
    expect(ws.ownerReady()).toBe(false);
    release();
    await run;
    expect(ws.started()).toBe(true);
    expect(ws.ownerReady()).toBe(true);
  });

  it('ends the transition veil even when the switch throws', async () => {
    const { h, ws } = setup((deps) => {
      deps.spawnOwner = () => {
        throw new Error('spawn boom');
      };
    });
    await expect(ws.switchTo('p1')).rejects.toThrow('spawn boom');
    expect(h.log.at(-1)).toBe('transition:end');
  });
});

describe('switch tracking + recovery', () => {
  it('a switch that fails AFTER the rewire recovers started from the live new owner', async () => {
    const { h, ws } = setup((deps) => {
      deps.rebindTerminal = async () => {
        throw new Error('rebind boom');
      };
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await ws.trackSwitch(ws.switchTo('p1'));
    spy.mockRestore();
    expect(result).toBe(false);
    expect(h.errors).toEqual(['Switch failed: rebind boom']);
    expect(h.owner.root).toBe('/projects/p1'); // rewired before the throw
    // A throw before restartDevServer set started=true would otherwise wedge
    // every later editor write behind the "choose a project" guard.
    expect(ws.started()).toBe(true);
    expect(ws.ownerReady()).toBe(true);
  });

  it('a switch that fails BEFORE the respawn leaves started parked (no live owner to adopt)', async () => {
    const { h, ws } = setup((deps) => {
      deps.spawnOwner = () => {
        throw new Error('spawn boom');
      };
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await ws.trackSwitch(ws.switchTo('p1'));
    spy.mockRestore();
    expect(result).toBe(false);
    expect(h.errors).toEqual(['Switch failed: spawn boom']);
    expect(ws.started()).toBe(false); // the old owner is closed; nothing alive
  });

  it('waitForPendingSwitch resolves the tracked outcome and clears after settle', async () => {
    const { ws } = setup();
    const tracked = ws.trackSwitch(Promise.resolve(true));
    expect(ws.switchPending()).toBe(true);
    await expect(ws.waitForPendingSwitch()).resolves.toBe(true);
    await tracked;
    expect(ws.switchPending()).toBe(false);
    await expect(ws.waitForPendingSwitch()).resolves.toBe(true); // none pending → true
  });
});

describe('reload restore (re-root + relaunch, ADR-0148/0165)', () => {
  it('re-roots to the persisted project root via the sequential switch, THEN relaunches the dev server', async () => {
    const { h, ws } = setup();
    await ws.restoreOnReload(projIdx('p1'));
    expect(h.owner.root).toBe('/projects/p1');
    expect(h.relaunches).toBe(1);
    expect(h.log.indexOf('setOwner:/projects/p1')).toBeLessThan(h.log.indexOf('relaunch'));
  });

  it('a failed re-root switch never relaunches the dev server', async () => {
    const { h, ws } = setup((deps) => {
      deps.spawnOwner = () => {
        throw new Error('spawn boom');
      };
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ws.restoreOnReload(projIdx('p1'));
    spy.mockRestore();
    expect(h.relaunches).toBe(0);
    expect(h.errors).toHaveLength(1);
  });

  it('same root (dirty scratch draft): adopts the already-started hidden owner and relaunches', async () => {
    const { h, ws } = setup();
    await ws.restoreOnReload(projIdx('scratch'));
    expect(h.spawned).toEqual([]); // no respawn — the hidden owner adopts the draft
    expect(ws.ownerReady()).toBe(true);
    expect(h.relaunches).toBe(1);
  });
});
