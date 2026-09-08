import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';
import type { bakeApplicationPackage } from './fixtures/snapshot-application-package.ts';
import type {
  LegacyReceiptInput,
  ReceiptPaused,
  ReceiptRecovered,
  ReceiptSeed,
  ReceiptTreeEntry,
} from './fixtures/workbench-legacy-receipt-worker.ts';

const workerModuleUrl = `/@fs${process.cwd().replaceAll('\\', '/')}/tests/browser-unit/fixtures/workbench-legacy-receipt-worker.ts?worker&url`;
const journalFile = '/.rifty/workbench/playground/migration-journal.json';
const transactionFile = '/.rifty/workbench/playground/transaction.json';
const projectRoot = '/.rifty/workbench/v1/projects/legacy-target/tree';
const legacyPrefix = '/workspaces/legacy_receipt_opfs';
const siblingRoot = `${legacyPrefix}/projects/legacy-pending`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let snapshot: Awaited<ReturnType<typeof bakeApplicationPackage>>;

test.beforeAll(() => {
  snapshot = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./fixtures/snapshot-application-package.ts', import.meta.url)),
      ],
      { encoding: 'utf8', timeout: 30_000 },
    ),
  );
});

function bytes(tree: readonly ReceiptTreeEntry[], path: string): readonly number[] {
  const row = tree.find((entry) => entry.path === path);
  expect(row?.kind, path).toBe('file');
  expect(row?.bytes, path).toBeDefined();
  return row?.bytes ?? [];
}

for (const boundary of ['before-close', 'after-close'] as const) {
  test(`legacy adopted receipt: OPFS kill ${boundary} retirement`, async ({ page }) => {
    await gotoHarness(page);
    const result = await page.evaluate(
      async ({ workerModuleUrl, input }) => {
        const module = (await import(/* @vite-ignore */ workerModuleUrl)) as { default: string };
        const run = async <T>(phase: LegacyReceiptInput['phase']): Promise<T> => {
          const worker = new Worker(module.default, { type: 'module' });
          try {
            const response = new Promise<T>((resolve, reject) => {
              worker.addEventListener(
                'message',
                (event: MessageEvent<{ ok: true; result: T } | { ok: false; error: string }>) => {
                  if (event.data.ok) resolve(event.data.result);
                  else reject(new Error(event.data.error));
                },
                { once: true },
              );
              worker.addEventListener('error', (event) => reject(new Error(event.message)), {
                once: true,
              });
            });
            worker.postMessage({ ...input, phase });
            return await response;
          } finally {
            // Victim's native close remains paused; it cannot race past this kill.
            worker.terminate();
          }
        };
        const seed = await run<ReceiptSeed>('seed');
        const paused = await run<ReceiptPaused>('victim');
        const fresh = await run<ReceiptRecovered>('verify');
        return { seed, paused, fresh };
      },
      { workerModuleUrl, input: { ...snapshot, boundary } },
    );

    expect(result.seed.phase).toBe('seed');
    expect(result.paused.phase).toBe('paused');
    expect(result.paused.boundary).toBe(boundary);
    expect(result.fresh.phase).toBe('verify');
    const assetUrl = new URL('/snapshot-ms.tar.gz', page.url()).href;
    expect(result.seed.requests).toEqual([assetUrl]);
    expect(result.paused.requests).toEqual([assetUrl]);
    expect(result.fresh.requests).toEqual([]);
    expect(result.fresh.acquisition).toMatchObject({
      kind: 'ready',
      provenance: { outcome: 'existing' },
    });
    expect(result.fresh.transactionPresent).toBe(false);
    expect(result.paused.before.some((row) => row.path === transactionFile)).toBe(false);

    // Independently derive the sole permitted durable change from the real old receipt.
    expect(bytes(result.paused.before, journalFile)).toEqual(result.seed.receipt);
    const oldJournal = JSON.parse(decoder.decode(new Uint8Array(result.seed.receipt))) as {
      refs: { id: string; phase: { kind: string } }[];
    };
    expect(oldJournal.refs).toHaveLength(2);
    expect(oldJournal.refs.find((ref) => ref.id === 'legacy-target')?.phase.kind).toBe('adopted');
    expect(oldJournal.refs.find((ref) => ref.id === 'legacy-pending')?.phase.kind).toBe('pending');
    const retiredJournal = {
      ...oldJournal,
      refs: oldJournal.refs.filter((ref) => ref.id !== 'legacy-target'),
    };
    const expectedJournal =
      boundary === 'before-close'
        ? result.seed.receipt
        : [...encoder.encode(`${JSON.stringify(retiredJournal, null, 2)}\n`)];
    const expected = result.paused.before.map((row) =>
      row.path === journalFile ? { ...row, bytes: expectedJournal } : row,
    );
    expect(result.fresh.beforeOpen).toEqual(expected);
    expect(result.fresh.recovered).toEqual(expected);
    expect(result.fresh.current).toEqual(expected);

    expect(
      decoder.decode(
        new Uint8Array(bytes(result.fresh.current, `${projectRoot}/node_modules/ms/index.js`)),
      ),
    ).toBe('module.exports = () => "retained before retirement";\n');
    expect(
      bytes(result.fresh.current, `${projectRoot}/node_modules/.rifty-install-stamp.json`).length,
    ).toBeGreaterThan(0);
    expect(bytes(result.fresh.current, `${siblingRoot}/user.bin`)).toEqual([0, 129, 255, 17]);
    expect(bytes(result.fresh.current, `${siblingRoot}/node_modules/ms/local.txt`)).toEqual([
      ...encoder.encode('retained local dependency\n'),
    ]);
    expect(bytes(result.fresh.current, `${legacyPrefix}/.rifty-project-index.json`)).toEqual(
      bytes(result.paused.before, `${legacyPrefix}/.rifty-project-index.json`),
    );
    expect(
      result.fresh.current.some((row) =>
        row.path.startsWith('/.rifty/workbench/v1/projects/legacy-pending'),
      ),
    ).toBe(false);
    console.log(
      '[legacy-receipt-opfs]',
      JSON.stringify({
        boundary,
        snapshotRequests: result.paused.requests.length,
        reopenedRequests: result.fresh.requests.length,
        exactPreservedEntries: expected.length,
        remainingRefs: boundary === 'before-close' ? 2 : 1,
      }),
    );
  });
}
