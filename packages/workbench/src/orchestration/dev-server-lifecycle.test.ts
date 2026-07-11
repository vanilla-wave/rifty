/**
 * Behavioral contract of the extracted dev-server lifecycle core (ADR-0197) —
 * replaces the App.test.ts source-greps for the dev-server + preview groups.
 * Drives the module through its injected ports; these ARE its public contract
 * (the real fabric is covered by e2e + the browser-unit lane).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PtyDevServer, PtyPreview } from '../glue/pty-protocol.ts';
import type { WorkbenchStarter } from '../project-catalog.ts';
import type { ProjectSpec } from '../project-spec.ts';
import {
  type DevServerLifecycle,
  type DevServerLifecycleDeps,
  type DevServerOwnerPort,
  type DevServerSessionLike,
  createDevServerLifecycle,
} from './dev-server-lifecycle.ts';

type Session = DevServerSessionLike & { status: 'idle' | 'running' };

const VITE_STARTER: WorkbenchStarter = {
  id: 'real-vite',
  name: 'Real Vite',
  templateId: 'tpl-vite',
  files: [],
};
const NODE_CLI_STARTER: WorkbenchStarter = {
  id: 'node-cli',
  name: 'Node CLI',
  templateId: 'tpl-cli',
  files: [],
};
const VITE_SPEC = { id: 'tpl-vite', runtime: 'vite' } as unknown as ProjectSpec;
const NODE_CLI_SPEC = { id: 'tpl-cli', runtime: 'node-cli' } as unknown as ProjectSpec;

function portEntry(port: number, previewScope?: string): PtyPreview['ports'][number] {
  return {
    port,
    url: `/preview/${port}/`,
    label: `:${port}`,
    source: 'node',
    sid: `sid-${port}`,
    ...(previewScope === undefined ? {} : { previewScope }),
  };
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll helper for the module's 50ms wait loops. */
async function until(cond: () => boolean, limitMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > limitMs) throw new Error('until() timed out');
    await tick(10);
  }
}

class FakeOwner implements DevServerOwnerPort {
  devServerCbs: Array<(frame: PtyDevServer) => void> = [];
  previewCbs: Array<(frame: PtyPreview) => void> = [];
  requestPreviewCount = 0;
  unsubscribedDevServer = 0;
  unsubscribedPreview = 0;
  constructor(readonly previewOwnerToken: string) {}
  onDevServer(cb: (frame: PtyDevServer) => void): () => void {
    this.devServerCbs.push(cb);
    return () => {
      this.devServerCbs = this.devServerCbs.filter((c) => c !== cb);
      this.unsubscribedDevServer += 1;
    };
  }
  onPreview(cb: (frame: PtyPreview) => void): () => void {
    this.previewCbs.push(cb);
    return () => {
      this.previewCbs = this.previewCbs.filter((c) => c !== cb);
      this.unsubscribedPreview += 1;
    };
  }
  requestPreview(): void {
    this.requestPreviewCount += 1;
  }
  emitDevServer(frame: Partial<PtyDevServer> & { status: PtyDevServer['status'] }): void {
    for (const cb of [...this.devServerCbs])
      cb({ type: 'pty:dev-server', ...frame } as PtyDevServer);
  }
  emitPreview(ports: PtyPreview['ports']): void {
    for (const cb of [...this.previewCbs]) cb({ type: 'pty:preview', ports });
  }
}

class Harness {
  owner = new FakeOwner('token-A');
  sessions = new Map<string, Session>();
  hidden = new Set<string>();
  active = 't1';
  created: string[] = [];
  selected: string[] = [];
  stopped: string[] = [];
  freshConsoles: Array<{ id: string; banner?: string }> = [];
  refreshCount = 0;
  bootRuns: Array<{ id: string; lines: readonly string[] }> = [];
  executed = new Map<string, { line: string; cwd: string }>();
  persisted: Array<{ line: string; cwd: string } | undefined> = [];
  vitePorts: number[] = [];
  ownerAlive = 0;
  runningEdges = 0;
  bridges: Array<{ port: number; token: string; scope?: string; torn: boolean }> = [];
  starter: WorkbenchStarter = VITE_STARTER;
  private nextId = 10;

