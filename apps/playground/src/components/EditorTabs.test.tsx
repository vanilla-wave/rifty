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
});
