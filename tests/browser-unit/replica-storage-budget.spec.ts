import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

const moduleUrl = `/@fs${process.cwd()}/tests/browser-unit/fixtures/replica-persistence-worker.ts?worker&url`;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

test('I1/I2/I5 storage boundary on T survives fresh offline processes and 5000 changed paths', async ({
  baseURL,
}) => {
  test.setTimeout(240_000);
  const profile = await mkdtemp(join(tmpdir(), 'rifty-replica-budget-'));
  const records: { sample: number; kind: string; restoreMs: number; flushMs: number }[] = [];
  try {
    for (let sample = 0; sample < 3; sample++) {
      const namespace = `replica-budget-${sample}`;
      for (const kind of ['scale-write', 'scale-read', 'scale-mutate', 'scale-read-mutated']) {
        const context = await chromium.launchPersistentContext(profile, { headless: true });
        try {
          const page = await context.newPage();
          await page.goto(`${baseURL}/unit-harness.html`);
          await page.evaluate(async (url) => {
            const module = await import(/* @vite-ignore */ url);
            const worker = new Worker(module.default, { type: 'module' });
            (globalThis as unknown as { replicaWorker: Worker }).replicaWorker = worker;
            await new Promise<void>((resolve, reject) => {
              worker.onmessage = ({ data }) =>
                data.ok ? resolve() : reject(new Error(data.error));
              worker.onerror = (e) => reject(new Error(e.message));
              worker.postMessage({ kind: 'ping', namespace: '' });
            });
          }, moduleUrl);
          // Bootstrap code is loaded; no persisted-tree read has begun.
          if (kind.startsWith('scale-read')) await context.setOffline(true);
          const result = await page.evaluate(
            (input) =>
              new Promise<{ restoreMs: number; flushMs: number; files: number; bytes: number }>(
                (resolve, reject) => {
                  const worker = (globalThis as unknown as { replicaWorker: Worker }).replicaWorker;
                  worker.onmessage = ({ data }) =>
                    data.ok ? resolve(data.result) : reject(new Error(data.error));
                  worker.onerror = (e) => reject(new Error(e.message));
                  worker.postMessage(input);
                },
              ),
            {
              kind: kind === 'scale-read-mutated' ? 'scale-read' : kind,
              namespace,
              mutated: kind === 'scale-read-mutated',
            },
          );
          expect(result.files).toBe(15568);
          expect(result.bytes).toBe(73637414);
          records.push({ sample, kind, restoreMs: result.restoreMs, flushMs: result.flushMs });
        } finally {
          await context.close();
        }
      }
    }
    console.log('replica native storage samples', JSON.stringify(records));
    expect(
      median(records.filter((r) => r.kind === 'scale-write').map((r) => r.flushMs)),
    ).toBeLessThanOrEqual(2000);
    for (const kind of ['scale-read', 'scale-read-mutated'])
      expect(
        median(records.filter((r) => r.kind === kind).map((r) => r.restoreMs)),
      ).toBeLessThanOrEqual(2000);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