  session(id: string, status: 'idle' | 'running' = 'idle'): Session {
    const s: Session = { id, status };
    this.sessions.set(id, s);
    return s;
  }

  deps(): DevServerLifecycleDeps<Session> {
    return {
      terminal: {
        snapshot: (id) => {
          const s = this.sessions.get(id);
          if (!s) throw new Error(`unknown session ${id}`);
          return s;
        },
        activeSessionId: () => this.active,
        select: (id) => this.selected.push(id),
        stop: (id) => this.stopped.push(id),
        freshConsole: (id, banner) => this.freshConsoles.push({ id, banner }),
        createSession: () => {
          const id = `t${this.nextId++}`;
          this.created.push(id);
          return this.session(id, 'idle');
        },
        refreshState: () => {
          this.refreshCount += 1;
        },
        visibleSessions: () => [...this.sessions.values()].filter((s) => !this.hidden.has(s.id)),
        isHidden: (id) => this.hidden.has(id),
      },
      runBootSequence: async (id, lines) => {
        this.bootRuns.push({ id, lines });
        // manager.runLine flips the session to 'running' synchronously with the
        // dispatch — the boot-wait loops rely on that contract.
        this.session(id, 'running');
      },
      executedLine: (sid) => this.executed.get(sid),
      persistDevCommand: (command) => {
        this.persisted.push(command);
      },
      setRealVitePort: (port) => {
        this.vitePorts.push(port);
      },
      onOwnerAlive: () => {
        this.ownerAlive += 1;
      },
      onServerRunningEdge: () => {
        this.runningEdges += 1;
      },
      wirePreviewBridge: (port, token, scope) => {
        const entry = { port, token, scope, torn: false };
        this.bridges.push(entry);
        return () => {
          entry.torn = true;
        };
      },
      bootLines: (starter) => [`boot:${starter.id}`],
      activeStarter: () => this.starter,
      projectSpecForStarter: (starter) =>
        starter === NODE_CLI_STARTER ? NODE_CLI_SPEC : VITE_SPEC,
      welcomeBanner: 'welcome!',
    };
  }
}

interface Ctx {
  h: Harness;
  dev: DevServerLifecycle<Session>;
  dispose: () => void;
}

function setup(prep?: (h: Harness) => void): Ctx {
  const h = new Harness();
  h.session('t1', 'idle');
  prep?.(h);
  const dev = createDevServerLifecycle<Session>(h.deps());
  dev.attachOwner(h.owner);
  return { h, dev, dispose: () => dev.dispose() };
}

