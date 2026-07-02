/**
 * React + Vite issue-tracker preset e2e (backlog: playground/react-vite-preset;
 * dev-boot chain per ADR-0192).
 *
 * Proves the ordinary-React-SPA chain end-to-end in a real cross-origin-isolated
 * browser: the instant preset restores its baked node_modules snapshot, the real
 * `vite` CLI child loads the template's OWN vite.config.ts (with
 * @vitejs/plugin-react) through the real esbuild-wasm bridge, the Vite 7 dep
 * optimizer pre-bundles CJS react/react-dom (parity: `.vite/deps/_metadata.json`
 * with `needsInterop: true`, react-refresh preamble in served components — same
 * as a local Node run of the identical template), the preview iframe renders
 * the dashboard from the mock dataset, client-side navigation works inside the
 * iframe, and a component edit through Monaco's real input path HMR-updates
 * the preview without a full reload (Fast Refresh via plugin-react — asserted
 * by a survive-sentinel).
 */
import { type Page, expect, test } from '@playwright/test';
import {
  capturePageProblems,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
} from './helpers/playground.ts';

const PORT = 5174;

async function fetchPreviewText(page: Page, port: number, path: string): Promise<string> {
  return page.evaluate(
    async ({ targetPort, targetPath }) => {
      const r = await fetch(`/preview/${targetPort}${targetPath}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`GET ${targetPath} -> ${r.status}`);
      return r.text();
    },
    { targetPort: port, targetPath: path },
  );
}

test.describe('React + Vite issue tracker preset', () => {
  test('boots LIVE, renders the dashboard, navigates to /issues, HMR-updates a component', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    const problems = capturePageProblems(page);

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20_000,
    });
    // The project-first chooser auto-opens ~1s after a cold boot — out-wait it
    // so pickStarter never races the opening animation.
    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 15_000 });
    await pickStarter(page, 'react-vite');

    // Instant preset: baked-snapshot restore, then the real `vite` CLI boots
    // with the template's vite.config.ts (@vitejs/plugin-react must load).
    await expectViteDevServerReady(page, PORT, 120_000);

    const frame = page.frameLocator(`iframe[title="Preview port ${PORT}"]`);

    // Dashboard content derived from the mock dataset (25 issues total).
    await expect(frame.locator('.stat-card--total .stat-card__value')).toHaveText('25', {
      timeout: 60_000,
    });
    await expect(frame.locator('.recent-list li').first()).toBeVisible();

    // Parity vs local Node vite 7 (ADR-0192): the transformed entry imports the
    // optimizer's ESM interop chunks — CJS react is served pre-bundled from
    // node_modules/.vite/deps, never raw.
    const mainSource = await fetchPreviewText(page, PORT, '/src/main.tsx');
    expect(mainSource).toMatch(/\.vite\/deps\/react/);
    // Parity: a served component module carries the plugin-react Fast-Refresh
    // preamble (user vite.config.ts + @vitejs/plugin-react really loaded).
    const appSource = await fetchPreviewText(page, PORT, '/src/App.tsx');
    expect(appSource).toContain('@react-refresh');

    // Client-side navigation inside the preview iframe (React Router).
    await frame.getByRole('link', { name: 'Issues' }).click();
    await expect(frame.locator('.issue-card')).toHaveCount(25, { timeout: 30_000 });

    // The status filter narrows the list (12 open issues in the dataset).
    await frame.locator('.filter-bar select').first().selectOption('open');
    await expect(frame.locator('.issue-card')).toHaveCount(12);

    // Card click → issue detail route.
    await frame.locator('.issue-card').first().click();
    await expect(frame.locator('.issue-detail')).toBeVisible({ timeout: 15_000 });

    // Sentinel on the iframe's window: a Fast-Refresh patch must NOT reload the
    // document, so the sentinel survives the edit below.
    await frame.locator('body').evaluate(() => {
      (globalThis as typeof globalThis & { __riftyHmrSentinel?: string }).__riftyHmrSentinel =
        'alive';
    });

    // Edit a component (src/App.tsx — the active editor tab) through Monaco's
    // real input path: prepend a line that keeps stamping a marker into the
    // always-visible brand element. HMR re-evaluates the module; the marker
    // appearing in the preview proves the patched module ran.
    const marker = `hmr-${Date.now()}`;
    const editor = page.locator('[data-testid="editor"]');
    const editorInput = editor.locator('textarea.inputarea').first();
    const editorLines = editor.locator('.view-lines').first();
    await editor
      .locator('.view-line')
      .first()
      .click({ position: { x: 0, y: 8 } });
    await editorInput.click({ force: true });
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.insertText(
      `setInterval(() => { const el = document.querySelector('.brand'); if (el) el.textContent = ${JSON.stringify(
        marker,
      )}; }, 50);\n`,
    );
    await expect(editorLines).toContainText(marker);

    await expect(frame.locator('.brand')).toHaveText(marker, { timeout: 30_000 });
    // No full reload: the pre-edit sentinel is still on the iframe's window.
    await expect
      .poll(() =>
        frame
          .locator('body')
          .evaluate(
            () =>
              (globalThis as typeof globalThis & { __riftyHmrSentinel?: string })
                .__riftyHmrSentinel,
          ),
      )
      .toBe('alive');

    // Parity: the dep optimizer COMPLETED on the guest tree — metadata file on
    // disk with the react entry marked for CJS interop, as on local Node.
    await openShellTerminal(page);
    await runTerminalLine(page, 'ls node_modules/.vite/deps');
    await expectTerminalContains(page, '_metadata.json', 20_000);
    await runTerminalLine(page, 'grep needsInterop node_modules/.vite/deps/_metadata.json');
    await expectTerminalContains(page, '"needsInterop": true', 20_000);

    problems.assertNoViteImportErrors();
  });
});
