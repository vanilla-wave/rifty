import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import {
  SidebarRecoveryAffordance,
  createSidebarTogglePaletteItem,
} from './playground-sidebar-recovery.tsx';

describe('Playground collapsed-sidebar recovery', () => {
  it('keeps an always-visible expand affordance while the sidebar is collapsed', () => {
    const collapsed = renderToString(() =>
      SidebarRecoveryAffordance({ collapsed: true, onExpand: vi.fn() }),
    );
    const open = renderToString(() =>
      SidebarRecoveryAffordance({ collapsed: false, onExpand: vi.fn() }),
    );

    expect(collapsed).toMatch(/aria-label="Show files panel"/);
    expect(collapsed).toContain('rf-sidebar-recovery');
    expect(open).not.toContain('rf-sidebar-recovery');
  });

  it('also exposes the persisted collapsed state through the command palette', () => {
    let collapsed = true;
    const toggleSidebar = vi.fn(() => {
      collapsed = !collapsed;
    });
    const item = createSidebarTogglePaletteItem({
      sidebarCollapsed: () => collapsed,
      toggleSidebar,
    });

    expect(item.id).toBe('act:toggle-sidebar');
    expect(item.label).toBe('Show files panel');
    item.run();
    expect(toggleSidebar).toHaveBeenCalledOnce();
    expect(collapsed).toBe(false);
    expect(
      createSidebarTogglePaletteItem({ sidebarCollapsed: () => collapsed, toggleSidebar }).label,
    ).toBe('Hide files panel');
  });
});
