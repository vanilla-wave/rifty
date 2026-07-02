import { type Page, expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

function echoRe(line: string): RegExp {
  return new RegExp(`> ${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** Type a line and confirm it echoed (mirror node-command.spec.ts — a keystroke
 * landing in a snapshot re-render is silently dropped). */
async function runLineConfirmed(page: Page, line: string): Promise<void> {
  const re = echoRe(line);
  const echoed = async (): Promise<boolean> => re.test(await terminalBuffer(page));
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await echoed()) return;
    await runTerminalLine(page, line);
    try {
      await expect.poll(echoed, { timeout: 6_000, intervals: [300, 600, 1_000] }).toBe(true);
      return;
    } catch {
      // echo dropped in a re-render — retry
    }
  }
  throw new Error(`command line never echoed after retries: ${line}`);
}

/**
 * THE preset-deglue gate:
 * a fork that swaps vite for a NON-vite dev server — package.json `dev` script
 * running a bare `node:http` server — gets the same sandbox lifecycle:
 *
 *  1. `npm run dev` (the user's OWN script, no vite anywhere) → the LIVE pill
 *     reaches data-state=running with the fork's port, and `/preview/<port>/`
 *     serves — driven by the net registry's listen events, not a bin-name check
 *     or a rifty-authored `[vite] … ready` terminal marker.
 *  2. `server.close()` (no process exit, the session is still held) → the child
 *     reposts an empty port set → the pill LEAVES running.
 *
 * Chromium/COI only (workspace owner is SAB-gated), like the sibling specs.
 */
test.describe('generic dev-server lifecycle — non-vite fork', () => {
  test('npm run dev on a non-vite server lights LIVE + preview; server.close() drops LIVE', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    await bootProjectFiles(page);

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });

    // Let the preset's vite boot settle, then stop it — the fork replaces it.
    await expectViteDevServerReady(page, 5174, 90_000);
    await page.locator('[data-testid="terminal"]').click();
    await page.keyboard.press('Control+c');
    const pill = page.locator('.rf-livepill');
    await expect(pill).not.toHaveAttribute('data-state', 'running', { timeout: 60_000 });

    // Fork: a bare node:http dev server + a package.json whose dev script runs
    // it. `/close` makes the server close() itself — a port drop WITHOUT a
    // process exit (the decisive half of the generic-lifecycle contract).
    await openShellTerminal(page);
    await runLineConfirmed(
      page,
      'echo \'import http from "node:http"; const s = http.createServer((req, res) => { if (req.url === "/close") { res.end("CLOSING"); s.close(); } else { res.end("FORK-OK"); } }); s.listen(4100);\' > /scratch/server.mjs',
    );
    await runLineConfirmed(
      page,
      'echo \'{"name":"fork","type":"module","scripts":{"dev":"node server.mjs"}}\' > /scratch/package.json',
    );
    await runLineConfirmed(page, 'npm run dev');

    // 1. LIVE pill reaches running with the FORK's port — no vite involved.
    await expect(page.locator('.rf-livepill[data-state="running"]')).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator('.rf-livepill')).toContainText(':4100', { timeout: 30_000 });

    // …and the preview route serves the fork's response.
    const fetchPreview = async (path: string): Promise<string> =>
      page.evaluate(async (p: string) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4_000);
        try {
          const r = await fetch(p, { cache: 'no-store', signal: ac.signal });
          return await r.text();
        } catch (err) {
          return String((err as Error).message ?? err);
        } finally {
          clearTimeout(timer);
        }
      }, path);
    await expect
      .poll(() => fetchPreview('/preview/4100/'), {
        timeout: 90_000,
        intervals: [1_000, 2_000, 4_000],
      })
      .toContain('FORK-OK');

    // 2. server.close() — port unregisters, NO process exit, session still held.
    // The response body can be LOST by design: close() tears the preview bridge
    // concurrently with the reply, so assert the CONTRACT (pill leaves running),
    // re-firing /close each poll round (idempotent once closed → fetch errors
    // are swallowed).
    await expect
      .poll(
        async () => {
          await fetchPreview('/preview/4100/close').catch(() => {});
          return page.locator('.rf-livepill').getAttribute('data-state');
        },
        { timeout: 60_000, intervals: [1_000, 2_000] },
      )
      .not.toBe('running');

    // The dev script's session is STILL foreground (close ≠ exit): Ctrl-C frees
    // it and a fresh command runs — proving the pill drop came from the port
    // event, not a child death.
    await page.locator('[data-testid="terminal"]').click();
    await page.keyboard.press('Control+c');
    await runLineConfirmed(page, 'echo freed');
    await expectTerminalContains(page, 'freed', 15_000);
  });
});
