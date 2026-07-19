import { renderToString } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { EditorTabs } from './EditorTabs.tsx';

describe('EditorTabs', () => {
  it('renders the preview tab opener beside open editor tabs', () => {
    const onOpenPreviewTab = vi.fn();
    const html = renderToString(() =>
      EditorTabs({
        tabs: [
          {
            id: '/workspace/src/main.js',
            kind: 'file',
            title: 'src/main.js',
            path: '/workspace/src/main.js',
            dirty: false,
          },
        ],
        activeId: '/workspace/src/main.js',
        onSelect: () => {},
        onClose: () => {},
        previewUrl: '/preview/3000/',
        onOpenPreviewTab,
      }),
    );

    expect(html).toContain('aria-label="Open preview in new tab"');
    expect(html).toContain('Preview');
  });

  it('renders an initially-open entry file with normal close and dirty affordances', () => {
    const html = renderToString(() =>
      EditorTabs({
        tabs: [
          {
            id: '/workspace/src/main.js',
            kind: 'file',
            title: 'src/main.js',
            path: '/workspace/src/main.js',
            dirty: true,
          },
        ],
        activeId: '/workspace/src/main.js',
        onSelect: () => {},
        onClose: () => {},
      }),
    );

    expect(html).toContain('data-dirty="true"');
    expect(html).toContain('aria-label="Close src/main.js"');
  });

  it('marks editable tabs whose owner persistence is at risk without relabelling their bytes dirty', () => {
    const html = renderToString(() =>
      EditorTabs({
        tabs: [
          {
            id: '/workspace/src/main.js',
            kind: 'file',
            title: 'src/main.js',
            path: '/workspace/src/main.js',
            dirty: false,
          },
          {
            id: 'diff:HEAD:/workspace/src/main.js',
            kind: 'diff',
            title: 'main.js ↔ HEAD',
            path: '/workspace/src/main.js',
            originalTitle: 'HEAD',
            modifiedTitle: 'main.js',
            dirty: false,
          },
        ],
        activeId: '/workspace/src/main.js',
        onSelect: () => {},
        onClose: () => {},
        persistenceAtRisk: true,
      }),
    );

    expect(html).toContain('data-persistence-risk="true"');
    expect(html).toContain('aria-label="Workspace persistence at risk"');
    expect(html).toContain('data-dirty="false"');
    expect(html.match(/aria-label="Workspace persistence at risk"/g)).toHaveLength(1);
  });

  it('renders diff tabs as closable open editors', () => {
    const html = renderToString(() =>
      EditorTabs({
        tabs: [
          {
            id: '/workspace/src/main.js',
            kind: 'file',
            title: 'src/main.js',
            path: '/workspace/src/main.js',
            dirty: false,
          },
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
