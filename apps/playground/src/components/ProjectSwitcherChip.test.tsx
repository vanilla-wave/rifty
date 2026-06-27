import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { ProjectSwitcherChip } from './ProjectSwitcherChip.tsx';

describe('ProjectSwitcherChip', () => {
  it('shows the starter-derived scratch name + dirty dot when the active scratch is dirty', () => {
    const html = renderToString(() =>
      ProjectSwitcherChip({
        name: 'React scratch',
        glyph: 'R',
        glyphColor: '#6FC9E8',
        dirty: true,
        onOpen: () => {},
      }),
    );
    expect(html).toContain('React scratch');
    expect(html).toContain('rf-chip__dot');
    expect(html).toContain('data-dirty="true"');
  });

  it('shows the project name and no dot when clean', () => {
    const html = renderToString(() =>
      ProjectSwitcherChip({
        name: 'node-api',
        glyph: 'N',
        glyphColor: '#9BD060',
        dirty: false,
        onOpen: () => {},
      }),
    );
    expect(html).toContain('node-api');
    expect(html).not.toContain('rf-chip__dot');
  });

  it('is a launcher trigger, NOT a second gallery (no view-templates/gallery selectors)', () => {
    const html = renderToString(() =>
      ProjectSwitcherChip({
        name: 'x',
        glyph: 'X',
        glyphColor: '#fff',
        dirty: false,
        onOpen: () => {},
      }),
    );
    expect(html).toContain('data-action="open-launcher"');
    expect(html).not.toContain('data-action="view-templates"');
    expect(html).not.toContain('data-testid="gallery"');
  });
});
