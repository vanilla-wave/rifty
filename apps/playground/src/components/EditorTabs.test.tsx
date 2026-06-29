import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { PROGRAM_TAB_ID } from '../glue/editor-tabs.ts';
import { EditorTabs } from './EditorTabs.tsx';

describe('EditorTabs', () => {
  it('renders the preview tab opener beside open editor tabs', () => {
    const onOpenPreviewTab = vi.fn();
    const html = renderToString(() =>
      EditorTabs({
        tabs: [{ id: PROGRAM_TAB_ID, kind: 'program', title: 'src/main.js', dirty: false }],
        activeId: PROGRAM_TAB_ID,
        onSelect: () => {},
        onClose: () => {},
        previewUrl: '/preview/3000/',
        onOpenPreviewTab,
      }),
    );

    expect(html).toContain('aria-label="Open preview in new tab"');
    expect(html).toContain('Preview');
  });

  it('renders the program mirror tab with normal close and dirty affordances', () => {
    const html = renderToString(() =>
      EditorTabs({
        tabs: [{ id: PROGRAM_TAB_ID, kind: 'program', title: 'src/main.js', dirty: true }],
        activeId: PROGRAM_TAB_ID,
        onSelect: () => {},
        onClose: () => {},
      }),
    );

    expect(html).toContain('data-dirty="true"');
    expect(html).toContain('aria-label="Close src/main.js"');
  });

  it('renders diff tabs as closable open editors', () => {
    const html = renderToString(() =>
      EditorTabs({
        tabs: [
          { id: PROGRAM_TAB_ID, kind: 'program', title: 'src/main.js', dirty: false },
          {
            id: 'diff:HEAD:/workspace/src/main.ts',
            kind: 'diff',
            title: 'main.ts ↔ HEAD',
            path: '/workspace/src/main.ts',
            originalTitle: 'HEAD',
            modifiedTitle: 'main.ts',
            dirty: false,
          },
        ],
        activeId: 'diff:HEAD:/workspace/src/main.ts',
        onSelect: () => {},
        onClose: () => {},
      }),
    );

    expect(html).toContain('data-tab="diff"');
    expect(html).toContain('main.ts ↔ HEAD');
    expect(html).toContain('aria-label="Close main.ts ↔ HEAD"');
  });
});
