/**
 * React + Vite template production build parity (ADR-0192): `npm run build` of the
 * react template exits 0 inside rifty — the real esbuild-wasm bridge bundles
 * the user vite.config.ts (@vitejs/plugin-react), rollup-wasm builds, esbuild
 * minifies. Split from react-vite-preset.spec.ts so the dev-boot spec stays
 * inside its wall-clock budget; both run in the chromium-heavy lane.
 */
import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

const PORT = 5174;

test.describe('React + Vite template production build', () => {
  test('`npm run build` exits 0 and writes a hashed dist', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(300_000);

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 15_000 });
    await pickStarter(page, 'react-vite');
    await expectViteDevServerReady(page, PORT, 120_000);

    await openShellTerminal(page);
    // `&& echo` pins the REAL exit code — the marker only prints on exit 0.
    await runTerminalLineSettled(page, 'npm run build && echo RIFTY_REACT_BUILD_OK', 180_000);
    await expectTerminalContains(page, 'RIFTY_REACT_BUILD_OK', 20_000);
    expect(await terminalBuffer(page)).not.toContain('NotImplementedError');

    await runTerminalLine(page, 'cat dist/index.html');
    await expectTerminalContains(page, /assets\/index-[^"]+\.js/, 20_000);
  });
});