describe('dev-server frame mirror (ADR-0148 owner-driven readiness)', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('derives status from pty:dev-server frames, never from stdout matching', async () => {
    const { h, dev, dispose } = ctx;
    expect(dev.status()).toBe('stopped');
    h.owner.emitDevServer({ status: 'starting', sid: 't1' });
    expect(dev.status()).toBe('starting');
    h.owner.emitDevServer({ status: 'running', sid: 't1', port: 5173 });
    expect(dev.status()).toBe('running');
    expect(dev.running()).toBe(true);
    expect(h.vitePorts).toEqual([5173]);
    dispose();
  });

  it('exposes atomic snapshots and framework-free change subscriptions', () => {
    const { h, dev, dispose } = ctx;
    const seen: Array<{ status: string; ports: number[] }> = [];
    const unsubscribe = dev.subscribe((snapshot) => {
      seen.push({
        status: snapshot.status,
        ports: snapshot.previewPorts.map((entry) => entry.port),
      });
    });

    expect(dev.snapshot()).toMatchObject({
      status: 'stopped',
      running: false,
      previewPorts: [],
      generation: 0,
    });
    h.owner.emitDevServer({ status: 'starting', sid: 't1' });
    h.owner.emitPreview([portEntry(5173)]);
    expect(seen).toEqual([
      { status: 'starting', ports: [] },
      { status: 'starting', ports: [5173] },
    ]);

    unsubscribe();
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    expect(seen).toHaveLength(2);
    dispose();
  });

  it('a non-stopped frame proves the owner alive; a running edge fires once', async () => {
    const { h, dispose } = ctx;
    h.owner.emitDevServer({ status: 'starting', sid: 't1' });
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    expect(h.ownerAlive).toBe(3);
    expect(h.runningEdges).toBe(1); // stopped→running only, not per running frame
    dispose();
  });

  it('pins the dev command on running (owner cwd wins over the stale page cache)', async () => {
    const { h, dispose } = ctx;
    h.executed.set('t1', { line: 'npm run dev', cwd: '/' });
    h.owner.emitDevServer({ status: 'running', sid: 't1', cwd: '/scratch' });
    expect(h.persisted).toEqual([{ line: 'npm run dev', cwd: '/scratch' }]);
    dispose();
  });

  it('clears the dev command only on a REAL clean stop; an errored stop keeps it', async () => {
    const { h, dispose } = ctx;
    // boot-time stopped re-publish: never ran → no clear recorded
    h.owner.emitDevServer({ status: 'stopped' });
    expect(h.persisted).toEqual([]);
    h.executed.set('t1', { line: 'vite', cwd: '/scratch' });
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    // errored stop (owner crash) keeps the command — a reload should relaunch
    h.owner.emitDevServer({ status: 'stopped', error: 'owner exited' } as Partial<PtyDevServer> & {
      status: 'stopped';
    });
    expect(h.persisted).toEqual([{ line: 'vite', cwd: '/scratch' }]);
    // clean running→stopped clears
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    h.owner.emitDevServer({ status: 'stopped' });
    expect(h.persisted.at(-1)).toBeUndefined();
    expect(h.persisted).toHaveLength(3);
    dispose();
  });

  it('tracks the owner session: stoppable = owner-reported, boot sid cleared only for itself', async () => {
    const { h, dev, dispose } = ctx;
    dev.beginBoot('t1');
    expect(dev.stoppableSessionId()).toBe('t1');
    // another session's stop must NOT clear t1's boot claim
    h.owner.emitDevServer({ status: 'stopped', sid: 't9' });
    expect(dev.stoppableSessionId()).toBe('t1');
    // its own stop (or a sid-less stop) clears it
    h.owner.emitDevServer({ status: 'stopped', sid: 't1' });
    expect(dev.stoppableSessionId()).toBeNull();
    dispose();
  });

  it('re-subscribes on an owner swap (switch respawn) and drops the old owner', async () => {
    const { h, dev, dispose } = ctx;
    const next = new FakeOwner('token-B');
    dev.attachOwner(next);
    expect(next.devServerCbs).toHaveLength(1);
    expect(next.previewCbs).toHaveLength(1);
    expect(next.requestPreviewCount).toBe(1);
    expect(h.owner.devServerCbs).toHaveLength(0);
    expect(h.owner.unsubscribedPreview).toBe(1);
    expect(h.owner.unsubscribedDevServer).toBe(1);
    next.emitDevServer({ status: 'running', sid: 't1' });
    expect(dev.status()).toBe('running');
    dispose();
  });

  it('markStopped forces the mirror (switch path) without an owner frame', async () => {
    const { h, dev, dispose } = ctx;
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    dev.markStopped();
    expect(dev.status()).toBe('stopped');
    dispose();
  });
});

