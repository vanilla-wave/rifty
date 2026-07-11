import type { ProjectSpec } from '@riftydev/workbench';
/**
 * Behavioral contract of the extracted preset-boot core (ADR-0197 slice 3) —
 * replaces the App.test.ts source-greps for the preset selection & switching
 * group. Drives the module through its injected ports (ADR-0197 §4); the
 * dev-server core is a fake implementing the slice-1 port surface.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Preset } from '../presets.ts';
import { type PresetBoot, type PresetBootDeps, createPresetBoot } from './preset-boot.ts';

type Session = { id: string };

const VITE_PRESET = { id: 'real-vite', setup: 'instant' } as unknown as Preset;
const VITE_SPEC = { id: 'tpl-vite', runtime: 'vite' } as unknown as ProjectSpec;

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Harness {
  log: string[] = [];
  running = false;
  devSessionId: string | null = null;
  generation = 0;
  bootResult = true;
  startResult = true;
  ephemeral = false;
  dirty = false;
  dirtyChecks = 0;
  warmEditorCount = 0;
  reserveSwapsTo: string | null = null;
  releaseBoot: (() => void) | null = null;
  holdBoot = false;
  private nextId = 10;

  deps(): PresetBootDeps<Session> {
    return {
      devServer: {
        lifecycleRunning: () => this.running,
        sessionId: () => this.devSessionId,
        pickSession: () => {
          const id = `t${this.nextId++}`;
          this.log.push(`pick:${id}`);
          return { id };
        },
        reserveSession: async (session) => {
          const id = this.reserveSwapsTo ?? session.id;
          this.log.push(`reserve:${session.id}->${id}`);
          return { id };
        },
        claimSession: (id) => this.log.push(`claim:${id}`),
        beginBoot: (id) => this.log.push(`beginBoot:${id}`),
        nextGeneration: () => {
          this.generation += 1;
          this.log.push(`nextGen:${this.generation}`);
          return this.generation;
        },
        currentGeneration: () => this.generation,
        stopSession: async (id) => {
          this.log.push(`stop:${id}`);
        },
        stopBeforeStarterWrite: async () => {
          this.log.push('stopBeforeWrite');
        },
        startSession: async (id, generation, preset, override) => {
          this.log.push(`start:${id}:g${generation}:${preset.id}:${override?.join('|') ?? ''}`);
          return this.startResult;
        },
        waitForPresetBoot: async (id, generation, spec) => {
          this.log.push(`waitBoot:${id}:g${generation}:${spec.id}`);
          if (this.holdBoot) {
            await new Promise<void>((resolve) => {
              this.releaseBoot = resolve;
            });
          }
          return this.bootResult;
        },
      },
      presetForId: () => VITE_PRESET,
      templateForPreset: () => VITE_SPEC,
      bootLines: (preset) => [`boot:${preset.id}`],
      applyDevConfig: async (preset) => {
        this.log.push(`devConfig:${preset.id}`);
      },
      freshConsole: (id) => this.log.push(`fresh:${id}`),
      runBootSequence: async (id, lines) => {
        this.log.push(`run:${id}:${lines.join('|')}`);
      },
      reinitializeTs: () => this.log.push('reinitTs'),
      dirtyScratchPick: () => {
        this.dirtyChecks += 1;
        return this.dirty;
      },
      setOwnerReady: (ready) => this.log.push(`ownerReady:${ready}`),
      paintStarterUi: async (preset) => {
        this.log.push(`paint:${preset.id}`);
      },
      markEditorContextReady: () => this.log.push('editorReady'),
      warmEditorStack: () => {
        this.warmEditorCount += 1;
        this.log.push('warmEditor');
      },
      noteStarterBaselinePending: () => this.log.push('noteBaseline'),
      ensureOwnerStarted: async () => {
        this.log.push('ensureStarted');
      },
      establishScratch: async (id, opts) => {
        this.log.push(`scratch:${id}:${opts.preserveDirtySameStarter === true}`);
      },
      ephemeralStorage: this.ephemeral,
      seedWorkspace: async (preset) => {
        this.log.push(`seed:${preset.id}`);
      },
    };
  }
}

function setup(prep?: (h: Harness) => void): { h: Harness; boot: PresetBoot } {
  const h = new Harness();
  prep?.(h);
  return { h, boot: createPresetBoot<Session>(h.deps()) };
}

function pickOpts(h: Harness, over: Partial<Parameters<PresetBoot['pickStarter']>[1]> = {}) {
  return {
    commit: (id: string) => h.log.push(`commit:${id}`),
    guardDirtyScratch: true,
    preserveDirtySameStarter: true,
    ...over,
  };
}

describe('preset dev-server boot (fresh session)', () => {
  it('claims a picked session BEFORE the owner dev-config, reserves, greets, boots and re-inits TS', async () => {
    const { h, boot } = setup();
    await boot.runPreset(VITE_PRESET);
    expect(h.log).toEqual([
      'pick:t10',
      'claim:t10',
      'devConfig:real-vite', // session reservation strictly precedes setDevConfig
      'reserve:t10->t10',
      'claim:t10',
      'fresh:t10',
      'nextGen:1',
      'beginBoot:t10',
      'run:t10:boot:real-vite',
      'waitBoot:t10:g1:tpl-vite',
      'reinitTs',
    ]);
  });

  it('a reservation swap re-claims and boots the REPLACEMENT session', async () => {
    const { h, boot } = setup((h) => {
      h.reserveSwapsTo = 't99';
    });
    await boot.runPreset(VITE_PRESET);
    expect(h.log).toContain('claim:t99');
    expect(h.log).toContain('fresh:t99');
    expect(h.log).toContain('run:t99:boot:real-vite');
  });

  it('boot-lines override replaces the preset boot lines (reload restore path)', async () => {
    const { h, boot } = setup();
    await boot.runPreset(VITE_PRESET, undefined, ['npm run dev -- --port 5199']);
    expect(h.log).toContain('run:t10:npm run dev -- --port 5199');
  });

  it('a failed boot never re-inits TS', async () => {
    const { h, boot } = setup((h) => {
      h.bootResult = false;
    });
    await boot.runPreset(VITE_PRESET);
    expect(h.log).not.toContain('reinitTs');
  });
});

describe('preset dev-server boot (restart in place, ADR-0148)', () => {
  it('stops the lifecycle-owned session, re-boots it under the SAME captured generation', async () => {
    const { h, boot } = setup((h) => {
      h.running = true;
      h.devSessionId = 't7';
    });
    await boot.runPreset(VITE_PRESET);
    expect(h.log).toEqual([
      'nextGen:1',
      'stop:t7',
      'devConfig:real-vite',
      'start:t7:g1:real-vite:',
      'reinitTs',
    ]);
  });

  it('a superseded restart generation aborts before any boot', async () => {
    const { h, boot } = setup((h) => {
      h.running = true;
      h.devSessionId = 't7';
    });
    const deps = h.deps();
    const superseding = createPresetBoot<Session>(deps);
    // Another restart bumps the generation while the stop is in flight.
    deps.devServer.stopSession = async (id) => {
      h.log.push(`stop:${id}`);
      h.generation += 1; // concurrent nextGeneration()
    };
    await superseding.runPreset(VITE_PRESET);
    expect(h.log.some((l) => l.startsWith('start:'))).toBe(false);
    expect(h.log).not.toContain('reinitTs');
    expect(boot.transitioning()).toBe(false);
  });

  it('a failed restart boot never re-inits TS', async () => {
    const { h, boot } = setup((h) => {
      h.running = true;
      h.devSessionId = 't7';
      h.startResult = false;
    });
    await boot.runPreset(VITE_PRESET);
    expect(h.log).not.toContain('reinitTs');
  });
});

describe('transition veil + TS gate', () => {
  it('transitioning is true for the whole boot and false after; the TS gate resolves in finally', async () => {
    const { h, boot } = setup((h) => {
      h.holdBoot = true;
    });
    const gate = boot.beginTsTransition();
    let tsReady = false;
    void boot.tsTransitionReady().then(() => {
      tsReady = true;
    });
    const run = boot.runPreset(VITE_PRESET, gate);
    await tick(10);
    expect(boot.transitioning()).toBe(true);
    expect(tsReady).toBe(false);
    h.releaseBoot?.();
    await run;
    await tick(0);
    expect(boot.transitioning()).toBe(false);
    expect(tsReady).toBe(true);
  });

  it('the veil drops and the gate resolves even when the boot throws', async () => {
    const { boot } = setup();
    const h2 = new Harness();
    const deps = h2.deps();
    deps.applyDevConfig = async () => {
      throw new Error('config boom');
    };
    const throwing = createPresetBoot<Session>(deps);
    const gate = throwing.beginTsTransition();
    let tsReady = false;
    void throwing.tsTransitionReady().then(() => {
      tsReady = true;
    });
    await expect(throwing.runPreset(VITE_PRESET, gate)).rejects.toThrow('config boom');
    await tick(0);
    expect(throwing.transitioning()).toBe(false);
    expect(tsReady).toBe(true);
    expect(boot.tsTransitionReady()).toBeInstanceOf(Promise);
  });

  it('tsTransitionReady starts resolved (no gate pending on boot)', async () => {
    const { boot } = setup();
    await expect(boot.tsTransitionReady()).resolves.toBeUndefined();
  });

  it('begin/endTransition drive the veil for the workspace-switch path', () => {
    const { boot } = setup();
    boot.beginTransition();
    expect(boot.transitioning()).toBe(true);
    boot.endTransition();
    expect(boot.transitioning()).toBe(false);
  });
});

describe('transition queue serialization', () => {
  it('queued launches run strictly one after another, and a failure never kills the chain', async () => {
    const { boot } = setup();
    const order: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = boot.queueTransition(async () => {
      order.push('first:start');
      await tick(20);
      order.push('first:end');
    });
    const failing = boot.queueTransition(async () => {
      order.push('failing');
      throw new Error('boom');
    });
    const second = boot.queueTransition(async () => {
      order.push('second');
    });
    await Promise.all([first, failing, second]);
    spy.mockRestore();
    expect(order).toEqual(['first:start', 'first:end', 'failing', 'second']);
  });
});

describe('gallery-pick flow', () => {
  it('a clean pick: veil-blind commit, paint → owner → stop-before-write → scratch → boot, owner-ready flip around', async () => {
    const { h, boot } = setup();
    await boot.pickStarter('real-vite', pickOpts(h));
    await tick(20); // fresh pick is fire-and-forget — let the queued boot settle
    expect(h.log.slice(0, 11)).toEqual([
      'warmEditor',
      'ownerReady:false',
      'commit:real-vite',
      'paint:real-vite',
      'editorReady',
      'noteBaseline',
      'ensureStarted',
      'stopBeforeWrite',
      'scratch:real-vite:true',
      'ownerReady:true',
      'pick:t10', // runPreset takes over
    ]);
    expect(h.dirtyChecks).toBe(1);
    expect(h.log).toContain('reinitTs');
  });

  it('a dirty-scratch pick only commits (the store opened the switch dialog) — no boot, no TS gate', async () => {
    const { h, boot } = setup((h) => {
      h.dirty = true;
    });
    let gated = true;
    await boot.pickStarter('real-vite', pickOpts(h));
    await tick(10);
    void boot.tsTransitionReady().then(() => {
      gated = false;
    });
    await tick(0);
    expect(h.log).toEqual(['warmEditor', 'commit:real-vite']);
    expect(h.dirtyChecks).toBe(1);
    expect(h.warmEditorCount).toBe(1);
    expect(gated).toBe(false); // no gate was opened
  });

  it('starter pick warms the lazy editor stack immediately on user intent', async () => {
    const { h, boot } = setup();
    await boot.pickStarter('real-vite', pickOpts(h));
    expect(h.log[0]).toBe('warmEditor');
    expect(h.warmEditorCount).toBe(1);
  });

  it('memory mode AWAITS the workspace seed before the dev server boots', async () => {
    const { h, boot } = setup((h) => {
      h.ephemeral = true;
    });
    await boot.pickStarter('real-vite', pickOpts(h));
    await tick(20);
    const seedAt = h.log.indexOf('seed:real-vite');
    const bootAt = h.log.findIndex((l) => l.startsWith('run:'));
    expect(seedAt).toBeGreaterThan(h.log.indexOf('scratch:real-vite:true'));
    expect(seedAt).toBeLessThan(bootAt);
  });

  it('OPFS mode never page-seeds (establishScratch owns the tree)', async () => {
    const { h, boot } = setup();
    await boot.pickStarter('real-vite', pickOpts(h));
    await tick(20);
    expect(h.log.some((l) => l.startsWith('seed:'))).toBe(false);
  });

  it('a mid-transition pick QUEUES after the in-flight boot and is awaited', async () => {
    const { h, boot } = setup((h) => {
      h.holdBoot = true;
    });
    void boot.queueTransition(() => boot.runPreset(VITE_PRESET));
    await tick(10);
    expect(boot.transitioning()).toBe(true);
    let pickDone = false;
    const pick = boot.pickStarter('vite8', pickOpts(h)).then(() => {
      pickDone = true;
    });
    await tick(10);
    expect(pickDone).toBe(false); // still queued behind the held boot
    expect(h.log).not.toContain('commit:vite8');
    h.holdBoot = false;
    h.releaseBoot?.();
    await pick;
    expect(pickDone).toBe(true);
    expect(h.log).toContain('commit:vite8');
  });

  it('a fresh pick is fire-and-forget: pickStarter resolves while the boot is still in flight', async () => {
    const { h, boot } = setup((h) => {
      h.holdBoot = true;
    });
    await boot.pickStarter('real-vite', pickOpts(h));
    expect(h.log).not.toContain('reinitTs'); // resolved while the boot is held
    while (!h.releaseBoot) await tick(5); // let the queued boot reach the hold
    h.releaseBoot();
    await tick(10);
    expect(h.log).toContain('reinitTs');
  });

  it('an eager TS gate blocks TS requests for the whole queued wait (confirmed switch-dialog pick)', async () => {
    const { h, boot } = setup((h) => {
      h.holdBoot = true;
    });
    void boot.queueTransition(() => boot.runPreset(VITE_PRESET));
    await tick(10);
    let gated = true;
    void boot
      .pickStarter('vite8', pickOpts(h, { guardDirtyScratch: false, eagerTsGate: true }))
      .then(() => {});
    void boot.tsTransitionReady().then(() => {
      gated = false;
    });
    await tick(10);
    expect(gated).toBe(true); // gate opened BEFORE the queued boot ran
    h.holdBoot = false;
    h.releaseBoot?.();
    await tick(30);
    expect(gated).toBe(false);
  });
});
