import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const previewProtocolUrl = `/@fs${workspacePath}/packages/io/src/preview-protocol.ts`;

test('prefixed preview path is parsed for a /sandbox/ host (I5)', async ({ page }) => {
  test.setTimeout(60_000);
  await gotoHarness(page);

  const parsed = await page.evaluate(async (moduleUrl) => {
    const mod = (await import(/* @vite-ignore */ moduleUrl)) as {
      parsePreviewPath: (
        path: string,
        prefix?: string,
      ) => { readonly port: number; readonly rest: string } | null;
    };
    return mod.parsePreviewPath('/sandbox/preview/5173/src/main.ts', '/sandbox/preview');
  }, previewProtocolUrl);

  expect(parsed).toEqual({ port: 5173, rest: '/src/main.ts' });
});
