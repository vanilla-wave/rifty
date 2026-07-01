import { type Page, expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
  waitForViteBootOrIdleShell,
} from './helpers/playground.ts';

// Echo-confirmed line entry (copied from cross-realm-http-loopback.spec.ts): a
// keystroke landing during a snapshot-republish re-render is silently dropped,
// so type, wait for the `> <line>` echo, and retry — bounded so a one-shot
// `listen()` never double-runs.
function echoRe(line: string): RegExp {
  return new RegExp(`> ${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}
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
      /* echo dropped in a re-render — retry */
    }
  }
  throw new Error(`command line never echoed after retries: ${line}`);
}

// Realm A: a long-lived http server on 4112 (stays alive — keeps the port).
const SERVER_A_SRC =
  'import http from "node:http"; http.createServer((req, res) => res.end("from-A")).listen(4112, () => console.log("A-LISTENING:4112"));';

// Realm B: a SECOND supervised child that tries to bind the SAME port. In real
// Node the second cross-process bind fails with EADDRINUSE; rifty must match
// (ADR-0186) instead of silently double-binding.
const SERVER_B_SRC =
  'import http from "node:http"; http.createServer((req, res) => res.end("from-B")).listen(4112).on("error", (e) => { console.log("B-ERR:" + e.code); process.exit(1); }).on("listening", () => { console.log("B-LISTENING-UNEXPECTED"); process.exit(0); });';

/**
 * Cross-realm `EADDRINUSE` at `listen()` end-to-end (ADR-0186), chromium/COI.
 *
 * Proves the REAL two-realm bind conflict the in-process tests cannot: an
 * `http` server in one supervised-child `node` realm holds :4112, and a SECOND
 * supervised-child realm's `listen(4112)` is REFUSED with Node-shaped
 * `EADDRINUSE` over the live bind-claim broadcast (per-port `BroadcastChannel`),
 * while the first realm keeps serving the port. (Tie-break, deny, and release
 * are proven over the real BroadcastChannel transport in the net unit tests;
 * this e2e covers the real supervised-child hop.)
 */
test.describe('cross-realm EADDRINUSE between two node realms (ADR-0186)', () => {
  test('a second realm listen() on a held port is refused with EADDRINUSE', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[console.error]', msg.text());
    });
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    // Cross-realm behavior only needs a stable shell. Default Vite autorun is
    // pinned elsewhere; CI retries can legitimately land on an already-idle
    // shell, so don't fail before the net contract starts.
    const initialTerminal = await waitForViteBootOrIdleShell(page);

    // Free Terminal 1 if the dev server is occupying it, so it can host server A.
    await page.locator('[data-testid="terminal"]').click();
    if (initialTerminal === 'vite-booted') await page.keyboard.press('Control+c');
    await expect.poll(() => terminalBuffer(page), { timeout: 10_000 }).toMatch(/>\s*$/u);

    // Realm A — binds 4112 in Terminal 1's supervised child and stays alive.
    await runLineConfirmed(page, `echo '${SERVER_A_SRC}' > /scratch/server-a.js`);
    await runLineConfirmed(page, 'node server-a.js');

    // A owns the port → the switcher gains :4112 (also proves A's claim won and it
    // is serving cross-realm — the survivor).
    const switcher = page.locator('.rf-preview__switcher');
    await expect(switcher).toBeVisible({ timeout: 60_000 });
    await expect(switcher.locator('option', { hasText: ':4112' })).toHaveCount(1, {
      timeout: 30_000,
    });

    // Realm B — a SECOND supervised child binding the SAME port. Its claim is
    // denied by A → Node-shaped EADDRINUSE, no 'listening'.
    await openShellTerminal(page);
    await runLineConfirmed(page, `echo '${SERVER_B_SRC}' > /scratch/server-b.js`);
    await runLineConfirmed(page, 'node server-b.js');

    // B printed the EADDRINUSE code (the '.on("error")' branch), NOT the
    // unexpected-listening branch — the conflict surfaced like real Node.
    await expectTerminalContains(page, /B-ERR:EADDRINUSE/, 60_000);

    // The survivor (A) still owns :4112 — its preview entry persists after B failed.
    await expect(switcher.locator('option', { hasText: ':4112' })).toHaveCount(1);
  });
});
