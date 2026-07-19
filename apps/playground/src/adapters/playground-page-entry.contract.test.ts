import { describe, expect, it, vi } from 'vitest';
import type { BootResult } from '../boot.ts';
import type { TerminalPersistence } from '../glue/terminal-persistence.ts';
import type { PlaygroundWorkbench } from '../workbench/playground.ts';
import { mountPlaygroundPage } from './playground-page-entry.ts';

const BOOT: BootResult = Object.freeze({
  vfsBoot: Object.freeze({ backend: 'opfs' }),
  storage: Object.freeze({
    available: true,
    persistedBefore: true,
    persistedAfter: true,
  }),
});

function terminalPersistence(): TerminalPersistence {
  return Object.freeze({
    backend: 'opfs',
    initialHistory: Object.freeze([]),
    initialState: Object.freeze({ cwd: '/', env: Object.freeze({}) }),
    initialStateSource: 'project-rooted',
    saveHistory: vi.fn(async (): Promise<void> => {}),
    saveState: vi.fn(async (): Promise<void> => {}),
  });
}

function workbench() {
  const close = vi.fn(async (): Promise<void> => {});
  return {
    close,
    value: Object.freeze({ close }) as unknown as PlaygroundWorkbench,
  };
}

describe('Playground page entry adapter', () => {
  it('runs the boot probe, then paints only occupied without terminal or App construction', async () => {
    const calls: string[] = [];
    const createTerminalPersistence = vi.fn();
    const mountApp = vi.fn();
    const mountFatal = vi.fn();

    await mountPlaygroundPage({
      bootstrapPlayground: async () => {
        calls.push('bootstrap');
        return BOOT;
      },
      openPlaygroundAppWorkbench: async () => {
        calls.push('workbench');
        return { status: 'occupied' } as const;
      },
      createTerminalPersistence,
      mountApp,
      mountOccupied: () => calls.push('occupied'),
      mountFatal,
    });

    expect(calls).toEqual(['bootstrap', 'workbench', 'occupied']);
    expect(createTerminalPersistence).not.toHaveBeenCalled();
    expect(mountApp).not.toHaveBeenCalled();
    expect(mountFatal).not.toHaveBeenCalled();
  });

  it('hands one admitted Workbench to App only after terminal persistence exists', async () => {
    const calls: string[] = [];
    const admitted = workbench();
    const terminal = terminalPersistence();
    const mountApp = vi.fn(() => calls.push('app'));
    const mountFatal = vi.fn();

    await mountPlaygroundPage({
      bootstrapPlayground: async () => {
        calls.push('bootstrap');
        return BOOT;
      },
      openPlaygroundAppWorkbench: async () => {
        calls.push('workbench');
        return { status: 'opened', workbench: admitted.value } as const;
      },
      createTerminalPersistence: async () => {
        calls.push('terminal');
        return terminal;
      },
      mountApp,
      mountOccupied: vi.fn(),
      mountFatal,
    });

    expect(calls).toEqual(['bootstrap', 'workbench', 'terminal', 'app']);
    expect(mountApp).toHaveBeenCalledWith({
      boot: BOOT,
      terminalPersistence: terminal,
      workbench: admitted.value,
    });
    expect(admitted.close).not.toHaveBeenCalled();
    expect(mountFatal).not.toHaveBeenCalled();
  });

  it.each(['boot probe', 'admission'] as const)(
    'paints the standalone failure notice when the %s fails before any Workbench exists',
    async (stage) => {
      const cause = new Error(`${stage} failed`);
      const createTerminalPersistence = vi.fn();
      const mountApp = vi.fn();
      const mountOccupied = vi.fn();
      const mountFatal = vi.fn();

      const started = mountPlaygroundPage({
        bootstrapPlayground: async () => {
          if (stage === 'boot probe') throw cause;
          return BOOT;
        },
        openPlaygroundAppWorkbench: async () => {
          throw cause;
        },
        createTerminalPersistence,
        mountApp,
        mountOccupied,
        mountFatal,
      });

      await expect(started).rejects.toBe(cause);
      expect(mountFatal).toHaveBeenCalledTimes(1);
      expect(mountFatal).toHaveBeenCalledWith(cause);
      expect(createTerminalPersistence).not.toHaveBeenCalled();
      expect(mountApp).not.toHaveBeenCalled();
      expect(mountOccupied).not.toHaveBeenCalled();
    },
  );

  it.each(['terminal', 'mount'] as const)(
    'closes the admitted Workbench, then paints the failure notice, when %s handoff fails',
    async (boundary) => {
      const admitted = workbench();
      const cause = new Error(`${boundary} failed`);
      const mountApp = vi.fn(() => {
        if (boundary === 'mount') throw cause;
      });
      const mountFatal = vi.fn();

      const started = mountPlaygroundPage({
        bootstrapPlayground: async () => BOOT,
        openPlaygroundAppWorkbench: async () => ({
          status: 'opened',
          workbench: admitted.value,
        }),
        createTerminalPersistence: async () => {
          if (boundary === 'terminal') throw cause;
          return terminalPersistence();
        },
        mountApp,
        mountOccupied: vi.fn(),
        mountFatal,
      });

      await expect(started).rejects.toBe(cause);
      expect(admitted.close).toHaveBeenCalledTimes(1);
      expect(mountFatal).toHaveBeenCalledTimes(1);
      expect(mountFatal).toHaveBeenCalledWith(cause);
      expect(admitted.close.mock.invocationCallOrder[0]).toBeLessThan(
        mountFatal.mock.invocationCallOrder[0] ?? 0,
      );
      if (boundary === 'terminal') expect(mountApp).not.toHaveBeenCalled();
    },
  );

  it('preserves both a handoff failure and Workbench cleanup failure in the painted notice', async () => {
    const trigger = new Error('mount failed');
    const cleanup = new Error('Workbench close failed');
    const admitted = workbench();
    admitted.close.mockRejectedValue(cleanup);
    const mountFatal = vi.fn();

    const failure = await mountPlaygroundPage({
      bootstrapPlayground: async () => BOOT,
      openPlaygroundAppWorkbench: async () => ({
        status: 'opened',
        workbench: admitted.value,
      }),
      createTerminalPersistence: async () => terminalPersistence(),
      mountApp: () => {
        throw trigger;
      },
      mountOccupied: vi.fn(),
      mountFatal,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([trigger, cleanup]);
    expect(mountFatal).toHaveBeenCalledTimes(1);
    expect(mountFatal).toHaveBeenCalledWith(failure);
  });

  it('preserves both the trigger and a failure notice that itself fails to paint', async () => {
    const trigger = new Error('admission failed');
    const paintFailure = new Error('failure notice render failed');

    const failure = await mountPlaygroundPage({
      bootstrapPlayground: async () => BOOT,
      openPlaygroundAppWorkbench: async () => {
        throw trigger;
      },
      createTerminalPersistence: async () => terminalPersistence(),
      mountApp: vi.fn(),
      mountOccupied: vi.fn(),
      mountFatal: () => {
        throw paintFailure;
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([trigger, paintFailure]);
  });
});
