import { type Page, expect, test } from '@playwright/test';
import { clearWorkspaceOpfs, readWorkspaceJson, readWorkspaceText } from './helpers/opfs.ts';
import {
  expectTerminalContains,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
} from './helpers/playground.ts';

async function setOpenEditorValue(page: Page, path: string, text: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ p, t }) => {
            const fn = (
              globalThis as {
                __riftySetEditorValue?: (path: string, text: string) => boolean;
              }
            ).__riftySetEditorValue;
            return fn ? fn(p, t) : false;
          },
          { p: path, t: text },
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function recordMainJsTabPaintsOnNextDocument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & { __riftySawMainJsTab?: boolean };
    state.__riftySawMainJsTab = false;
    const scan = (): void => {
      for (const tab of document.querySelectorAll('[role="tab"]')) {
        if (tab.textContent?.includes('src/main.js')) state.__riftySawMainJsTab = true;
      }
    };
    const start = (): void => {
      scan();
      new MutationObserver(scan).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
}

/**
 * Owner OPFS persistence (chromium only; ADR-0013/0072 + ADR-0143 single-store-owner).
 *
 * The workspace owner is the single source-of-truth for the project tree, but
 * was the only worker realm not wiring `initBackend()` → it ran
 * memory-only, so everything vanished on reload. OPFS is now wired in the owner; the
 * OPFS content-cache write-through (ADR-0072) then persists shell writes, so a
 * file written from the shell survives `page.reload()`.
 *
 * Load-bearing: write `MARKER > /scratch/persist.txt`, reload (browser
 * terminates the owner worker), re-open a shell, `cat` → MARKER returns from the
 * OPFS-preloaded tree. On the memory backend this fails (the reload loses it),
 * so the assertion is honest, not trivially green.
 *
 * Requires cross-origin isolation (the owner is SAB-IPC-gated; the harness serves
 * COOP/COEP). Unique per-run marker → no dependence on (or pollution of) prior
 * OPFS state across tests in a worker.
 *
 * Timing: the dev server auto-boots in Terminal 1 on mount and grabs terminal
 * focus while it streams; we wait for the LIVE pill before opening the second
 * shell so Terminal 2 stays the active session (else the active-terminal read
 * lands on the dev-server log, not our shell).
 */
