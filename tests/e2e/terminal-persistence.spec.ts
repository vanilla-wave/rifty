import { type Page, expect, test } from '@playwright/test';
import { openShellTerminal, runTerminalLine } from './helpers/playground.ts';

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
    await page.goto('/');
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
    await page.goto('/');
    await openShellTerminal(page);

    const marker = `smoke${Date.now().toString(36)}`;
    const expectedCommands = ['pwd', `echo ${marker}`];
    const readHistory = () =>
      readOpfsJson<{
        records: Array<{ command: string; cwd: string; mode: string }>;
      }>(page, '/workspace/.rifty/terminal-history.json');

    await runTerminalLine(page, `echo ${marker}`);
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
    expect(history?.records[0]).toMatchObject({ cwd: '/workspace', mode: 'real-vite' });
  });
});
