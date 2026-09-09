import { type Page, expect, test } from '@playwright/test';
import { checkpoints } from './fixtures/orphan-scratch-recovery-boundary.ts';
import {
  excludedFiles,
  ordinaryDirectories,
  ordinaryFiles,
  orphanRoot,
  recoveryNamespace,
} from './fixtures/orphan-scratch-recovery-data.ts';
import type { RecoveryRequest } from './fixtures/orphan-scratch-recovery-worker.ts';

const fixtureUrl = `/@fs${process.cwd().replaceAll('\\', '/')}/tests/browser-unit/fixtures/orphan-scratch-recovery-public.ts`;
const workerUrl = `/@fs${process.cwd().replaceAll('\\', '/')}/tests/browser-unit/fixtures/orphan-scratch-recovery-worker.ts`;
interface NativeTree {
  directories: string[];
  files: Record<string, number[]>;
}
interface Custody {
  catalog: { retainedScratch?: { id: string }[]; scratch?: unknown } | null;
  source: NativeTree | null;
  retained: Record<string, NativeTree | null>;
}
interface Result {
  kind: 'paused' | 'completed';
  checkpoint?: string;
  ok?: boolean;
  error?: string;
  deniedReads?: number;
  records?: { id: string }[];
  before?: { id: string }[];
  exports?: { id: string; text: string }[];
  custody?: Custody;
}

async function prepare(page: Page) {
  await page.goto('/unit-harness.html');
  await page.evaluate(
    async (url) => (await import(/* @vite-ignore */ url)).seedNativeOrphan(),
    fixtureUrl,
  );
}
async function publicCall<T>(
  page: Page,
  method: 'open' | 'createFresh' | 'list' | 'download' | 'close',
  argument?: string,
): Promise<T> {
  return page.evaluate(
    async ({ url, method, argument }) => {
      const fixture = await import(/* @vite-ignore */ url);
      return fixture[method](argument);
    },
    { url: fixtureUrl, method, argument },
  );
}
async function outside(page: Page) {
  return page.evaluate(
    async ({ url, orphanRoot }) => {
      const fixture = await import(/* @vite-ignore */ url);
      const defaultTree = await fixture.nativeTree(orphanRoot);
      const sibling = await fixture.nativeTree('recovery-B');
      const root = await navigator.storage.getDirectory();
      const file = await (await root.getFileHandle('default-sentinel.bin')).getFile();
      return {
        defaultTree,
        sibling,
        sentinel: Array.from(new Uint8Array(await file.arrayBuffer())),
      };
    },
    { url: fixtureUrl, orphanRoot },
  );
}
function exportMatches(text: string) {
  const parsed = JSON.parse(text) as {
    format: string;
    version: number;
    root: string;
    directories: string[];
    files: { path: string; encoding: string; content: string }[];
  };
  expect(Object.keys(parsed).sort()).toEqual(['directories', 'files', 'format', 'root', 'version']);
  expect(parsed).toMatchObject({ format: 'rifty-scratch-recovery', version: 1, root: '/' });
  expect([...parsed.directories].sort()).toEqual(ordinaryDirectories);
  expect(parsed.files.map(({ path }) => path).sort()).toEqual(Object.keys(ordinaryFiles).sort());
  for (const file of parsed.files) {
    expect(file.encoding).toBe('base64');
    expect(file.content).toBe(Buffer.from(ordinaryFiles[file.path] ?? []).toString('base64'));
  }
}
function retainedMatches(result: Result) {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'completed', ok: true });
  expect(result.records).toHaveLength(1);
  expect(result.exports).toHaveLength(1);
  const record = result.records?.[0];
  const exported = result.exports?.[0];
  if (record === undefined || exported === undefined) throw new Error('Retained result absent');
  expect(Object.keys(record)).toEqual(['id']);
  expect(record.id).toEqual(expect.any(String));
  expect(record.id.length).toBeGreaterThan(0);
  expect(exported.id).toBe(record.id);
  exportMatches(exported.text);
  return record.id;
}

function worker(page: Page, request: RecoveryRequest): Promise<Result> {
  return page.evaluate(
    ({ url, request }) =>
      new Promise<Result>((resolve, reject) => {
        const worker = new Worker(url, { type: 'module' });
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error('Real orphan catalog did not settle or reach native boundary'));
        }, 30_000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          worker.terminate();
          resolve(data);
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(event.message));
        };
        worker.postMessage(request);
      }),
    { url: workerUrl, request },
  );
}

test('public orphan preserve/fresh/list/export/reopen keeps exact ordinary bytes without a live session', async ({
  page,
}) => {
  await prepare(page);
  const before = await outside(page);
  const acquisition: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/(?:npm-registry|eddy)(?:\/|$)/.test(pathname)) acquisition.push(request.url());
  });
  let id: string;
  try {
    await publicCall(page, 'open', recoveryNamespace);
    expect(await publicCall(page, 'createFresh')).toEqual({
      marker: 'fresh Scratch\n',
      originalPresent: false,
    });
    const records = await publicCall<{ id: string }[]>(page, 'list');
    expect(records).toHaveLength(1);
    if (records[0] === undefined) throw new Error('Missing retained record');
    expect(Object.keys(records[0])).toEqual(['id']);
    id = records[0].id;
    exportMatches(await publicCall<string>(page, 'download', id));
    await expect(publicCall(page, 'download', 'not-an-existing-retention-id')).rejects.toThrow();
    expect(await publicCall(page, 'list')).toEqual(records);
  } finally {
    await publicCall(page, 'close');
  }
  await page.reload();
  try {
    await publicCall(page, 'open', recoveryNamespace);
    expect(await publicCall(page, 'list')).toEqual([{ id }]);
    exportMatches(await publicCall<string>(page, 'download', id));
    expect(await publicCall(page, 'createFresh')).toEqual({
      marker: 'fresh Scratch\n',
      originalPresent: false,
    });
  } finally {
    await publicCall(page, 'close');
  }
  expect(await outside(page)).toEqual(before);
  expect(acquisition).toEqual([]);
});

