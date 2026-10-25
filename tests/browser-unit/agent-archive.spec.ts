import { type Page, expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';
const fixture = `/@fs${process.cwd()}/tests/browser-unit/fixtures/agent-archive.ts`;
async function saved(page: Page) {
  return page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).saved(), fixture);
}
/** Parsed archive_search body after the built-in receipt line; an error receipt throws. */
function searchResult(trace: { transcript: { role: string; toolName?: string }[] }) {
  const result = trace.transcript.find(
    (message) => message.role === 'toolResult' && message.toolName === 'archive_search',
  ) as { isError: boolean; content: { text: string }[] } | undefined;
  if (!result || result.isError)
    throw new Error(`archive_search failed: ${JSON.stringify(result)}`);
  const text = result.content[0].text;
  return JSON.parse(text.slice(text.indexOf('\n') + 1)) as {
    matches: { sessionId: string; createdAt: number; restoredMessageCount: number }[];
    corrupt: { entry: string; message: string }[];
    corruptCount: number;
    nextOffset: number | null;
  };
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
test('a session restored from host history archives only its own messages', async ({ page }) => {
  await gotoHarness(page);
  await page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).save(), fixture);
  await page.reload();
  const resumed = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).resume(),
    fixture,
  );
  expect(resumed.status).toBe('done');
  expect(resumed.restored).toBeGreaterThan(0);
  await page.reload();
  const records = await saved(page);
  expect(records).toHaveLength(2);
  const originals = records.filter((row: { text: string }) => row.text.includes('cookie-saffron'));
  expect(originals).toHaveLength(1);
  const continued = records.find((row: { text: string }) => !row.text.includes('cookie-saffron'));
  const conversation = JSON.parse(JSON.parse(continued.text).payload);
  expect(conversation.restoredMessageCount).toBe(resumed.restored);
  expect(conversation.messages[0].role).toBe('user');
  expect(JSON.stringify(conversation.messages)).toContain('Continue with the same auth');
  const trace = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).search('cookie-saffron'),
    fixture,
  );
  const { matches } = searchResult(trace);
  expect(matches).toHaveLength(1);
  expect(matches[0].restoredMessageCount).toBe(0);
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
test('a corrupt entry is listed by discovery without hiding healthy conversations', async ({
  page,
}) => {
  await gotoHarness(page);
  await page.evaluate(async (url) => {
    const f = await import(/* @vite-ignore */ url);
    await f.save();
    await f.corrupt();
  }, fixture);
  const trace = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).search('cookie-saffron'),
    fixture,
  );
  const { matches, corrupt } = searchResult(trace);
  expect(matches).toHaveLength(1);
  expect(corrupt).toEqual([
    {
      entry: '00000000-0000-4000-8000-000000000000.json',
      message: expect.stringContaining('corrupt'),
    },
  ]);
  const read = await page.evaluate(
    async ({ url, id }) => (await import(/* @vite-ignore */ url)).read(id),
    { url: fixture, id: '00000000-0000-4000-8000-000000000000' },
  );
  const result = read.transcript.find(
    (message: { role: string; toolName?: string }) =>
      message.role === 'toolResult' && message.toolName === 'archive_read',
  );
  expect(result?.isError).toBe(true);
  expect(JSON.stringify(result)).toContain('corrupt');
});
test('discovery lists newest conversations first regardless of file name order', async ({
  page,
}) => {
  await gotoHarness(page);
  await page.evaluate(
    async (url) =>
      (await import(/* @vite-ignore */ url)).seed([
        { sessionId: '00000000-0000-4000-8000-000000000001', createdAt: 1000, text: 'ordered old' },
        { sessionId: '00000000-0000-4000-8000-000000000002', createdAt: 3000, text: 'ordered new' },
        { sessionId: '00000000-0000-4000-8000-000000000003', createdAt: 2000, text: 'ordered mid' },
      ]),
    fixture,
  );
  const trace = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).search('ordered'),
    fixture,
  );
  expect(
    searchResult(trace).matches.map((match: { createdAt: number }) => match.createdAt),
  ).toEqual([3000, 2000, 1000]);
});
test('discovery matches original text but never image bytes', async ({ page }) => {
  await gotoHarness(page);
  await page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).saveImage(), fixture);
  const bytes = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).search('AAAANSUhEUg'),
    fixture,
  );
  expect(searchResult(bytes).matches).toHaveLength(0);
  const text = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).search('Keep this original image'),
    fixture,
  );
  expect(searchResult(text).matches).toHaveLength(1);
});
test('files written before restoredMessageCount stay readable as fully archived', async ({
  page,
}) => {
  await gotoHarness(page);
  const id = '00000000-0000-4000-8000-000000000004';
  await page.evaluate(
    async ({ url, id }) =>
      (await import(/* @vite-ignore */ url)).seed([
        { sessionId: id, createdAt: 4000, text: 'legacy envelope', legacy: true },
      ]),
    { url: fixture, id },
  );
  const trace = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).search('legacy envelope'),
    fixture,
  );
  const { matches, corrupt } = searchResult(trace);
  expect(corrupt).toEqual([]);
  expect(
    matches.map((match: { sessionId: string; restoredMessageCount: number }) => [
      match.sessionId,
      match.restoredMessageCount,
    ]),
  ).toEqual([[id, 0]]);
  const read = await page.evaluate(
    async ({ url, id }) => (await import(/* @vite-ignore */ url)).read(id),
    { url: fixture, id },
  );
  const result = read.transcript.find(
    (message: { role: string; toolName?: string }) =>
      message.role === 'toolResult' && message.toolName === 'archive_read',
  );
  expect(result?.isError).toBe(false);
  expect(JSON.stringify(result)).toContain('legacy envelope');
});
test('discovery bounds the corrupt list and reports the total', async ({ page }) => {
  await gotoHarness(page);
  await page.evaluate(async (url) => (await import(/* @vite-ignore */ url)).corrupt(12), fixture);
  const trace = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).search(''),
    fixture,
  );
  const { matches, corrupt, corruptCount } = searchResult(trace);
  expect(matches).toEqual([]);
  expect(corrupt).toHaveLength(10);
  expect(corruptCount).toBe(12);
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

