import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workerModuleUrl = `/@fs${process.cwd()}/tests/browser-unit/fixtures/replica-persistence-worker.ts?worker&url`;
interface Entry {
  path: string;
  kind: string;
  content?: number[];
  mtime?: number;
}

for (const damage of [
  'head',
  'segment',
  'truncate',
  'live-native',
  'native-read-error',
  'compaction-quota',
  'legacy',
]) {
  test(`replica ${damage} preserves honest recovery`, async ({ page }) => {
    await gotoHarness(page);
    const result = await page.evaluate(
      async ({ url, damage }) => {
        const module = await import(/* @vite-ignore */ url);
        const worker = new Worker(module.default, { type: 'module' });
        try {
          return await new Promise<{
            rejected?: boolean;
            hasFile?: boolean;
            issue?: { kind: string };
            name?: string;
            message?: string;
            cache?: string;
            reads?: number;
            hasLegacy?: boolean;
            native?: string;
            retained?: boolean;
            dirty?: { total: number };
            before?: Entry[];
            actual?: Entry[];
          }>((resolve, reject) => {
            worker.onmessage = ({ data }) =>
              data.ok ? resolve(data.result) : reject(new Error(data.error));
            worker.onerror = (e) => reject(new Error(e.message));
            worker.postMessage({
              kind:
                damage === 'native-read-error' ||
                damage === 'compaction-quota' ||
                damage === 'legacy'
                  ? damage
                  : 'corrupt',
              damage,
              namespace: crypto.randomUUID(),
            });
          });
        } finally {
          worker.terminate();
        }
      },
      { url: workerModuleUrl, damage },
    );
    if (damage === 'legacy') {
      expect(result.reads).toBe(0);
      expect(result.hasLegacy).toBe(false);
      expect(result.issue?.kind).toBe('legacy');
      expect(result.native).toBe('legacy edit survives physically');
    } else if (damage === 'live-native') {
      expect(result.cache).toBe('old-a');
      expect(result.rejected).toBe(true);
    } else if (damage === 'native-read-error') {
      expect(result.rejected).toBe(true);
      expect(result.name).toBe('OpfsPreloadError');
      expect(result.message).toContain('native-read-denied');
    } else if (damage === 'compaction-quota') {
      expect(result.dirty?.total).toBe(2);
      const content = (tree: Entry[] | undefined) => tree?.map(({ mtime, ...entry }) => entry);
      expect(content(result.actual)).toEqual(content(result.before));
    } else {
      expect(result.rejected).toBe(false);
      expect(result.issue?.kind).toBe('corrupt');
      expect(result.hasFile).toBe(false);
      expect(result.retained).toBe(true);
    }
  });
}

test('replica preserves exact structural mutations, native bytes and timestamps', async ({
  page,
}) => {
  await gotoHarness(page);
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    const worker = new Worker(module.default, { type: 'module' });
    try {
      return await new Promise<{
        clean: { total: number };
        expected: Entry[];
        actual: Entry[];
        native: number[];
      }>((resolve, reject) => {
        worker.onmessage = ({ data }) =>
          data.ok ? resolve(data.result) : reject(new Error(data.error));
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({ kind: 'roundtrip', namespace: crypto.randomUUID() });
      });
    } finally {
      worker.terminate();
    }
  }, workerModuleUrl);
  expect(result.clean.total).toBe(0);
  expect(result.native).toEqual([0, 255, 128, 1]);
  expect(result.actual).toEqual(result.expected);
});

test('quota in one physical batch reports every logical path and heals only repaired paths', async ({
  page,
}) => {
  await gotoHarness(page);
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    const worker = new Worker(module.default, { type: 'module' });
    try {
      return await new Promise<{
        dirty: {
          total: number;
          failures: unknown[];
          lastPathFailed: boolean;
          otherPathFailed: boolean;
        };
        healed: { total: number; lastPathFailed: boolean };
      }>((resolve, reject) => {
        worker.onmessage = ({ data }) =>
          data.ok ? resolve(data.result) : reject(new Error(data.error));
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({ kind: 'quota', namespace: crypto.randomUUID() });
      });
    } finally {
      worker.terminate();
    }
  }, workerModuleUrl);
  expect(result.dirty.total).toBe(230);
  expect(result.dirty.failures).toHaveLength(20);
  expect(result.dirty.lastPathFailed).toBe(true);
  expect(result.dirty.otherPathFailed).toBe(false);
  expect(result.healed.total).toBe(229);
  expect(result.healed.lastPathFailed).toBe(false);
});

