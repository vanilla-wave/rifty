import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../presets.ts';
import { Launcher } from './Launcher.tsx';

// Cross-Phase Reconciliation A: the canonical StartersTab renders straight from
// `Preset[]` (gallery-display fields live on Preset), so the Launcher carries
// `presets` (not a deep-copied `Starter[]`) and feeds the tab directly. The
// task's draft `toStarter`/`./glue/starters.ts` are folded — `starter.ts` is the
// canonical module and the gallery never needs a display Starter.
const base = {
  open: true,
  tab: 'projects' as const,
  presets: PRESETS,
  projects: [{ id: 'p1', name: 'node-api', starter: 'node', editedAt: '4m ago' }],
  scratch: { starter: 'react', dirty: true, editedAt: 'edited just now' },
  activeId: 'scratch' as const,
  ownerBlocked: false,
  storage: 'opfs' as const,
  menuFor: null,
  q: '',
  cat: 'all' as const,
  glyphFor: () => ({ text: 'N', color: '#9BD060', label: 'Node API', port: 3000 }),
  onTab: () => {},
  onClose: () => {},
  onSearch: () => {},
  onCat: () => {},
  onPickStarter: () => {},
  onSwitch: () => {},
  onSave: () => {},
  onMenu: () => {},
  onMenuAction: () => {},
  onResetSandbox: () => {},
};

describe('Launcher', () => {
  it('renders inside [data-testid=launcher] with both tabs', () => {
    const html = renderToString(() => Launcher(base));
    expect(html).toContain('data-testid="launcher"');
    expect(html).toContain('Starters');
    expect(html).toContain('Projects');
  });
  it('shows the Projects count pill = projects + scratch', () => {
    const html = renderToString(() => Launcher(base));
    expect(html).toContain('rf-launcher__count');
    expect(html).toContain('>2<'); // 1 project + 1 scratch
  });
  it('renders nothing when closed', () => {
    expect(renderToString(() => Launcher({ ...base, open: false }))).not.toContain(
      'data-testid="launcher"',
    );
  });
  it('passes the project-owner admission state into both launcher tabs', () => {
    const projects = renderToString(() => Launcher({ ...base, ownerBlocked: true }));
    expect(projects).toContain('data-switch-disabled="true"');

    const starters = renderToString(() =>
      Launcher({ ...base, tab: 'starters', ownerBlocked: true }),
    );
    expect(starters).toMatch(/data-preset="real-vite"[^>]*disabled/);
  });
});
