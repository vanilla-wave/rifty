import { type Page, expect, test } from '@playwright/test';
import { openShellTerminal, runTerminalLine, terminalBuffer } from './helpers/playground.ts';

/**
 * The rifty worker-resident TS language service surfaces REAL semantic
 * diagnostics in the playground (ADR-0166 P1.9) — squiggles in Monaco + rows in
 * the Problems tab — driven through the full page→owner→LS→owner→page relay.
 *
 * Architecture proven by this spec (single-store-owner, ADR-0148): the LS runs in
 * a serve:true grandchild the OWNER spawns, reading the owner's authoritative VFS
 * over fs.* sync-RPC. The page has no direct channel to it, so every `rifty:ts-lsp`
 * frame relays through the owner. A page-spawned LS would see an EMPTY tree; if the
 * relay/spawn were wrong, NO diagnostic would ever arrive and these polls fail.
 *
 * Load-bearing: the diagnostic is a genuine TS type error (TS2322,
 * number = string). It only appears if (a) the owner spawned the LS child, (b) the
 * page→owner→LS request reached it, (c) the LS built a real ts.LanguageService
 * over the owner VFS (vendored lib.d.ts), (d) the LS→owner→page response carried
 * the diagnostic back, (e) the page mapped it to a Monaco marker + a Problems row.
 * Then FIXING the type clears BOTH — proving the live update path (ts:update →
 * fresh diagnostics), not a one-shot static render.
 *
 * Input fidelity: the type error is typed through the REAL Monaco input
 * (`page.keyboard.insertText` into `textarea.inputarea`) — a genuine keystroke →
 * `onDidChangeModelContent` → debounced `ts:update`. The deterministic FULL
 * REPLACE for the fix goes through `__riftySetEditorValue`, an EditorHost test
 * hook that calls `model.setValue` — the SAME `onDidChangeModelContent` the
 * keyboard fires (Monaco's Cmd/Ctrl-A select-all is unreliable under Playwright,
 * so a keyboard full-replace is flaky). The LS pipeline under assertion is 100%
 * real either way; only the text delivery for the fix is made deterministic.
 *
 * Requires cross-origin isolation (the owner is SAB-IPC-gated; no page fallback) —
 * the e2e harness serves COOP/COEP. Chromium-only, matching the other owner specs.
 */

const TS_PATH = '/workspace/src/lsp-check.ts';

/** rifty-TS marker count for a VFS path via the EditorHost e2e hook (ADR-0166 P1.9d). */
async function tsMarkerCount(page: Page, path: string): Promise<number> {
  return page.evaluate((p) => {
    const fn = (globalThis as { __riftyTsMarkers?: (path: string) => number }).__riftyTsMarkers;
    return fn ? fn(p) : -2; // -2: hook not installed (editor not mounted yet)
  }, path);
}

/** Set an open model's whole content via the EditorHost test hook (real change event). */
async function setModelValue(page: Page, path: string, text: string): Promise<boolean> {
  return page.evaluate(
    ({ p, t }) => {
      const fn = (globalThis as { __riftySetEditorValue?: (path: string, text: string) => boolean })
        .__riftySetEditorValue;
      return fn ? fn(p, t) : false;
    },
    { p: path, t: text },
  );
}

/** Open a workspace file through the real command palette (Ctrl/Cmd-K → type → click). */
async function openFileViaPalette(page: Page, filename: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+KeyK');
  const palette = page.locator('[data-testid="command-palette"]');
  await expect(palette).toBeVisible();
  await palette.locator('input').fill(filename);
  // The Files section lists the workspace file (label = workspace-relative path).
  const row = palette.locator('.rf-palette__item', { hasText: filename }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(palette).toBeHidden();
}

test.describe('rifty TS language service: real diagnostics in the playground', () => {
  test('type error → Monaco squiggle + Problems row; fix → both clear', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(90_000);
    await page.goto('/');

    // Owner shell ready: terminal 1 echoes the boot dev line (same gate the
    // owner-editor spec uses). Terminal 1 then runs `vite` (blocks its prompt), so
    // open a SECOND idle shell on the same persistent owner for file commands.
    await expect.poll(() => terminalBuffer(page), { timeout: 30_000 }).toContain('$ vite');
    await openShellTerminal(page);

    // Create an EMPTY .ts file in the owner store (the SSoT the LS reads) via a
    // real shell command — empty so the keyboard-typed error below is the SOLE
    // content (nothing to mangle). The owner republishes its snapshot on command
    // exit, so the palette then lists it.
    await runTerminalLine(page, `printf '' > ${TS_PATH}`);
    await runTerminalLine(page, 'ls /workspace/src');
    await expect.poll(() => terminalBuffer(page), { timeout: 15_000 }).toContain('lsp-check.ts');

    // Open it in the editor through the real palette → an editable .ts tab. This
    // fires the page LS client's ts:open + a first diagnostics pass (empty → none).
    await openFileViaPalette(page, 'lsp-check.ts');

    // Editor opened a model for this path (hook returns >= 0 once mounted) and the
    // empty file has NO diagnostics yet.
    await expect
      .poll(() => tsMarkerCount(page, TS_PATH), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);

    // Introduce a REAL type error via the real Monaco input: type a single
    // `number = string` statement into the empty file. number = string ⇒ TS2322.
    // The keystroke → debounced ts:update → LS → diagnostics → marker.
    const editor = page.locator('[data-testid="editor"]');
    const input = editor.locator('textarea.inputarea').first();
    await editor.locator('.view-line').first().click();
    await expect(input).toBeFocused();
    await page.keyboard.insertText('export const bad: number = "not a number";');

    // (1) a rifty-TS Monaco marker appears (generous: page→owner→LS async hop).
    await expect.poll(() => tsMarkerCount(page, TS_PATH), { timeout: 30_000 }).toBeGreaterThan(0);

    // (1b) and a real error squiggle is rendered on the active model.
    await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible({
      timeout: 30_000,
    });

    // (2) a row appears in the Problems tab.
    await page.locator('[data-testid="problems-tab"]').click();
    await expect(page.locator('[data-testid="problems-panel"]')).toBeVisible();
    await expect
      .poll(() => page.locator('[data-testid="problem-row"]').count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    // The row carries the actual TS message (number/string mismatch), not a stub.
    await expect(page.locator('[data-testid="problem-row"]').first()).toContainText(
      /number|string/i,
    );

    // Fix the error → ts:update → fresh (empty) diagnostics. A clean full-replace
    // via the model test hook (real change event, see header). BOTH the marker AND
    // the Problems row must clear.
    expect(await setModelValue(page, TS_PATH, 'export const good: number = 42;\n')).toBe(true);

    await expect.poll(() => tsMarkerCount(page, TS_PATH), { timeout: 30_000 }).toBe(0);
    await expect
      .poll(() => page.locator('[data-testid="problem-row"]').count(), { timeout: 30_000 })
      .toBe(0);
  });
});
