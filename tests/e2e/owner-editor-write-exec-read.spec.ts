import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

/**
 * A page editor write reaches the store that exec reads — no stale page store
 * shadows the owner (workspace-owner acceptance: write → exec-reads-it).
 *
 * The historical break: the editor + its store lived in the PAGE realm while a
 * command read a DIFFERENT realm's store, so an editor edit was invisible to
 * exec. Under the single-store-owner model the editor write travels over the
 * vfs-write bridge into the OWNER `syncMirror` — the same tree the shell reads.
 *
 * This drives the REAL page path: a keystroke into the Monaco file editor writes
 * `/src/main.js` in the active project's logical namespace. A second shell then
 * `cat`s the same relative path and must see the NEW marker.
 *
 * ADR-0165 §4: page and shell share the logical project root `/`; neither surface
 * exposes or hardcodes the backing storage root.
 *
 * Load-bearing: the marker is unique per run, so `cat` returning it cannot be a
 * stale-tree coincidence — it proves the page-originated write landed in the
 * owner store the command reads from. No dev server / npm install needed: the
 * editor and the owner shell are both live from boot.
 *
 * Requires cross-origin isolation (the owner is SAB-IPC-gated; no PAGE shell
 * fallback) — the e2e harness serves COOP/COEP. Chromium-only, matching the
 * other owner specs.
 */
test.describe('a page editor write is read back by exec in the owner', () => {
  test('Monaco edit → cat reads the NEW bytes from the owner store', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(60_000);
    await bootProjectFiles(page);

    // Capture the auto-started session by identity, then wait for its real Vite
    // endpoint. The editor write below cannot be clobbered by a later seed.
    const bootSlot = page.locator('.rf-terminal-slot[data-active="true"]');
    await expect(bootSlot).toBeVisible({ timeout: 30_000 });
    const bootSessionId = await bootSlot.getAttribute('data-session-id');
    if (bootSessionId === null) throw new Error('Boot terminal has no session id');
    const bootSession = Object.freeze({ sessionId: bootSessionId });
    await expectViteDevServerReady(page, 5174, 90_000, bootSession);

    // A second idle shell on the same persistent owner — the reader.
    await openShellTerminal(page);

    // Edit the entry file through Monaco's real input path (no test-only setter):
    // prepend a unique marker comment at line 1. The change fires the ordinary
    // file-tab owner write bridge → `/src/main.js` in the active project.
    const marker = `editor-write-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
    await page.keyboard.insertText(`// ${marker}\n`);
    // The edit is in the editor model (sanity: the write actually originated here).
    await expect(editorLines).toContainText(marker);
    await page.waitForTimeout(1_000);
    expect(await terminalBuffer(page, bootSession)).not.toContain('module invalidation failed');

    // Exec reads the same relative entry path. Poll because the write crosses
    // page→owner IPC asynchronously.
    await runTerminalLine(page, 'cat src/main.js');
    await expectTerminalContains(page, marker, 15_000);
  });
});
