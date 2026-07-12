import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { ProjectsTab } from './ProjectsTab.tsx';

const baseProps = {
  projects: [{ id: 'p1', name: 'node-api', starter: 'node', editedAt: '4m ago' }],
  scratch: { starter: 'react', dirty: true, editedAt: 'edited just now' },
  activeId: 'scratch' as const,
  storage: 'opfs' as const,
  menuFor: null as string | null,
  glyphFor: () => ({ text: 'N', color: '#9BD060', label: 'Node API', port: 3000 }),
  onPick: () => {},
  onSwitch: () => {},
  onSave: () => {},
  onMenu: () => {},
  onMenuAction: () => {},
  onNewFromStarter: () => {},
  onResetSandbox: () => {},
};

describe('ProjectsTab', () => {
  it('shows the scratch banner with the dirty dot + Save-as-project when a scratch exists', () => {
    const html = renderToString(() => ProjectsTab(baseProps));
    expect(html).toContain('Node API scratch');
    expect(html).toContain('Save as project');
    expect(html).toContain('rf-pcard');
    expect(html).toContain('node-api');
  });

  it('renders the row menu with Export-archive DISABLED + a "soon" pill (M13)', () => {
    const html = renderToString(() => ProjectsTab({ ...baseProps, menuFor: 'p1' }));
    expect(html).toContain('Export archive');
    expect(html).toContain('soon');
    expect(html).toContain('data-disabled="true"');
    expect(html).toContain('rf-rowmenu rf-projects__rowmenu');
  });

  it('hides the scratch banner when there is no scratch', () => {
    const html = renderToString(() => ProjectsTab({ ...baseProps, scratch: null }));
    expect(html).not.toContain('Node API scratch');
  });

  it('offers a hard browser sandbox reset from the Projects list', () => {
    const html = renderToString(() => ProjectsTab(baseProps));
    expect(html).toContain('data-action="reset-browser-sandbox"');
    expect(html).toContain('Reset sandbox');
  });
});
