/**
 * "Real npm project" tile — React + Vite issue tracker (backlog:
 * playground/react-vite-starter).
 *
 * Proves the ordinary-React-SPA chain end-to-end in a real cross-origin-isolated
 * browser: the from-scratch tile visibly `npm install`s React 19 + Router 7 +
 * `@vitejs/plugin-react`, the real `vite` CLI child loads the template's OWN
 * `vite.config.ts` through the registry esbuild runtime (ADR-0226/0316), the
 * Vite 7 dep optimizer pre-bundles CJS react/react-dom (`_metadata.json` with
 * `needsInterop: true`), a served component carries the react-refresh preamble,
 * the preview iframe renders the dashboard from the mock dataset, client-side
 * navigation works inside the iframe, and a component edit through Monaco's
 * real input path HMR-updates the preview without a full reload (Fast Refresh
 * via plugin-react — asserted by a survive-sentinel).
 */
import { type Page, expect, test } from '@playwright/test';
import {
  capturePageProblems,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  pickStarter,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

const PORT = 5174;

/**
 * Prints one `DEP <name> interop=<bool>` line per optimizer entry. The
 * assertions read the OUTPUT lines: the echoed command carries the expression,
 * never a concatenated result, so an echo can never satisfy them.
 */
const DEP_METADATA_LINE =
  "node -e \"const m=JSON.parse(require('node:fs').readFileSync('node_modules/.vite/deps/_metadata.json','utf8'));for(const [k,v] of Object.entries(m.optimized)) console.log('DEP '+k+' interop='+v.needsInterop)\"";

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

test.describe('Real npm project (React + Vite issue tracker)', () => {
  test('installs, boots LIVE, renders the dashboard, navigates, HMR-updates a component', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(300_000);
    const problems = capturePageProblems(page);

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20_000,
    });
    // The project-first chooser auto-opens ~1s after a cold boot — out-wait it
    // so pickStarter never races the opening animation.
    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 15_000 });
    await pickStarter(page, 'real-vite');

    // from-scratch: the install really runs — asserted on the installer's OWN
    // per-package lines (`npm: + <name>@<version>`), never on the echoed
    // command. Every declared direct dependency shows up resolved.
    await expectTerminalContains(page, /npm: \+ react@\d+\./u, 120_000);
    for (const dep of ['react-dom', 'react-router-dom', 'vite', '@vitejs/plugin-react']) {
      await expectTerminalContains(page, new RegExp(`npm: \\+ ${dep}@\\d+\\.`, 'u'), 60_000);
    }
    await expectViteDevServerReady(page, PORT, 180_000);

    const frame = page.frameLocator(`iframe[title="Preview port ${PORT}"]`);

    // Dashboard content derived from the mock dataset (25 issues total).
    await expect(frame.locator('.stat-card--total .stat-card__value')).toHaveText('25', {
      timeout: 60_000,
    });
    await expect(frame.locator('.recent-list li').first()).toBeVisible();

    // Parity vs local Node vite 7: the transformed entry imports the
    // optimizer's ESM interop chunks — CJS react is served pre-bundled from
    // node_modules/.vite/deps, never raw.
    const mainSource = await fetchPreviewText(page, PORT, '/src/main.tsx');
    expect(mainSource).toMatch(/\.vite\/deps\/react\.js/u);
    // Parity (oracle-checked shape): plugin-react wraps modules that DECLARE
    // components — the served component module carries the Fast-Refresh
    // registration wrapper; the create-vite entry (declares none) does not.
    const appSource = await fetchPreviewText(page, PORT, '/src/App.tsx');
    expect(appSource).toContain('/@react-refresh');
    expect(appSource).toContain('$RefreshReg$');
    expect(appSource).toContain('import.meta.hot');
    expect(mainSource).not.toContain('$RefreshReg$');
    // Parity: the entry-level preamble lives in the served HTML, injected by
    // plugin-react — proof the user vite.config.ts really loaded the plugin.
    const indexHtml = await fetchPreviewText(page, PORT, '/');
    expect(indexHtml).toContain('injectIntoGlobalHook');
    expect(indexHtml).toContain('/@react-refresh');

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

    // Edit the leaf component the user scenario names (src/components/
    // StatusBadge.tsx — a seeded editor tab) through Monaco's real input path:
    // prepend a line that keeps stamping a marker into the always-visible brand
    // element. Fast Refresh re-evaluates the module; the marker appearing in the
    // preview proves the patched module ran.
    const badgeTab = page
      .locator('[role="tablist"][aria-label="Open editors"] [role="tab"]')
      .filter({ hasText: /^StatusBadge\.tsx/u });
    await badgeTab.click();
    await expect(badgeTab).toHaveAttribute('aria-selected', 'true');
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

    // Parity: the dep optimizer COMPLETED on the guest tree — metadata on disk,
    // with the SAME entries marked for CJS interop as a local Node 24 run of
    // the identical tree (oracle recorded in the item's `## Decisions`).
    await openShellTerminal(page);
    await runTerminalLineSettled(page, DEP_METADATA_LINE, 30_000);
    const depLines = await terminalBuffer(page);
    for (const entry of ['react', 'react-dom', 'react-dom/client']) {
      expect(depLines, `${entry} must be pre-bundled with CJS interop`).toContain(
        `DEP ${entry} interop=true`,
      );
    }
    // react-router-dom is optimized too (ESM — no interop wrapper).
    expect(depLines).toContain('DEP react-router-dom interop=');

    problems.assertNoViteImportErrors();
  });
});
