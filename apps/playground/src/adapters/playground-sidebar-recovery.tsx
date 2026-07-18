import { Show } from 'solid-js';
import type { PaletteItem } from '../components/CommandPalette.tsx';
import { Icon } from '../components/icons.tsx';

export interface SidebarToggleAuthority {
  readonly sidebarCollapsed: () => boolean;
  readonly toggleSidebar: () => void;
}

/** One recovery action shared by the persistent affordance and command palette. */
export function createSidebarTogglePaletteItem(layout: SidebarToggleAuthority): PaletteItem {
  return {
    id: 'act:toggle-sidebar',
    section: 'Commands',
    label: layout.sidebarCollapsed() ? 'Show files panel' : 'Hide files panel',
    icon: 'folder',
    run: layout.toggleSidebar,
  };
}

export function SidebarRecoveryAffordance(props: {
  readonly collapsed: boolean;
  readonly onExpand: () => void;
}) {
  return (
    <Show when={props.collapsed}>
      <button
        type="button"
        class="rf-sidebar-recovery"
        aria-label="Show files panel"
        title="Show files panel"
        onClick={props.onExpand}
      >
        <Icon name="folder-open" size={14} />
        Files
      </button>
    </Show>
  );
}
