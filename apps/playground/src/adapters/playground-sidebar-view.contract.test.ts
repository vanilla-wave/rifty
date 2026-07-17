import { describe, expect, it, vi } from 'vitest';
import { selectPlaygroundSidebarView } from './playground-sidebar-view.ts';

describe('Playground sidebar view coordination', () => {
  it('flushes pending editor bytes before refreshing and revealing GIT', async () => {
    const events: string[] = [];

    await selectPlaygroundSidebarView('scm', {
      currentView: () => 'explorer',
      sidebarCollapsed: () => false,
      flushPendingWrites: async () => {
        events.push('flush');
      },
      refreshScm: async () => {
        events.push('refresh');
      },
      selectView: (view) => events.push(`select:${view}`),
    });

    expect(events).toEqual(['flush', 'refresh', 'select:scm']);
  });

  it('does not refresh when toggling an already-visible GIT view or selecting Files', async () => {
    const flushPendingWrites = vi.fn(async () => {});
    const refreshScm = vi.fn(async () => {});
    const selected: string[] = [];
    const options = {
      currentView: () => 'scm' as const,
      sidebarCollapsed: () => false,
      flushPendingWrites,
      refreshScm,
      selectView: (view: 'explorer' | 'scm') => selected.push(view),
    };

    await selectPlaygroundSidebarView('scm', options);
    await selectPlaygroundSidebarView('explorer', options);

    expect(flushPendingWrites).not.toHaveBeenCalled();
    expect(refreshScm).not.toHaveBeenCalled();
    expect(selected).toEqual(['scm', 'explorer']);
  });
});
