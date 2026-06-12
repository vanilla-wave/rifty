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
