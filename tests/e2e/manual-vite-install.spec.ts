/**
 * Manual ecosystem path: a user creates/owns package.json, runs
 * `npm install vite`, then starts the project through `npm run dev`.
 *
 * This is intentionally distinct from the built-in real-Vite preset. The
 * preset proves rifty can boot a prepared template; this spec proves the
 * terminal install/run path still reaches the same honest HMR transport.
 */
import { type Locator, expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

const enabled = process.env.RIFTY_E2E_MANUAL_VITE === '1';
const HMR_EVENT_KEY = '__rifty_e2e_manual_vite_hmr';

test.describe('manual Vite install path', () => {
  test.skip(
    !enabled,
    'set RIFTY_E2E_MANUAL_VITE=1 to run; installs Vite through the browser terminal',
  );

  test('npm install vite + npm run dev gets real HMR in the preview iframe', async ({ page }) => {
    test.setTimeout(180_000);
    await bootProjectFiles(page);

    await expect.poll(() => terminalBuffer(page), { timeout: 10_000 }).toContain('$ vite');
    await expectViteDevServerReady(page, 5174, 60_000);
    const pill = page.locator('.rf-livepill');
    await page.locator('[data-testid="terminal"]').click();
    await page.keyboard.press('Control+c');
    await expect(pill).not.toHaveAttribute('data-state', 'running', { timeout: 60_000 });

    await openShellTerminal(page);
    // Pin vite 7 — the rifty-supported default (esbuild + the proven native-HMR
    // bridge). Unpinned `npm install vite` drifts onto vite 8, whose Rolldown
    // WASI dev server keeps HMR OFF (ADR-0161), so this HMR-asserting lane must
    // pin v7. The foreground `.bin` child NOW forwards the recursive worker URLs
    // (buildChildSpawnSpec) so a vite 8 CLI can spawn Rolldown's WASI pool
    // instead of a silent same-realm hang; a v8 foreground boot-or-loud lane is
    // tracked in backlog playground/vite8-cli-nested-worker-boot. The dev script
    // pins `--port 5174` (a real user picks a port): stock `vite` defaults to
    // 5173, and the retired CLI wrapper no longer forces the port — the arg now
    // passes through the untouched `.bin/vite` exec, so the flag is what lands
    // the manual server on the port the preview iframe below asserts. Delete the
    // template's visible vite.config.* too: this lane is the real user path.
    await runTerminalLine(
      page,
      'rm -rf node_modules package-lock.json package.json vite.config.* && printf \'{"name":"manual-vite","private":true,"type":"module","scripts":{"dev":"vite --port 5174"},"dependencies":{}}\\n\' > package.json && npm install vite@^7.0.0',
    );
    await expectTerminalContains(page, 'npm: installing vite', 20_000);
    await expectTerminalContains(page, /npm: installed \d+ package\(s\)/, 120_000);

    await runTerminalLine(page, 'npm run dev');
    // Readiness = the LIVE pill / vite's own banner (expectViteDevServerReady);
    // no rifty-authored terminal marker exists anymore (generic dev lifecycle).
    await expectViteDevServerReady(page, 5174, 60_000);

    const previewFrame = page.frameLocator('iframe[title="Preview port 5174"]');
    const previewBody = previewFrame.locator('body');
    // ADR-0189: the generic preview-path injection (no vite wrapper plugin).
    await expect(previewFrame.locator('script[data-rifty-ws-bridge]')).toHaveCount(1, {
      timeout: 30_000,
    });

    await previewBody.evaluate((_, key) => {
      const marker = `manual-survive-${Date.now()}`;
      (
        globalThis as typeof globalThis & { __riftyManualViteSentinel?: string }
      ).__riftyManualViteSentinel = marker;
      localStorage.setItem(`${key}:sentinel`, marker);
      localStorage.removeItem(`${key}:beforeunload`);
      localStorage.setItem(`${key}:messages`, '[]');
      globalThis.addEventListener('beforeunload', () => {
        localStorage.setItem(`${key}:beforeunload`, '1');
      });
      globalThis.addEventListener('rifty:ws:message', (event: Event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        const messagesKey = `${key}:messages`;
        const messages = JSON.parse(localStorage.getItem(messagesKey) ?? '[]') as unknown[];
        messages.push(detail);
        localStorage.setItem(messagesKey, JSON.stringify(messages));
        localStorage.setItem(key, JSON.stringify(detail));
      });
    }, HMR_EVENT_KEY);
    await expect
      .poll(
        () =>
          previewFrame.locator('body').evaluate(() => {
            const global = globalThis as unknown as { __riftyWsBridgeOpen?: unknown };
            return global.__riftyWsBridgeOpen === true;
          }),
        { timeout: 10_000 },
      )
      .toBe(true);

    const marker = `manual-vite-hmr-${Date.now()}`;
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
      `setInterval(() => { document.getElementById('app').textContent = ${JSON.stringify(
        marker,
      )}; }, 50);\n`,
    );
    await expect(editorLines).toContainText(marker);

    await expect
      .poll(() => hasNativeUpdatePayload(previewBody, HMR_EVENT_KEY), { timeout: 30_000 })
      .toBe(true);
    await expect(previewFrame.locator('#app')).toHaveText(marker, { timeout: 30_000 });
    await expect
      .poll(
        () =>
          previewFrame.locator('body').evaluate(() => {
            const global = globalThis as typeof globalThis & {
              __riftyManualViteSentinel?: string;
            };
            return global.__riftyManualViteSentinel;
          }),
        { timeout: 10_000 },
      )
      .toBe(
        await previewBody.evaluate(
          (_, key) => localStorage.getItem(`${key}:sentinel`),
          HMR_EVENT_KEY,
        ),
      );
    await expect
      .poll(() =>
        previewBody.evaluate(
          (_, key) => localStorage.getItem(`${key}:beforeunload`),
          HMR_EVENT_KEY,
        ),
      )
      .toBeNull();
  });
});

interface HmrPayload {
  readonly type?: unknown;
  readonly updates?: readonly { readonly path?: unknown; readonly acceptedPath?: unknown }[];
}

async function readHmrMessages(previewBody: Locator, key: string): Promise<HmrPayload[]> {
  const raw = await previewBody.evaluate(
    (_, storageKey) => localStorage.getItem(`${storageKey}:messages`) ?? '[]',
    key,
  );
  return JSON.parse(raw) as HmrPayload[];
}

function isMainJsNativeUpdate(payload: HmrPayload): boolean {
  return (
    payload.type === 'update' &&
    Array.isArray(payload.updates) &&
    payload.updates.some(
      (update) => update.path === '/src/main.js' && update.acceptedPath === '/src/main.js',
    )
  );
}

async function hasNativeUpdatePayload(previewBody: Locator, key: string): Promise<boolean> {
  return (await readHmrMessages(previewBody, key)).some(isMainJsNativeUpdate);
}
