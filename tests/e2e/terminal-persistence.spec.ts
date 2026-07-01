import { type Page, expect, test } from '@playwright/test';
import { bootShell, openShellTerminal, runTerminalLine } from './helpers/playground.ts';

async function readOpfsJson<T>(page: Page, path: string): Promise<T | null> {
  return page.evaluate(async (target) => {
    try {
      const root = await navigator.storage.getDirectory();
      const parts = target.split('/').filter(Boolean);
      let dir = root;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i] as string);
      }
      const file = await dir.getFileHandle(parts[parts.length - 1] as string);
      return JSON.parse(await (await file.getFile()).text()) as T;
    } catch {
      return null;
    }
  }, path);
}

test.describe('Terminal persistence', () => {
  test('shell-mode command history records submitted input', async ({ page }) => {
    await bootShell(page);
    await openShellTerminal(page);

    await runTerminalLine(page, 'll ');

    await expect
      .poll(async () => {
        const history = await readOpfsJson<{
          records: Array<{ command: string; mode: string }>;
        }>(page, '/workspace/.rifty/terminal-history.json');
        return history?.records[0] ?? null;
      })
      .toMatchObject({ command: 'll ', mode: 'real-vite' });
  });

  test('persists rich command history through OPFS after reload', async ({ page }) => {
    await bootShell(page);
    await openShellTerminal(page);

    const marker = `smoke${Date.now().toString(36)}`;
    const expectedCommands = ['pwd', `echo ${marker}`];
    const readHistory = () =>
      readOpfsJson<{
        records: Array<{ command: string; cwd: string; mode: string }>;
      }>(page, '/workspace/.rifty/terminal-history.json');

    await runTerminalLine(page, `echo ${marker}`);
    // Gate on echo finishing before typing the next line: under the OPFS-backed
    // owner the boot tree-restore keeps its single thread busy, so a command typed
    // while the previous one is still running lands in that process's stdin and is
    // lost (correct terminal semantics — matches owner-shell-cowsay's install gate;
    // owner responsiveness during boot is a separate concern). On the memory backend the
    // command returned instantly, so back-to-back typing happened to work.
    await expect
      .poll(async () => (await readHistory())?.records.map((record) => record.command) ?? [])
      .toContain(`echo ${marker}`);
    await runTerminalLine(page, 'pwd');

    await expect
      .poll(async () => {
        const history = await readHistory();
        return history?.records.slice(0, 2).map((record) => record.command) ?? [];
      })
      .toEqual(expectedCommands);

    await page.reload();

    await expect
      .poll(async () => {
        const history = await readHistory();
        return history?.records.slice(0, 2).map((record) => record.command) ?? [];
      })
      .toEqual(expectedCommands);

    const history = await readHistory();
    expect(history?.records[0]).toMatchObject({ cwd: '/scratch', mode: 'real-vite' });
  });
});
