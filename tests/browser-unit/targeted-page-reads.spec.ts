import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workerModuleUrl = `/@fs${process.cwd()}/tests/browser-unit/fixtures/targeted-page-reads-worker.ts?worker&url`;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

test('I4 real page requests read only their entry at Tracker scale', async ({ page }) => {
  await gotoHarness(page);
  const results = [];
  for (const scale of ['small', 'tracker'] as const) {
    results.push(
      await page.evaluate(
        async ({ moduleUrl, scale }) => {
          const { default: url } = await import(/* @vite-ignore */ moduleUrl);
          const worker = new Worker(url, { type: 'module' });
          try {
            return await new Promise<{
              entryCount: number;
              timings: Record<string, number[]>;
              reads: Record<string, string[]>;
              isolated: boolean;
              fileVersion: string;
              edited: {
                ownerEpoch: string;
                ok: boolean;
                entry: { version: string; content: Uint8Array };
              };
              directory: { ok: boolean; entries: { kind: string }[] };
            }>((resolve, reject) => {
              worker.onmessage = ({ data }) =>
                data.ok ? resolve(data.result) : reject(new Error(data.error));
              worker.onerror = (event) => reject(new Error(event.message));
              worker.postMessage(scale);
            });
          } finally {
            worker.terminate();
          }
        },
        { moduleUrl: workerModuleUrl, scale },
      ),
    );
  }
  const [small, tracker] = results;
  if (!small || !tracker) throw new Error('missing measurements');
  console.log(
    'I4 page read medians',
    JSON.stringify(
      results.map((r) => ({
        entries: r.entryCount,
        file: median(r.timings.file!),
        directory: median(r.timings.directory!),
        fileReads: r.reads.file!.length,
        directoryReads: r.reads.directory!.length,
      })),
    ),
  );
  expect(small.entryCount).toBe(521);
  expect(tracker.entryCount).toBeGreaterThan(17_000);
  for (const r of results) {
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
    expect(median(tracker.timings[kind]!)).toBeLessThanOrEqual(1);
    expect(median(tracker.timings[kind]!)).toBeLessThanOrEqual(2 * median(small.timings[kind]!));
  }
});