describe('preview-port set + SW bridges (ADR-0155/0157 single wiring path)', () => {
  it('mirrors the owner set and re-requests it on subscribe (handshake, not one-shot)', async () => {
    const { h, dev, dispose } = setup();
    expect(h.owner.requestPreviewCount).toBe(1);
    h.owner.emitPreview([portEntry(5173), portEntry(3000, 's1')]);
    expect(dev.previewPorts().map((p) => p.port)).toEqual([5173, 3000]);
    dispose();
  });

  it('wires one bridge per port+scope key and never re-wires a surviving key', async () => {
    const { h, dispose } = setup();
    h.owner.emitPreview([portEntry(5173)]);
    expect(h.bridges).toHaveLength(1);
    h.owner.emitPreview([portEntry(5173), portEntry(3000, 's1')]);
    expect(h.bridges).toHaveLength(2);
    expect(h.bridges[0]).toMatchObject({ port: 5173, token: 'token-A', torn: false });
    expect(h.bridges[1]).toMatchObject({ port: 3000, scope: 's1', torn: false });
    // same port, DIFFERENT scope = a distinct bridge (scope participates in the key)
    h.owner.emitPreview([portEntry(5173), portEntry(5173, 's2')]);
    expect(h.bridges).toHaveLength(3);
    expect(h.bridges.filter((b) => b.port === 5173 && !b.torn)).toHaveLength(2);
    dispose();
  });

  it('tears the bridge of a departed port and all bridges on dispose', async () => {
    const { h, dispose } = setup();
    h.owner.emitPreview([portEntry(5173), portEntry(3000)]);
    expect(h.bridges).toHaveLength(2);
    h.owner.emitPreview([portEntry(5173)]);
    expect(h.bridges.some((b) => b.port === 3000 && b.torn)).toBe(true);
    expect(h.bridges.find((b) => b.port === 5173)?.torn).toBe(false);
    dispose();
    expect(h.bridges.every((b) => b.torn)).toBe(true);
  });

  it('attempts every route teardown when one teardown throws', () => {
    const h = new Harness();
    h.session('t1', 'idle');
    const torn: number[] = [];
    const dev = createDevServerLifecycle<Session>({
      ...h.deps(),
      wirePreviewBridge: (port) => () => {
        torn.push(port);
        if (port === 5173) throw new Error('route 5173 teardown failed');
      },
    });
    dev.attachOwner(h.owner);
    h.owner.emitPreview([portEntry(5173), portEntry(3000)]);

    expect(() => dev.dispose()).toThrow(/route 5173 teardown failed/);
    expect(torn).toEqual([5173, 3000]);
  });

  it('attempts subscriptions and routes when every teardown boundary throws', () => {
    const h = new Harness();
    h.session('t1', 'idle');
    const attempted: string[] = [];
    let publishPreview: ((frame: PtyPreview) => void) | undefined;
    const owner: DevServerOwnerPort = {
      previewOwnerToken: 'fault-owner',
      onDevServer: () => () => {
        attempted.push('dev subscription');
        throw new Error('dev unsubscribe failed');
      },
      onPreview: (listener) => {
        publishPreview = listener;
        return () => {
          attempted.push('preview subscription');
          throw new Error('preview unsubscribe failed');
        };
      },
      requestPreview() {},
    };
    const dev = createDevServerLifecycle<Session>({
      ...h.deps(),
      wirePreviewBridge: () => () => {
        attempted.push('preview route');
        throw new Error('route teardown failed');
      },
    });
    dev.attachOwner(owner);
    publishPreview?.({ type: 'pty:preview', ports: [portEntry(5173)] });

    expect(() => dev.dispose()).toThrow(
      /dev unsubscribe failed.*preview unsubscribe failed.*route teardown failed/,
    );
    expect(attempted).toEqual(['dev subscription', 'preview subscription', 'preview route']);
  });

  it('rewires a same-port bridge under the NEW owner token on an owner swap', async () => {
    const { h, dev, dispose } = setup();
    h.owner.emitPreview([portEntry(5173)]);
    expect(h.bridges).toEqual([{ port: 5173, token: 'token-A', scope: undefined, torn: false }]);
    // owner respawn (project switch) reuses port 5173: wirePreviewBridge captured
    // token-A at creation, so keeping that bridge would validate preview fetches
    // against the DEAD owner — the swap must tear it and rewire under token-B.
    const next = new FakeOwner('token-B');
    dev.attachOwner(next);
    expect(h.bridges.filter((b) => b.token === 'token-A').every((b) => b.torn)).toBe(true);
    const rewired = h.bridges.filter((b) => b.token === 'token-B');
    expect(rewired).toEqual([{ port: 5173, token: 'token-B', scope: undefined, torn: false }]);
    // the new owner's own preview publish keeps (not re-wires) the fresh bridge
    next.emitPreview([portEntry(5173)]);
    expect(h.bridges.filter((b) => b.token === 'token-B')).toHaveLength(1);
    dispose();
    expect(h.bridges.every((b) => b.torn)).toBe(true);
  });

  it('keeps a second server’s preview when one session stops (owner-derived set, no page wipe)', async () => {
    const { h, dev, dispose } = setup();
    h.session('t1', 'running');
    h.owner.emitPreview([portEntry(5173), portEntry(3000)]);
    expect(h.bridges).toHaveLength(2);
    dev.claimSession('t1');
    dev.beginBoot('t1');
    const stop = dev.stopSession('t1');
    h.session('t1', 'idle');
    await stop;
    // the set stays owner-derived: no local wipe of the other server's port
    expect(dev.previewPorts().map((p) => p.port)).toEqual([5173, 3000]);
    expect(h.bridges.filter((b) => b.torn)).toHaveLength(0);
    dispose();
  });
});