test('public catalog can enumerate empty retention before any project session', async ({
  page,
}) => {
  await page.goto('/unit-harness.html');
  try {
    await publicCall(page, 'open', recoveryNamespace);
    expect(await publicCall(page, 'list')).toEqual([]);
  } finally {
    await publicCall(page, 'close');
  }
});

for (const checkpoint of checkpoints) {
  test(`native kill ${checkpoint}: recovery keeps one retained copy and opens fresh Scratch`, async ({
    page,
  }) => {
    await prepare(page);
    const before = await outside(page);
    const paused = await worker(page, { phase: 'victim', fault: checkpoint });
    expect(paused, JSON.stringify(paused)).toMatchObject({ kind: 'paused', checkpoint });
    const state = paused.custody;
    if (state === undefined) throw new Error('Native boundary custody is absent');
    const committedId = state.catalog?.retainedScratch?.[0]?.id;
    if (committedId === undefined) {
      expect(state.source?.files).toMatchObject({ ...ordinaryFiles, ...excludedFiles });
    } else {
      expect(state.retained[committedId]).toEqual({
        directories: ordinaryDirectories,
        files: ordinaryFiles,
      });
    }
    const recovered = await worker(page, { phase: 'verify' });
    const id = retainedMatches(recovered);
    if (committedId !== undefined) expect(id).toBe(committedId);
    expect(recovered.custody?.source?.files['fresh.txt']).toEqual(
      Array.from(new TextEncoder().encode('fresh Scratch\n')),
    );
    expect(recovered.custody?.source?.files['user.bin']).toBeUndefined();
    expect(retainedMatches(await worker(page, { phase: 'verify' }))).toBe(id);
    expect(await outside(page)).toEqual(before);
  });
}

for (const fault of ['copy-quota', 'fresh-pointer-permission'] as const) {
  test(`native ${fault}: failed work preserves custody and retry does not duplicate retention`, async ({
    page,
  }) => {
    await prepare(page);
    const before = await outside(page);
    const failed = await worker(page, { phase: 'victim', fault });
    expect(failed).toMatchObject({
      kind: 'completed',
      ok: false,
      error: expect.stringContaining(
        fault === 'copy-quota' ? 'orphan-native-copy-quota' : 'orphan-native-fresh-pointer-denied',
      ),
    });
    const committedId = failed.custody?.catalog?.retainedScratch?.[0]?.id;
    if (fault === 'copy-quota') {
      expect(committedId).toBeUndefined();
      expect(failed.custody?.source?.files).toMatchObject({ ...ordinaryFiles, ...excludedFiles });
    } else {
      expect(committedId).toEqual(expect.any(String));
      const exported = await worker(page, { phase: 'export' });
      expect(retainedMatches(exported)).toBe(committedId);
    }
    const id = retainedMatches(await worker(page, { phase: 'verify' }));
    if (committedId !== undefined) expect(id).toBe(committedId);
    expect(retainedMatches(await worker(page, { phase: 'verify' }))).toBe(id);
    expect(await outside(page)).toEqual(before);
  });
}

test('native failed retained download is non-consuming and a fresh owner can retry exact bytes', async ({
  page,
}) => {
  await prepare(page);
  const before = await outside(page);
  const id = retainedMatches(await worker(page, { phase: 'victim' }));
  const refused = await worker(page, { phase: 'export', fault: 'export-read' });
  expect(refused).toMatchObject({ ok: false, error: expect.any(String) });
  expect(refused.deniedReads).toBeGreaterThan(0);
  console.log(
    '[orphan-native-read]',
    JSON.stringify({ role: 'retained', deniedReads: refused.deniedReads, error: refused.error }),
  );
  expect(refused.custody?.catalog?.retainedScratch).toHaveLength(1);
  expect(refused.custody?.catalog?.retainedScratch?.[0]?.id).toBe(id);
  expect(retainedMatches(await worker(page, { phase: 'export' }))).toBe(id);
  expect(await outside(page)).toEqual(before);
});

test('native cold original read refusal preserves the only copy and a fresh owner retries retention', async ({
  page,
}) => {
  await prepare(page);
  const before = await outside(page);
  const failed = await worker(page, { phase: 'victim', fault: 'source-read' });
  expect(failed).toMatchObject({ kind: 'completed', ok: false, error: expect.any(String) });
  expect(failed.deniedReads).toBeGreaterThan(0);
  console.log(
    '[orphan-native-read]',
    JSON.stringify({
      role: 'source',
      deniedReads: failed.deniedReads,
      error: failed.error,
      original: failed.custody?.source?.files['user.bin'],
    }),
  );
  expect(failed.custody?.source?.files).toMatchObject({ ...ordinaryFiles, ...excludedFiles });
  expect(failed.custody?.catalog?.retainedScratch ?? []).toEqual([]);
  expect(await outside(page)).toEqual(before);
  const id = retainedMatches(await worker(page, { phase: 'verify' }));
  expect(retainedMatches(await worker(page, { phase: 'verify' }))).toBe(id);
  expect(await outside(page)).toEqual(before);
});
