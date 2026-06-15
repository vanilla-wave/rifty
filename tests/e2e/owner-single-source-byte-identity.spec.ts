import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
  viteDevReadyPattern,
} from './helpers/playground.ts';

/**
 * The same file reads identical from the PAGE viewer and from inside exec — one
 * source of truth, the three-store collapse is real (workspace-owner acceptance:
 * single-source consistency).
 *
 * A shell command writes a unique-marker file in the owner. It is then read two
 * ways and must match:
 *   - exec side: `cat <file>` runs in the owner → reads the owner store.
 *   - page-viewer side: the owner republishes its tree to the page; clicking the
 *     explorer row opens the file in the editor, which reads the page-local
 *     `SnapshotFs` (the page's read-through view). Its rendered bytes are the
 *     page viewer's read.
 * Identical marker on both sides = no divergence between the realms.
 *
 * Scope (deliberate): in-cap files. The page snapshot carries file content only
 * up to a 128 KB cap (and excludes node_modules); over-cap files carry no
 * content and the viewer reports an honest "too large to preview" instead of
 * wrong bytes — already unit-asserted (`glue/snapshot-fs.test.ts`). So the
 * viewer never shows DIFFERENT bytes; it shows identical bytes (here) or honest
 * absence. Byte-identity is the in-cap claim; honest-absence covers the rest.
 *
 * Requires cross-origin isolation (owner is SAB-IPC-gated); the harness serves
 * COOP/COEP. Chromium-only, matching the other owner specs.
 */
test.describe('single source of truth: page viewer and exec read identical bytes', () => {
  test('a shell-written file reads identical from the editor view and from cat', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(60_000);
    await page.goto('/');

    // The explorer renders the owner snapshot from boot — wait for the shell to be
    // ready (the boot sequence echoed the dev line).
    await expect
      .poll(() => terminalBuffer(page), { timeout: 30_000 })
      .toMatch(viteDevReadyPattern());

    await openShellTerminal(page);

    // Write a unique, small (in-cap) marker file in the owner via the shell.
    const marker = `single-source-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const file = `byteid-${Date.now().toString(36)}.txt`;
    await runTerminalLine(page, `echo ${marker} > /scratch/${file}`);

    // EXEC-side read: `cat` runs in the owner and prints the owner-store bytes.
    await runTerminalLine(page, `cat /scratch/${file}`);
    await expectTerminalContains(page, marker, 15_000);

    // PAGE-VIEWER side: the owner republished its snapshot on command exit, so the
    // file shows in the explorer. Open it → the editor renders the SnapshotFs bytes.
    const row = page.getByRole('treeitem', { name: new RegExp(file.replace('.', '\\.')) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // The opened tab's editor surface shows the SAME unique marker the cat printed
    // → page viewer and exec agree byte-for-byte on this file.
    const editorLines = page.locator('[data-testid="editor"] .view-lines').first();
    await expect(editorLines).toContainText(marker, { timeout: 15_000 });
  });
});
