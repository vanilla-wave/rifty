import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
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
 * This drives the REAL page path: a keystroke into the Monaco file editor
 * debounces through `writeWorkspaceFile(<activeRoot>/src/main.js)` → owner. A
 * second shell then `cat`s that exact path and must see the NEW marker.
 *
 * ADR-0165 §4: the editor file path is ROOT-RELATIVE — the edit must land at
 * `<activeRoot>/src/main.js` (`/scratch` on boot), the path the dev server runs,
 * NOT the legacy hardcoded `/workspace`.
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
    await page.goto('/');

    // Wait for the owner shell to be ready: terminal 1 echoes the boot dev line.
    // By now the owner seed has run, so the edit below is not clobbered by a
    // later seed write.
    await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toContain('$ vite');
    await expect
      .poll(() => terminalBuffer(page, 0), { timeout: 90_000 })
      .toContain('[vite] dev server ready on port 5174');

    // A second idle shell on the same persistent owner — the reader.
    await openShellTerminal(page);

    // Edit the entry file through Monaco's real input path (no test-only setter):
    // prepend a unique marker comment at line 1. The change fires the ordinary
    // file-tab owner write bridge → <activeRoot>/src/main.js in the owner syncMirror
    // (ADR-0165 §4: root-relative, /scratch on boot).
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
    expect(await terminalBuffer(page, 0)).not.toContain('module invalidation failed');

    // Exec reads the ROOT-RELATIVE entry path in the owner → the marker the
    // editor just wrote is visible. The boot root is /scratch (ADR-0165 §4), so a
    // `cat /workspace/...` would be a dead path — the edit lands at /scratch.
    // Poll (the write crosses the page→owner IPC asynchronously).
    await runTerminalLine(page, 'cat /scratch/src/main.js');
    await expectTerminalContains(page, marker, 15_000);
  });
});
