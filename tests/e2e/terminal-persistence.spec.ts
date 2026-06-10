import { type Page, expect, test } from '@playwright/test';

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

async function selectDevPreset(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Templates' }).click();
  const devPreset = page.locator('button[data-preset="dev-hmr"]');
  await devPreset.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(devPreset).toHaveAttribute('aria-pressed', 'true');
}

test.describe('Terminal persistence', () => {
  test('shell-mode abbreviations expand before submit', async ({ page }) => {
    await page.goto('/');
    await selectDevPreset(page);

    const term = page.locator('[data-testid="terminal"]');
    await term.click();
    await page.keyboard.type('ll ');
    await page.keyboard.press('Enter');

    await expect
      .poll(async () => {
        const history = await readOpfsJson<{
          records: Array<{ command: string; mode: string }>;
        }>(page, '/workspace/.rifty/terminal-history.json');
        return history?.records[0] ?? null;
      })
      .toMatchObject({ command: 'ls -la ', mode: 'dev' });
  });

  test('restores shell cwd, env, and rich history through OPFS after reload', async ({ page }) => {
    await page.goto('/');
    await selectDevPreset(page);

    const term = page.locator('[data-testid="terminal"]');
    const marker = `smoke${Date.now().toString(36)}`;
    await term.click();
    await page.keyboard.type('cd /');
    await page.keyboard.press('Enter');
    await page.keyboard.type(`s=${marker}`);
    await page.keyboard.press('Enter');

    await expect
      .poll(async () =>
        readOpfsJson<{ cwd: string; env: Record<string, string> }>(
          page,
          '/workspace/.rifty/terminal-state.json',
        ),
      )
      .toMatchObject({ cwd: '/', env: { s: marker } });

    await page.reload();
    await selectDevPreset(page);
    await term.click();
    await page.keyboard.type('b=$s');
    await page.keyboard.press('Enter');

    await expect
      .poll(async () =>
        readOpfsJson<{ cwd: string; env: Record<string, string> }>(
          page,
          '/workspace/.rifty/terminal-state.json',
        ),
      )
      .toMatchObject({ cwd: '/', env: { s: marker, b: marker } });

    const history = await readOpfsJson<{
      records: Array<{ command: string; cwd: string; mode: string }>;
    }>(page, '/workspace/.rifty/terminal-history.json');
    expect(history.records.slice(0, 3).map((record) => record.command)).toEqual([
      'b=$s',
      `s=${marker}`,
      'cd /',
    ]);
    expect(history.records[0]).toMatchObject({ cwd: '/', mode: 'dev' });
  });
});