test('images and project provenance remain exact; provider credentials are absent', async ({
  page,
}) => {
  await gotoHarness(page);
  const image = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).saveImage(),
    fixture,
  );
  await page.reload();
  const records = await saved(page);
  expect(records).toHaveLength(1);
  const conversation = JSON.parse(JSON.parse(records[0].text).payload);
  expect(conversation.project).toEqual({ id: 'shop', name: 'shop' });
  expect(conversation.messages[0].content).toContainEqual(image);
  expect(records[0].text).not.toContain('provider-secret-must-not-be-archived');
});
test('durable receipt is emitted only after native close settles', async ({ page }) => {
  await gotoHarness(page);
  const result = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).acknowledgement(),
    fixture,
  );
  expect(result.before).toBe(0);
  expect(
    result.events.filter((event: { type: string }) => event.type === 'archive').length,
  ).toBeGreaterThan(0);
});
test('quota failure emits an archive error and no durable success', async ({ page }) => {
  await gotoHarness(page);
  await page.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = async () => {
      throw new DOMException('archive full', 'QuotaExceededError');
    };
  });
  const result = await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).save(),
    fixture,
  );
  expect(result.firstStatus).toBe('error');
  expect(result.events.some((event: { type: string }) => event.type === 'archive-error')).toBe(
    true,
  );
  expect(result.events.some((event: { type: string }) => event.type === 'archive')).toBe(false);
});

test('discovery searches original quoted, multiline and backslash text', async ({ page }) => {
  await gotoHarness(page);
  for (const query of ['"cookie-saffron"', 'first\nsecond', 'path\\cookie']) {
    const receipt = await page.evaluate(
      async ({ url, query }) => {
        const f = await import(/* @vite-ignore */ url);
        const agent = f.session(['Saved.']);
        await agent.send(`Authentication decision: ${query}`);
        await agent.dispose();
        const trace = await f.search(query);
        return trace.transcript.find(
          (message: { role: string; toolName?: string }) =>
            message.role === 'toolResult' && message.toolName === 'archive_search',
        );
      },
      { url: fixture, query },
    );
    expect(receipt?.isError).toBe(false);
    expect(JSON.stringify(receipt)).toContain('shop');
  }
});
