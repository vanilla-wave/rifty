import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

// Drives successive reconciliations through the PreviewPanel component effect
// under the client Solid runtime (the vitest lane runs the server runtime —
// effects no-op). The owner registry publishes snapshots in FIXED order
// [dev-server, preview, node]: a dev server started AFTER a node server is
// inserted FIRST, and the panel must still switch to it on first appearance —
// unless the user hand-picked a port in the switcher.

interface HarnessEntry {
  readonly port: number;
  readonly url: string;
  readonly label: string;
  readonly source: 'dev-server' | 'preview' | 'node';
}

const DEV: HarnessEntry = {
  port: 5174,
  url: '/preview/5174/',
  label: 'npm run dev',
  source: 'dev-server',
};
const PREVIEW: HarnessEntry = {
  port: 4173,
  url: '/preview/4173/',
  label: 'vite preview',
  source: 'preview',
};
const NODE: HarnessEntry = {
  port: 3000,
  url: '/preview/3000/',
  label: 'node :3000',
  source: 'node',
};

function publish(page: import('@playwright/test').Page, entries: readonly HarnessEntry[]) {
  return page.evaluate(async (list) => {
    const { publishPreviewPanelPorts } = await import(
      '/src/browser-unit/preview-panel-selection-harness.tsx'
    );
    publishPreviewPanelPorts(list);
  }, entries);
}

test.describe('PreviewPanel selection reconcile (component effect)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHarness(page);
    await page.evaluate(async () => {
      const { mountPreviewPanelSelectionHarness } = await import(
        '/src/browser-unit/preview-panel-selection-harness.tsx'
      );
      const root = document.createElement('div');
      root.id = 'preview-panel-test-root';
      document.body.append(root);
      mountPreviewPanelSelectionHarness(root);
    });
  });

  test('switches to a dev server published after (but inserted before) the node server', async ({
    page,
  }) => {
    const switcher = page.locator('.rf-preview__switcher');

    await publish(page, [NODE]);
    await expect(switcher).toHaveValue('3000');

    await publish(page, [DEV, NODE]);
    await expect(switcher).toHaveValue('5174');
  });

  test('a hand-picked port survives later server publications', async ({ page }) => {
    const switcher = page.locator('.rf-preview__switcher');

    await publish(page, [NODE]);
    await publish(page, [DEV, NODE]);
    await expect(switcher).toHaveValue('5174');

    // The user picks :3000 in the switcher (real change event on the <select>).
    await switcher.selectOption('3000');
    await expect(switcher).toHaveValue('3000');

    // A third server (:4173) appears — new-port auto-select must NOT displace it.
    await publish(page, [DEV, PREVIEW, NODE]);
    await expect(switcher).toHaveValue('3000');
  });
});