test.describe('owner workspace persists across reload (OPFS)', () => {
  test('a shell-written file survives page.reload()', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `persist-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await page.goto('/');
    // Deterministic start: wipe this page's owner workspace namespace only.
    await clearWorkspaceOpfs(page);
    await page.reload();
    await pickStarter(page, 'project-files');
    await expect(page.getByText(/LIVE :/)).toBeVisible({ timeout: 60_000 });
    await openShellTerminal(page);

    // Write via the shell → owner syncMirror. The dev server is already LIVE (boot
    // write-through drained by the install stamp flush), so this small write drains
    // to OPFS promptly — durable well before the reload below.
    await runTerminalLine(page, `echo ${marker} > /scratch/persist.txt`);
    await runTerminalLine(page, 'cat /scratch/persist.txt');
    await expectTerminalContains(page, marker, 15_000);
    await expect
      .poll(() => readWorkspaceText(page, '/scratch/persist.txt'), { timeout: 60_000 })
      .toContain(marker);

    // Reload: the browser terminates the owner worker; on re-boot the owner wires
    // OPFS (initBackend) and preloads the persisted tree before serving.
    await page.reload();
    await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
    await expect
      .poll(() => readWorkspaceText(page, '/scratch/persist.txt'), { timeout: 60_000 })
      .toContain(marker);
    await openShellTerminal(page);
    await runTerminalLine(page, 'cat /scratch/persist.txt');
    await expectTerminalContains(page, marker, 20_000);
  });

  test('an edited starter becomes a durable scratch draft and reopens after reload', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `draft-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await page.goto('/');
    await clearWorkspaceOpfs(page);
    await page.reload();
    await pickStarter(page, 'project-files');

    const editor = page.locator('[data-testid="editor"]');
    await setOpenEditorValue(page, '/scratch/src/main.js', `// ${marker}\n`);
    await expect(editor.locator('.view-lines').first()).toContainText(marker);
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(
        async () => {
          const index = await readWorkspaceJson<{
            activeId: string;
            scratch: { starter: string; dirty: boolean } | null;
          }>(page, '/.rifty-project-index.json');
          return index?.activeId === 'scratch' && index.scratch
            ? `${index.scratch.starter}:${index.scratch.dirty ? 'dirty' : 'clean'}`
            : 'missing';
        },
        { timeout: 60_000 },
      )
      .toBe('project-files:dirty');
    await expect
      .poll(() => readWorkspaceText(page, '/scratch/src/main.js'), { timeout: 60_000 })
      .toContain(marker);

    await page.reload();
    await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
    await expect
      .poll(() => readWorkspaceText(page, '/scratch/src/main.js'), { timeout: 60_000 })
      .toContain(marker);
  });

  test('a TypeScript scratch draft reloads without painting the default JavaScript entry tab', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `ts-draft-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await page.goto('/');
    await clearWorkspaceOpfs(page);
    await page.reload();
    await pickStarter(page, 'typescript-ls');
    await expect(page.locator('[data-testid="editor"] .view-lines').first()).toContainText(
      'LibraryShape',
      { timeout: 60_000 },
    );

    await setOpenEditorValue(page, '/scratch/src/main.ts', `// ${marker}\n`);
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect
      .poll(() => readWorkspaceText(page, '/scratch/src/main.ts'), { timeout: 60_000 })
      .toContain(marker);

    await recordMainJsTabPaintsOnNextDocument(page);
    await page.reload();
    await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /src\/main\.ts/ })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (globalThis as typeof globalThis & { __riftySawMainJsTab?: boolean })
              .__riftySawMainJsTab === true,
        ),
      )
      .toBe(false);
  });

  test('a saved project reopens after reload instead of an empty scratch', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(120_000);
    const marker = `saved-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const projectName = `Saved ${marker}`;

    await page.goto('/');
    await clearWorkspaceOpfs(page);
    await page.reload();
    await pickStarter(page, 'project-files');

    // Dirty the scratch (marker), then Save-as-project: activeId flips to /projects/<id>
    // and persists durably; the in-session owner re-roots to it.
    await setOpenEditorValue(page, '/scratch/src/main.js', `// ${marker}\n`);
    await expect(page.locator('[data-action="open-launcher"][data-dirty="true"]')).toBeVisible({
      timeout: 10_000,
    });
    const launcher = page.locator('[data-testid="launcher"]');
    await page.click('[data-action="open-launcher"]');
    await expect(launcher).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^Projects/ }).click();
    await page.click('[data-action="save-scratch"]');
    const dialog = page.locator('.rf-dialog[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator('input.rf-dialog__input').fill(projectName);
    await dialog.getByRole('button', { name: 'Save project' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
    const projectId = await (async (): Promise<string> => {
      const read = async (): Promise<string> => {
        const index = await readWorkspaceJson<{
          projects: { id: string; name: string }[];
        }>(page, '/.rifty-project-index.json');
        return index?.projects.find((p) => p.name === projectName)?.id ?? '';
      };
      await expect.poll(read, { timeout: 60_000 }).not.toBe('');
      return read();
    })();
    await page.locator('.rf-launcher__close').click();
    await expect(launcher).toHaveCount(0, { timeout: 5_000 });

    // Reload: the cold-boot hidden owner is rooted at /scratch. The persisted
    // project-active index MUST re-root the owner to /projects/<id> — else the IDE
    // boots into the empty scratch. Regression guard for the boot re-root.
    await page.reload();
    await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
      timeout: 90_000,
    });
    await expect(launcher).toHaveCount(0);

    // The durable index still points at the saved project (not reset to scratch).
    await expect
      .poll(
        async () => {
          const index = await readWorkspaceJson<{ activeId: string }>(
            page,
            '/.rifty-project-index.json',
          );
          return index?.activeId ?? 'missing';
        },
        { timeout: 60_000 },
      )
      .toBe(projectId);

    // Decisive: the owner-resident shell's cwd IS the owner root. A correct re-root
    // lands the shell in /projects/<id> with the saved file; the bug (owner left at
    // /scratch) prints /scratch and the relative `cat` misses the marker.
    await openShellTerminal(page);
    await runTerminalLine(page, 'pwd');
    await expectTerminalContains(page, `/projects/${projectId}`, 20_000);
    await runTerminalLine(page, 'cat src/main.js');
    await expectTerminalContains(page, marker, 20_000);
  });
});