describe('dev session pick/reserve (ordinary terminals, no named vite tab)', () => {
  it('picks the ACTIVE idle session (whatever its title) without creating a tab', () => {
    const { h, dev, dispose } = setup();
    expect(dev.pickSession().id).toBe('t1');
    expect(h.created).toEqual([]);
    dispose();
  });

  it('prefers the previous dev session when idle and visible (and selects it)', () => {
    const { h, dev, dispose } = setup((harness) => {
      harness.session('t2', 'idle');
    });
    dev.claimSession('t2');
    expect(dev.pickSession().id).toBe('t2');
    expect(h.selected).toContain('t2');
    dispose();
  });

  it('falls back to a visible idle session, else creates one', () => {
    const { h, dev, dispose } = setup((harness) => {
      harness.session('t1', 'running');
      harness.session('t2', 'idle');
      harness.hidden.add('t2');
      harness.session('t3', 'idle');
    });
    expect(dev.pickSession().id).toBe('t3');
    h.session('t3', 'running');
    expect(dev.pickSession().id).toBe(h.created[0]);
    dispose();
  });

  it('reserveSession retries creation and throws after three unusable replacements', async () => {
    const { h, dev, dispose } = setup((harness) => {
      harness.session('t1', 'running');
    });
    // every created session immediately hidden → unusable ×3 → loud throw
    const origSession = h.session.bind(h);
    h.session = (id: string, status: 'idle' | 'running' = 'idle') => {
      const s = origSession(id, status);
      h.hidden.add(id);
      return s;
    };
    await expect(dev.reserveSession(h.sessions.get('t1') as Session)).rejects.toThrow(
      'Unable to reserve an idle terminal for the dev server',
    );
    dispose();
  });
});

