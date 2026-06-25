import { type Page, expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from '../e2e/helpers/playground.ts';

/**
 * PROD-build regression for the dual-copy `Buffer` etag crash (express + sqlite
 * preset: `res.json` → `TypeError: argument entity must be string, Buffer, or
 * fs.Stats`). This is PROD-ONLY by nature, so it lives here — the dev e2e cannot
 * see it: under `pnpm dev` a child entry's `import()` shares the realm's single
 * served ESM module instance, so there is only one `@riftydev/io` `Buffer` class.
 *
 * In a PRODUCTION build every `?worker&url` child entry is self-contained → each
 * carries its OWN `Buffer` copy. The kernel pre-entry hook sets `globalThis.Buffer`
 * from the kernel-worker-entry bundle's copy; a child runs AFTER that with a
 * DIFFERENT copy. A package reading the GLOBAL `Buffer` (etag's `Buffer.isBuffer`)
 * then rejects a buffer the child's `import('node:buffer')` built → the throw.
 *
 * No network needed: this drives the SAME node-entry child realm + the SAME
 * mechanism via a `node <file>` script that asks the exact question etag asks —
 * does the GLOBAL Buffer recognise a buffer built from this realm's `node:buffer`?
 * The express/sqlite preset shares the identical root + fix (installBundleLocalBuffer),
 * but cannot install express offline in `pnpm preview` (no npm proxy).
 *
 * RED before the fix: `global-isBuffer=false`. GREEN after: `global-isBuffer=true`.
 * Requires cross-origin isolation (owner is SAB-IPC-gated) — chromium only.
 */

// Echo-confirm a typed line (a keystroke landing during a snapshot re-render is
// silently dropped). Copied from node-command.spec.ts — same hazard, same guard.
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

test.describe('production build — child-realm global Buffer matches its module loader', () => {
  test('a node script: globalThis.Buffer recognises a node:buffer-built buffer (etag check)', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    await page.goto('/');

    // Cross-origin isolation must be live on the prod headers (owner is SAB-gated).
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);

    // Let the initial dev-server boot storm settle before typing (mirror node-command).
    await expect.poll(() => terminalBuffer(page), { timeout: 120_000 }).toMatch(/\$ vite/);
    await openShellTerminal(page);

    // ESM (seeded workspace package.json is `type: module`): build a buffer from
    // THIS realm's `node:buffer` (what express's require('buffer') resolves to) and
    // ask the GLOBAL Buffer to recognise it — exactly etag's `Buffer.isBuffer(chunk)`.
    const src =
      'import { Buffer as B } from "node:buffer"; ' +
      'const chunk = B.from("hi", "utf8"); ' +
      'console.log("BUF-CHECK global-isBuffer=" + globalThis.Buffer.isBuffer(chunk) + " same=" + (globalThis.Buffer === B));';
    // ADR-0165 §4: the active workspace root is /scratch now (was the single
    // /workspace); `node buftest.js` runs relative to the cwd (/scratch).
    await runLineConfirmed(page, `echo '${src}' > /scratch/buftest.js`);
    await runLineConfirmed(page, 'node buftest.js');

    // GREEN: the realigned global recognises the realm's buffer. (RED before the
    // fix prints `global-isBuffer=false` — the dual-copy mismatch that crashed etag.)
    await expectTerminalContains(page, 'BUF-CHECK global-isBuffer=true same=true', 30_000);
  });
});
