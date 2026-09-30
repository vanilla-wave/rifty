import { type Page, expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';
const fixture = `/@fs${process.cwd()}/tests/browser-unit/fixtures/agent-archive.ts`;
async function saved(page: Page) {
  return page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).saved(), fixture);
}
test('automatically preserves original messages and tools across reset and reload', async ({
  page,
}) => {
  await gotoHarness(page);
  const result = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).save(true),
    fixture,
  );
  expect(result.firstStatus).toBe('done');
  expect(result.events.some((event: { type: string }) => event.type === 'archive')).toBe(true);
  await page.reload();
  const records = await saved(page);
  expect(records).toHaveLength(2);
  expect(JSON.stringify(records)).toContain('cookie-saffron');
  expect(JSON.stringify(records)).toContain('toolResult');
  expect(JSON.stringify(records)).toContain('old-context '.repeat(2500));
});
test('another project discovers and reads older content beyond the tool output window', async ({
  page,
}) => {
  await gotoHarness(page);
  await page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).save(), fixture);
  await page.reload();
  const trace = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).search('cookie-saffron'),
    fixture,
  );
  const result = trace.transcript.find(
    (message: { role: string; toolName?: string }) =>
      message.role === 'toolResult' && message.toolName === 'archive_search',
  );
  expect(result?.isError).toBe(false);
  const text = JSON.stringify(result);
  const id = text.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)?.[0];
  expect(id).toBeTruthy();
  const read = await page.evaluate(
    async ({ url, id }) => (await import(/* @vite-ignore */ url)).read(id, 24000),
    { url: fixture, id },
  );
  expect(JSON.stringify(read.transcript)).toContain('cookie-saffron');
});
test('storage permission failure is visible and never yields done', async ({ page }) => {
  await gotoHarness(page);
  await page.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = async () => {
      throw new DOMException('archive denied', 'NotAllowedError');
    };
  });
  const result = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).save(),
    fixture,
  );
  expect(result.firstStatus).toBe('error');
});
test('corrupt archive is reported as an error by discovery', async ({ page }) => {
  await gotoHarness(page);
  await page.evaluate(async (url) => {
    const f = await import(/* @vite-ignore */ url);
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle('.rifty-agent-archives', { create: true });
    const dir = await base.getDirectoryHandle(f.namespace, { create: true });
    const writer = await (
      await dir.getFileHandle('00000000-0000-4000-8000-000000000000.json', { create: true })
    ).createWritable();
    await writer.write('{"messages":');
    await writer.close();
  }, fixture);
  const trace = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).search('shop'),
    fixture,
  );
  const result = trace.transcript.find(
    (message: { role: string; toolName?: string }) =>
      message.role === 'toolResult' && message.toolName === 'archive_search',
  );
  expect(result?.isError).toBe(true);
  expect(JSON.stringify(result)).toContain('corrupt');
});

test('compaction retains original messages outside the projected context', async ({ page }) => {
  await gotoHarness(page);
  const trace = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).compact(),
    fixture,
  );
  expect(
    trace.events.some(
      (row: { event: { type: string; success?: boolean } }) =>
        row.event.type === 'compaction' && row.event.success,
    ),
  ).toBe(true);
  await page.reload();
  const records = await saved(page);
  expect(JSON.stringify(records)).toContain('original-user '.repeat(3000));
  expect(JSON.stringify(records)).toContain('original-reply '.repeat(500));
});
test('cross-tab writers retain both conversations', async ({ page, context }) => {
  await gotoHarness(page);
  const other = await context.newPage();
  await gotoHarness(other);
  await Promise.all(
    [page, other].map((p) =>
      p.evaluate(async (url) => (await import(/* @vite-ignore */ url)).save(), fixture),
    ),
  );
  await page.reload();
  const records = await saved(page);
  expect(records).toHaveLength(2);
  expect(new Set(records.map((row: { name: string }) => row.name)).size).toBe(2);
  for (const record of records) expect(record.text).toContain('cookie-saffron');
});
test('reload during a native write preserves acknowledged messages and flags incomplete tail', async ({
  page,
}) => {
  await gotoHarness(page);
  await page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).interrupt(), fixture);
  await expect(page.locator('body')).toHaveAttribute('data-archive-write-blocked', 'yes', {
    timeout: 5000,
  });
  await page.reload();
  const records = await saved(page);
  expect(records).toHaveLength(1);
  expect(records[0].text).toContain('acknowledged-original');
  expect(records[0].text).toContain('incomplete');
  expect(records[0].text).not.toContain('unacknowledged-tail');
});
