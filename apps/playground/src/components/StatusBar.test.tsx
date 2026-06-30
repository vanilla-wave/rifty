import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { StatusBar } from './StatusBar.tsx';

describe('StatusBar storage badge', () => {
  it('shows granted persistent OPFS storage', () => {
    const html = renderToString(() =>
      StatusBar({
        mode: 'real-vite',
        modeLabel: 'Real Vite',
        activeFile: 'src/main.ts',
        language: 'typescript',
        isOpfs: true,
        storagePersisted: true,
        storageUsage: 10,
        storageQuota: 100,
        coi: true,
      }),
    );

    expect(html).toContain('OPFS · persisted');
    expect(html).toContain('data-tone="ok"');
    expect(html).toContain('10 / 100 bytes');
  });

  it('warns when OPFS persistence was not granted', () => {
    const html = renderToString(() =>
      StatusBar({
        mode: 'real-vite',
        modeLabel: 'Real Vite',
        activeFile: 'src/main.ts',
        language: 'typescript',
        isOpfs: true,
        storagePersisted: false,
        coi: true,
      }),
    );

    expect(html).toContain('OPFS · best effort');
    expect(html).toContain('data-tone="warn"');
  });

  it('warns when OPFS persistence status is unknown', () => {
    const html = renderToString(() =>
      StatusBar({
        mode: 'real-vite',
        modeLabel: 'Real Vite',
        activeFile: 'src/main.ts',
        language: 'typescript',
        isOpfs: true,
        storageReason: 'storage probe failed',
        coi: true,
      }),
    );

    expect(html).toContain('OPFS · unknown');
    expect(html).toContain('data-tone="warn"');
    expect(html).toContain('storage probe failed');
  });
});

describe('StatusBar project surface', () => {
  const base = {
    mode: 'real-vite' as const,
    modeLabel: 'Real Vite',
    activeFile: 'src/main.ts',
    language: 'typescript',
    isOpfs: true,
    storagePersisted: true,
    coi: true,
    activeName: 'React scratch',
    activeStarter: 'react',
  };
  it('shows the active project name + starter', () => {
    const html = renderToString(() => StatusBar({ ...base }));
    expect(html).toContain('React scratch');
    expect(html).toContain('react');
  });
  it('shows UNSAVED when dirty + persisted', () => {
    const html = renderToString(() => StatusBar({ ...base, dirty: true }));
    expect(html).toContain('UNSAVED');
    expect(html).not.toContain('EPHEMERAL');
  });
  it('shows EPHEMERAL when dirty + memory-degraded', () => {
    const html = renderToString(() => StatusBar({ ...base, dirty: true, isOpfs: false }));
    expect(html).toContain('EPHEMERAL');
  });
  it('hides the badge when clean', () => {
    expect(renderToString(() => StatusBar({ ...base, dirty: false }))).not.toContain('UNSAVED');
  });
  it('renders Export as a real button, not a dead "soon" teaser', () => {
    const html = renderToString(() =>
      StatusBar({ ...base, exportTitle: 'Download the editable workspace as a .json archive' }),
    );
    expect(html).toContain('Export');
    expect(html).not.toContain('soon');
    expect(html).toMatch(/<button[^>]*rf-status__export/);
    expect(html).toContain('Download the editable workspace');
    expect(html).not.toContain('disabled');
  });

  it('disables Export with an explanatory title when archiving is blocked', () => {
    const html = renderToString(() =>
      StatusBar({
        ...base,
        exportDisabled: true,
        exportTitle: 'Stop the dev server to archive the editable workspace',
      }),
    );
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('Stop the dev server to archive');
  });
});

describe('StatusBar degraded memory mode', () => {
  it('renders Memory · session only with warn tone and a memory data-hook', () => {
    const html = renderToString(() =>
      StatusBar({
        mode: 'real-vite',
        modeLabel: 'Real Vite',
        activeFile: 'src/main.ts',
        language: 'typescript',
        isOpfs: false,
        storageMode: 'memory',
        coi: true,
      }),
    );
    expect(html).toContain('Memory · session only');
    expect(html).toContain('data-tone="warn"');
    expect(html).toContain('data-storage-mode="memory"');
    expect(html).not.toContain('in-memory');
  });

  it('opfs mode keeps the persisted badge unchanged (regression guard)', () => {
    const html = renderToString(() =>
      StatusBar({
        mode: 'real-vite',
        modeLabel: 'Real Vite',
        activeFile: 'src/main.ts',
        language: 'typescript',
        isOpfs: true,
        storageMode: 'opfs',
        storagePersisted: true,
        coi: true,
      }),
    );
    expect(html).toContain('OPFS · persisted');
    expect(html).toContain('data-tone="ok"');
    expect(html).toContain('data-storage-mode="opfs"');
  });
});