test('report timeout retains the physical writer until real settlement and late success heals', async ({
  page,
}) => {
  await gotoHarness(page);
  const result = await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    const first = new Worker(module.default, { type: 'module' });
    const second = new Worker(module.default, { type: 'module' });
    const namespace = crypto.randomUUID();
    const once = <T>(worker: Worker) =>
      new Promise<T>((resolve, reject) => {
        worker.addEventListener(
          'message',
          ({ data }) => (data.ok ? resolve(data.result) : reject(new Error(data.error))),
          { once: true },
        );
        worker.addEventListener('error', (e) => reject(new Error(e.message)), { once: true });
      });
    try {
      const timed = once<{ dirty: { total: number }; fenced: boolean }>(first);
      first.postMessage({ kind: 'hold', namespace });
      const dirty = await timed;
      const closing = once<{ closed: boolean }>(first);
      first.postMessage({ kind: 'close', namespace });
      await closing;
      const waiting = once<{ acquired: boolean }>(second);
      second.postMessage({ kind: 'contend', namespace });
      const competing = await waiting;
      const settled = once<{ clean: { total: number }; tree: Entry[] }>(first);
      first.postMessage({ kind: 'release', namespace });
      return { dirty, competing, settled: await settled };
    } finally {
      first.terminate();
      second.terminate();
    }
  }, workerModuleUrl);
  expect(result.dirty.dirty.total).toBe(2);
  expect(result.dirty.fenced).toBe(false);
  expect(result.competing.acquired).toBe(false);
  expect(result.settled.clean.total).toBe(0);
  expect(result.settled.tree.find((e) => e.path === '/tree/b.txt')?.content).toEqual([
    ...new TextEncoder().encode('new-b'),
  ]);
});

for (const rounds of [0, 63]) {
  for (const phase of ['before-close', 'after-close'] as const) {
    test(`kill ${rounds === 0 ? 'append' : 'compaction'} at ${phase} preserves one complete tree`, async ({
      page,
    }) => {
      await gotoHarness(page);
      const result = await page.evaluate(
        async ({ url, rounds, phase }) => {
          const module = await import(/* @vite-ignore */ url);
          const victim = new Worker(module.default, { type: 'module' });
          const namespace = crypto.randomUUID();
          const once = <T>(worker: Worker) =>
            new Promise<T>((resolve, reject) => {
              worker.addEventListener(
                'message',
                ({ data }) => (data.ok ? resolve(data.result) : reject(new Error(data.error))),
                { once: true },
              );
              worker.addEventListener('error', (e) => reject(new Error(e.message)), { once: true });
            });
          let before: Entry[];
          try {
            const pause = once<{ before: Entry[] }>(victim);
            victim.postMessage({ kind: 'crash', namespace, rounds, phase });
            before = (await pause).before;
          } finally {
            victim.terminate();
          }
          const fresh = new Worker(module.default, { type: 'module' });
          try {
            const verify = once<{ tree: Entry[]; segments: number | null }>(fresh);
            fresh.postMessage({ kind: 'verify', namespace });
            const replay = await verify;
            return { before, actual: replay.tree, segments: replay.segments };
          } finally {
            fresh.terminate();
          }
        },
        { url: workerModuleUrl, rounds, phase },
      );
      const bytes = (tree: Entry[], path: string) => tree.find((e) => e.path === path)?.content;
      for (const name of ['a', 'b']) {
        const expected =
          phase === 'before-close'
            ? bytes(result.before, `/tree/${name}.txt`)
            : [...new TextEncoder().encode(`new-${name}`)];
        expect(bytes(result.actual, `/tree/${name}.txt`)).toEqual(expected);
      }
      if (rounds === 63) expect(result.segments).toBe(phase === 'before-close' ? 64 : 1);
    });
  }
}
