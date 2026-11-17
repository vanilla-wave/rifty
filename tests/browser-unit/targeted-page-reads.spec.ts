import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workerModuleUrl = `/@fs${process.cwd()}/tests/browser-unit/fixtures/targeted-page-reads-worker.ts?worker&url`;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

test('I4 real page requests read only their entry at Tracker scale', async ({ page }) => {
  await gotoHarness(page);
  const { scales, pairs, batchReads } = await page.evaluate(
    async ({ moduleUrl }) => {
      const { default: url } = await import(/* @vite-ignore */ moduleUrl);
      const worker = new Worker(url, { type: 'module' });
      try {
        return await new Promise<{
          scales: {
            scale: 'small' | 'tracker';
            entryCount: number;
            reads: Record<string, string[]>;
            isolated: boolean;
            fileVersion: string;
            edited: {
              ownerEpoch: string;
              ok: boolean;
              entry: { version: string; content: Uint8Array };
            };
            directory: { ok: boolean; entries: { kind: string }[] };
          }[];
          pairs: Record<string, { small: number; tracker: number }[]>;
          batchReads: Record<string, number>;
        }>((resolve, reject) => {
          worker.onmessage = ({ data }) =>
            data.ok ? resolve(data.result) : reject(new Error(data.error));
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage('measure');
        });
      } finally {
        worker.terminate();
      }
    },
    { moduleUrl: workerModuleUrl },
  );
  const [small, tracker] = scales;
  if (small?.scale !== 'small' || tracker?.scale !== 'tracker') throw new Error('missing scales');
  const ratios = (kind: string) => pairs[kind]!.map((pair) => pair.tracker / pair.small);
  console.log(
    'I4 page read pairs',
    JSON.stringify(
      ['file', 'directory'].map((kind) => ({
        kind,
        batchReads: batchReads[kind],
        trackerMedianMs: median(pairs[kind]!.map((pair) => pair.tracker)),
        smallMedianMs: median(pairs[kind]!.map((pair) => pair.small)),
        ratios: ratios(kind).map((ratio) => Number(ratio.toFixed(3))),
      })),
    ),
  );
  expect(small.entryCount).toBe(521);
  expect(tracker.entryCount).toBeGreaterThan(17_000);
  for (const r of scales) {
    expect(r.reads.file).toEqual(['/workspace/src/main.ts']);
    expect(r.reads.directory).toEqual([]);
    expect(r.isolated).toBe(true);
    expect(r.edited.ok).toBe(true);
    expect(r.edited.entry.version).not.toBe(r.fileVersion);
    expect(new TextDecoder().decode(r.edited.entry.content)).toBe('edited');
    expect(r.directory.ok).toBe(true);
    expect(r.directory.entries).toHaveLength(33);
    expect(r.directory.entries[0]?.kind).toBe('dir');
  }
  for (const kind of ['file', 'directory']) {
    expect(pairs[kind]).toHaveLength(21);
    expect(median(pairs[kind]!.map((pair) => pair.tracker))).toBeLessThanOrEqual(1);
    // Paired, interleaved batches: the same runner/GC phase lands on both trees.
    expect(median(ratios(kind))).toBeLessThanOrEqual(2);
  }
});
