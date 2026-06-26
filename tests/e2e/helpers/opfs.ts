import type { Page } from '@playwright/test';

async function waitForWorkspacePrefix(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof (globalThis as { __riftyWorkspacePrefix?: unknown }).__riftyWorkspacePrefix ===
      'string',
    undefined,
    { timeout: 15_000 },
  );
}

export async function clearWorkspaceOpfs(page: Page): Promise<void> {
  await waitForWorkspacePrefix(page);
  await page.evaluate(async () => {
    const prefix = (globalThis as { __riftyWorkspacePrefix?: string }).__riftyWorkspacePrefix ?? '';
    const root = (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle;
    let dir = root;
    for (const part of prefix.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    for await (const [name] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      await dir.removeEntry(name, { recursive: true });
    }
  });
}

export async function readWorkspaceText(page: Page, path: string): Promise<string> {
  await waitForWorkspacePrefix(page);
  return await page.evaluate(async (target) => {
    try {
      const prefix =
        (globalThis as { __riftyWorkspacePrefix?: string }).__riftyWorkspacePrefix ?? '';
      const root = (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle;
      let dir = root;
      for (const part of [...prefix.split('/'), ...target.split('/')]
        .filter(Boolean)
        .slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part);
      }
      const file = target.split('/').filter(Boolean).at(-1);
      if (!file) return 'MISSING:EINVAL';
      const fh = await dir.getFileHandle(file);
      return await (await fh.getFile()).text();
    } catch (err) {
      return `MISSING:${(err as Error).name}`;
    }
  }, path);
}

export async function readWorkspaceJson<T>(page: Page, path: string): Promise<T | null> {
  const text = await readWorkspaceText(page, path);
  if (text.startsWith('MISSING:')) return null;
  return JSON.parse(text) as T;
}