describe('boot/stop/restart sequencing', () => {
  it('startSession claims the session, paints a fresh console + banner, runs the preset boot lines', async () => {
    const { h, dev, dispose } = setup();
    h.session('t1', 'running'); // dev line occupies the terminal
    const gen = dev.nextGeneration();
    const boot = dev.startSession('t1', gen, VITE_STARTER);
    await until(() => h.bootRuns.length === 1);
    expect(h.freshConsoles).toEqual([{ id: 't1', banner: 'welcome!' }]);
    expect(h.bootRuns[0]).toEqual({ id: 't1', lines: ['boot:real-vite'] });
    expect(dev.sessionId()).toBe('t1');
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    await expect(boot).resolves.toBe(true);
    expect(dev.lifecycleRunning()).toBe(true);
    dispose();
  });

  it('never boots into a hidden/closed target — falls back to a visible session', async () => {
    const { h, dev, dispose } = setup((harness) => {
      harness.session('ghost', 'idle');
      harness.hidden.add('ghost');
    });
    const gen = dev.nextGeneration();
    const boot = dev.startSession('ghost', gen, VITE_STARTER);
    await until(() => h.bootRuns.length === 1);
    expect(h.bootRuns[0]?.id).toBe('t1'); // visible active idle, not the hidden target
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    await expect(boot).resolves.toBe(true);
    dispose();
  });

  it('honors bootLinesOverride over the preset lines', async () => {
    const { h, dev, dispose } = setup();
    const gen = dev.nextGeneration();
    const boot = dev.startSession('t1', gen, VITE_STARTER, ['npm run dev -- --port 4000']);
    await until(() => h.bootRuns.length === 1);
    expect(h.bootRuns[0]?.lines).toEqual(['npm run dev -- --port 4000']);
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    await boot;
    dispose();
  });

  it('does not treat an already-running FOREIGN dev server as the picked preset boot', async () => {
    const { h, dev, dispose } = setup();
    // a foreign server (other session) keeps the GLOBAL status running
    h.owner.emitDevServer({ status: 'running', sid: 'foreign' });
    h.session('t1', 'running');
    const gen = dev.nextGeneration();
    const boot = dev.startSession('t1', gen, VITE_STARTER);
    await tick(120); // still waiting: running but not OUR session
    h.session('t1', 'idle'); // our boot line exits without a server
    await expect(boot).resolves.toBe(false);
    expect(dev.lifecycleRunning()).toBe(false);
    dispose();
  });

  it('waits for node-cli presets as terminal commands, not preview servers', async () => {
    const { h, dev, dispose } = setup();
    h.session('t1', 'running');
    const gen = dev.nextGeneration();
    const boot = dev.startSession('t1', gen, NODE_CLI_STARTER);
    await tick(120);
    h.session('t1', 'idle'); // CLI finished — that IS success for node-cli
    await expect(boot).resolves.toBe(true);
    dispose();
  });

  it('a generation bump (raced restart) cancels a pending boot wait', async () => {
    const { h, dev, dispose } = setup();
    h.session('t1', 'running');
    const gen = dev.nextGeneration();
    const boot = dev.startSession('t1', gen, VITE_STARTER);
    await tick(60);
    dev.nextGeneration();
    await expect(boot).resolves.toBe(false);
    dispose();
  });

  it('stopSession stops only a session that still owns the lifecycle run (stale terminals untouched)', async () => {
    const { h, dev, dispose } = setup();
    dev.claimSession('t1');
    // no boot claim → a stale terminal is NOT stopped
    await dev.stopSession('t1');
    expect(h.stopped).toEqual([]);
    // with a boot claim whose lifecycle frame already stopped → also untouched
    dev.beginBoot('t1');
    h.owner.emitDevServer({ status: 'stopped', sid: 't1' }); // clears the boot claim
    await dev.stopSession('t1');
    expect(h.stopped).toEqual([]);
    dispose();
  });

  it('stopSession waits out OUR primary ownership even while a second server keeps status running', async () => {
    const { h, dev, dispose } = setup();
    h.session('t1', 'running');
    dev.claimSession('t1');
    dev.beginBoot('t1');
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    const stop = dev.stopSession('t1');
    await tick(60);
    // the owner reports the OTHER server as the new primary — global status stays running
    h.owner.emitDevServer({ status: 'running', sid: 't2' });
    h.session('t1', 'idle');
    await stop; // resolves although status() is still 'running'
    expect(dev.status()).toBe('running');
    expect(h.stopped).toEqual(['t1']);
    dispose();
  });

  it('restart stops the tracked session and boots the ACTIVE STARTER preset (never a stale pick)', async () => {
    const { h, dev, dispose } = setup();
    h.session('t1', 'running');
    dev.claimSession('t1');
    dev.beginBoot('t1');
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    h.starter = {
      id: 'switched-starter',
      name: 'Switched starter',
      templateId: 'tpl-vite',
      files: [],
    };
    const restart = dev.restart('t1');
    await tick(60);
    h.owner.emitDevServer({ status: 'stopped', sid: 't1' });
    h.session('t1', 'idle');
    await until(() => h.bootRuns.length === 1);
    expect(h.bootRuns[0]?.lines).toEqual(['boot:switched-starter']); // store-derived starter
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    await restart;
    dispose();
  });

  it('a restart raced by a newer generation returns without booting', async () => {
    const { h, dev, dispose } = setup();
    h.session('t1', 'running');
    dev.claimSession('t1');
    dev.beginBoot('t1');
    h.owner.emitDevServer({ status: 'running', sid: 't1' });
    const restart = dev.restart('t1');
    await tick(60);
    dev.nextGeneration(); // a competing transition claimed the lifecycle
    h.owner.emitDevServer({ status: 'stopped', sid: 't1' });
    h.session('t1', 'idle');
    await restart;
    expect(h.bootRuns).toEqual([]); // no boot for the superseded restart
    dispose();
  });

  it('stopBeforeStarterWrite is a no-op unless the lifecycle dev server is running', async () => {
    const { h, dev, dispose } = setup();
    await dev.stopBeforeStarterWrite();
    expect(h.stopped).toEqual([]);
    h.session('t1', 'running');
    dev.claimSession('t1');
    dev.beginBoot('t1');
    const stop = dev.stopBeforeStarterWrite();
    await tick(60);
    h.session('t1', 'idle');
    await stop;
    expect(h.stopped).toEqual(['t1']);
    dispose();
  });
});
