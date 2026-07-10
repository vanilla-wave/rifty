/**
 * Vite 8 (Rolldown) through the MANUAL terminal path: `npm install vite@8` +
 * `npm run dev` on the foreground `.bin` executor (Path B,
 * `createOwnerChildBinExecutor`). Boot-or-loud contract (closed backlog item
 * `playground/vite8-cli-nested-worker-boot`): the dev server reaches ready
 * (LIVE pill / vite banner / preview) within the readiness window OR the
 * terminal carries a NAMED platform diagnostic — NEVER a silent timeout
 * (a buried same-realm console warning + hang is the exact failure this
 * lane forbids).
 *
 * HMR stays OFF on vite 8 (ADR-0161) — this lane asserts BOOT only; the v7
 * manual-install lane (`manual-vite-install.spec.ts`) owns the HMR contract.
 * The opt-in vite8 PRESET (co-resident child, Path A) is not evidence for
 * this path — see the backlog item's Decisions.
 */
import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

const enabled = process.env.RIFTY_E2E_MANUAL_VITE8 === '1';

/** Named diagnostics that satisfy the LOUD arm: the worker_threads same-realm
 *  fallback banner (worker_threads.ts) or a NotImplementedError ceiling. */
const LOUD_CEILING =
  /NotImplementedError|\[rifty:worker_threads\]|Falling back to same-realm|nested worker/iu;
/** Same readiness surface as `expectViteDevServerReady` (vite banner / URL). */
const READY = /VITE v\d+(?:\.\d+){0,2}\s+ready|localhost:5174/u;

test.describe('manual Vite 8 install path (boot-or-loud)', () => {
  test.skip(
    !enabled,
    'set RIFTY_E2E_MANUAL_VITE8=1 to run; installs Vite 8 through the browser terminal',
  );

  test('npm install vite@8 + npm run dev boots the Rolldown dev server or loud-ceilings', async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await bootProjectFiles(page);
    await expect.poll(() => terminalBuffer(page), { timeout: 10_000 }).toContain('$ vite');
    const pill = page.locator('.rf-livepill');
    await page.locator('[data-testid="terminal"]').click();
    await page.keyboard.press('Control+c');
    await expect(pill).not.toHaveAttribute('data-state', 'running', { timeout: 60_000 });

    await openShellTerminal(page);
    // Real user path: own package.json, unpinned-style dev script (the port flag
    // is the user's own — stock vite defaults to 5173), vite 8 pinned exactly so
    // the lane tests the Rolldown WASI tree deterministically.
    await runTerminalLine(
      page,
      'rm -rf node_modules package-lock.json package.json vite.config.* && printf \'{"name":"manual-vite8","private":true,"type":"module","scripts":{"dev":"vite --port 5174"},"dependencies":{}}\\n\' > package.json && npm install vite@8.0.16',
    );
    await expectTerminalContains(page, 'npm: installing vite', 30_000);
    await expectTerminalContains(page, /npm: installed \d+ package\(s\)/, 240_000);

    await runTerminalLine(page, 'npm run dev');

    // Boot-or-loud: poll BOTH arms; 'silent' past the window = the forbidden
    // outcome and fails with a named message.
    const pillLive = page.locator('.rf-livepill[data-state="running"]', {
      hasText: 'LIVE :5174',
    });
    const switcherOption = page.locator('.rf-preview__switcher option', { hasText: ':5174' });
    let outcome = 'silent';
    await expect
      .poll(
        async () => {
          const live =
            (await pillLive.isVisible().catch(() => false)) ||
            (await switcherOption.count().catch(() => 0)) > 0;
          const buffer = await terminalBuffer(page);
          if (live || READY.test(buffer)) {
            outcome = 'ready';
            return outcome;
          }
          const ceiling = buffer.match(LOUD_CEILING);
          if (ceiling) {
            outcome = `ceiling:${ceiling[0]}`;
            return outcome;
          }
          return 'silent';
        },
        {
          timeout: 120_000,
          message:
            'SILENT readiness timeout: neither LIVE :5174/vite-ready nor a named terminal diagnostic within the window — the exact failure vite8-cli-nested-worker-boot forbids',
        },
      )
      .not.toBe('silent');
    // Operator-visible verdict (ready is the expected green; a named ceiling is
    // the honest degraded outcome — keep the backlog item open in that case).
    console.log(`[manual-vite8] outcome: ${outcome}`);
    if (outcome === 'ready') {
      await expect(page.locator('iframe[title="Preview port 5174"]')).toBeVisible({
        timeout: 30_000,
      });
    }
  });
});
