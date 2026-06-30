import { type Page, expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

// Echo-confirmed line entry (copied from node-command.spec.ts): a keystroke that
// lands during a snapshot-republish re-render is silently dropped, so type, wait
// for the `> <line>` echo, and retry — bounded so a one-shot `listen()` never
// double-runs into EADDRINUSE.
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

const API_SRC =
  'import http from "node:http"; http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify([{ id: 1, name: "ada" }])); }).listen(4101);';

// A run-to-completion CLIENT in its OWN supervised-child realm: http.get to the
// api's port, which lives in a DIFFERENT realm's registry — so it MUST cross
// realms via the preview broker (ADR-0180) to reach it.
const CLIENT_SRC =
  'import http from "node:http"; http.get("http://localhost:4101/users", (res) => { let b = ""; res.on("data", (c) => { b += c; }); res.on("end", () => { console.log("XREALM-GOT:" + b); process.exit(0); }); }).on("error", (e) => { console.log("XREALM-ERR:" + e.message); process.exit(1); });';

// A client to a port NO realm owns → Node-shaped ECONNREFUSED after the probe
// window (no host fetch leak, no hang).
const REFUSED_SRC =
  'import http from "node:http"; http.get("http://localhost:4199/x", () => { console.log("XREALM-UNEXPECTED"); process.exit(1); }).on("error", (e) => { console.log("XREALM-ERR:" + e.code); process.exit(0); });';

/**
 * Cross-realm `http.request`/`get` loopback end-to-end (ADR-0180), chromium/COI.
 *
 * Proves the REAL two-realm hop that the in-process unit/integration tests
 * cannot: an `http.get` issued from one supervised-child `node` realm reaches an
 * `http` server listening in a SEPARATE supervised-child realm, over the live
 * preview `BroadcastChannel` (the server side registers `serveCrossRealmPreview`
 * per `listen()`; the client side probes it). A port no realm owns refuses with
 * Node `ECONNREFUSED`. (SSE chunk-by-chunk delivery is proven over the real
 * BroadcastChannel transport in the net integration test.)
 */
test.describe('cross-realm http loopback between two node realms (ADR-0180)', () => {
  test('http.get reaches a server in a sibling realm; an unowned port refuses', async ({
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
    // Let the initial dev-server boot storm settle (a keystroke mid-mount is lost).
    await expect.poll(() => terminalBuffer(page), { timeout: 90_000 }).toMatch(/\$ vite/);

    // Free Terminal 1 (Ctrl-C the dev server) so it can host the api server.
    await page.locator('[data-testid="terminal"]').click();
    await page.keyboard.press('Control+c');

    // api server (realm A) — listens on 4101 in Terminal 1's supervised child.
    await runLineConfirmed(page, `echo '${API_SRC}' > /scratch/api.js`);
    await runLineConfirmed(page, 'node api.js');

    // The owner registered the api port → switcher gains :4101. This also proves
    // `serveCrossRealmPreview(4101)` is live (the server side of the hop).
    const switcher = page.locator('.rf-preview__switcher');
    await expect(switcher).toBeVisible({ timeout: 60_000 });
    await expect(switcher.locator('option', { hasText: ':4101' })).toHaveCount(1, {
      timeout: 30_000,
    });

    // client (realm B) — a SECOND supervised child. Its http.get to 4101 misses
    // realm B's registry → crosses to realm A via the broker.
    await openShellTerminal(page);
    await runLineConfirmed(page, `echo '${CLIENT_SRC}' > /scratch/client.js`);
    await runLineConfirmed(page, 'node client.js');

    // The api's JSON came back across the realm hop (body contains "ada").
    await expectTerminalContains(page, /XREALM-GOT:.*"name":"ada"/, 60_000);
    // It must NOT be the error branch.
    expect(await terminalBuffer(page)).not.toMatch(/XREALM-ERR/);

    // A port no realm owns → Node ECONNREFUSED (not a hang, not a host fetch leak).
    await runLineConfirmed(page, `echo '${REFUSED_SRC}' > /scratch/refused.js`);
    await runLineConfirmed(page, 'node refused.js');
    await expectTerminalContains(page, /XREALM-ERR:ECONNREFUSED/, 30_000);
  });
});
