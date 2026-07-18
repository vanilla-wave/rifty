import { describe, expect, it, vi } from 'vitest';
import { startPlaygroundEntry } from './playground-entry.ts';

function workbench() {
  return Object.freeze({ close: vi.fn(async (): Promise<void> => {}) });
}

describe('Playground entry admission handoff', () => {
  it('runs the boot probe, then paints only occupied without terminal or App construction', async () => {
    const calls: string[] = [];
    const createTerminalPersistence = vi.fn();
    const mountApp = vi.fn();

    await startPlaygroundEntry({
      bootstrap: async () => {
        calls.push('bootstrap');
        return 'boot';
      },
      openWorkbench: async () => {
        calls.push('workbench');
        return { status: 'occupied' } as const;
      },
      createTerminalPersistence,
      mountApp,
      mountOccupied: () => calls.push('occupied'),
    });

    expect(calls).toEqual(['bootstrap', 'workbench', 'occupied']);
    expect(createTerminalPersistence).not.toHaveBeenCalled();
    expect(mountApp).not.toHaveBeenCalled();
  });

  it('transfers one admitted Workbench to App only after terminal persistence exists', async () => {
    const calls: string[] = [];
    const admitted = workbench();
    const mountApp = vi.fn(() => calls.push('app'));

    await startPlaygroundEntry({
      bootstrap: async () => {
        calls.push('bootstrap');
        return { backend: 'opfs' };
      },
      openWorkbench: async () => {
        calls.push('workbench');
        return { status: 'opened', workbench: admitted } as const;
      },
      createTerminalPersistence: async () => {
        calls.push('terminal');
        return { history: [] };
      },
      mountApp,
      mountOccupied: vi.fn(),
    });

    expect(calls).toEqual(['bootstrap', 'workbench', 'terminal', 'app']);
    expect(mountApp).toHaveBeenCalledWith({
      boot: { backend: 'opfs' },
      terminalPersistence: { history: [] },
      workbench: admitted,
    });
    expect(admitted.close).not.toHaveBeenCalled();
  });

  it.each(['terminal', 'mount'] as const)(
    'closes the admitted Workbench when %s handoff fails',
    async (boundary) => {
      const admitted = workbench();
      const cause = new Error(`${boundary} failed`);
      const mountApp = vi.fn(() => {
        if (boundary === 'mount') throw cause;
      });

      const started = startPlaygroundEntry({
        bootstrap: async () => 'boot',
        openWorkbench: async () => ({ status: 'opened', workbench: admitted }) as const,
        createTerminalPersistence: async () => {
          if (boundary === 'terminal') throw cause;
          return 'terminal';
        },
        mountApp,
        mountOccupied: vi.fn(),
      });

      await expect(started).rejects.toBe(cause);
      expect(admitted.close).toHaveBeenCalledTimes(1);
      if (boundary === 'terminal') expect(mountApp).not.toHaveBeenCalled();
    },
  );

  it('preserves both a handoff failure and a Workbench cleanup failure', async () => {
    const trigger = new Error('mount failed');
    const cleanup = new Error('Workbench close failed');
    const admitted = Object.freeze({
      close: vi.fn(async (): Promise<void> => {
        throw cleanup;
      }),
    });

    const failure = await startPlaygroundEntry({
      bootstrap: async () => 'boot',
      openWorkbench: async () => ({ status: 'opened', workbench: admitted }) as const,
      createTerminalPersistence: async () => 'terminal',
      mountApp: () => {
        throw trigger;
      },
      mountOccupied: vi.fn(),
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([trigger, cleanup]);
  });
});
