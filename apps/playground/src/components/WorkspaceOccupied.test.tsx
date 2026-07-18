import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { WorkspaceOccupied } from './WorkspaceOccupied.tsx';

describe('WorkspaceOccupied', () => {
  it('renders a standalone directed alert with an explicit reload affordance', () => {
    const html = renderToString(() => WorkspaceOccupied({ onReload: () => {} }));

    expect(html).toContain('data-testid="workspace-occupied"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Workspace is open in another tab');
    expect(html).toContain('Continue editing there.');
    expect(html).toContain('If that tab is closed, reload this page.');
    expect(html).toContain('>Reload<');
  });
});
