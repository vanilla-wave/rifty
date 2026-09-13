import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import type { PublicScaleProof, ScaleOpening } from './fixtures/replica-public-scale-client.ts';
import {
  createPublicScaleFixture,
  installLine,
  scaleNamespace,
} from './fixtures/replica-public-scale-fixture.ts';

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
test('public T open, real npm writes and new offline Chromium processes preserve executable state', async () => {
  test.setTimeout(360000);
  const directory = await mkdtemp(join(tmpdir(), 'rifty-public-scale-'));
  const fixture = await createPublicScaleFixture(directory);
  const records: { sample: number; kind: string; opening: ScaleOpening; writes?: number }[] = [];
  try {
    for (let sample = 0; sample < 3; sample++) {
      const profile = join(directory, `profile-${sample}`);
      await mkdir(profile);
      for (const kind of ['first', 'offline', 'install', 'offline-installed']) {
        const offline = kind.startsWith('offline');
        fixture.setOffline(offline);
        // Both Chromium networking and the physical server refuse online work.
        const context = await chromium.launchPersistentContext(profile, { headless: true });
        try {
          await context.setOffline(offline);
          const page = await context.newPage();
          const acquisitions: string[] = [];
          context.on('request', (request) => {
            const path = new URL(request.url()).pathname;
            if (path.startsWith('/registry/') || path === '/snapshot.tar.gz')
              acquisitions.push(path);
          });
          await page.goto(fixture.url);
          await page.waitForFunction(() =>
            Boolean(
              (globalThis as unknown as { replicaPublicProof?: PublicScaleProof })
                .replicaPublicProof,
            ),
          );
          const opening = await page.evaluate(
            (first) =>
              (
                globalThis as unknown as { replicaPublicProof: PublicScaleProof }
              ).replicaPublicProof.open(first),
            kind === 'first',
          );
          const run = (line: string) =>
            page.evaluate(
              (line) =>
                (
                  globalThis as unknown as { replicaPublicProof: PublicScaleProof }
                ).replicaPublicProof.run(line),
              line,
            );
          const installed = kind === 'offline-installed';
          expect(await run(`node main.cjs${installed ? ' --installed' : ''}`)).toEqual({
            exit: 0,
            out: fixture.oracle[`${kind === 'first' ? 'initial' : 'edited'}:${installed}`],
          });
          expect(await run('node verify.cjs')).toEqual({
            exit: 0,
            out: '{"files":15568,"bytes":73637414}\n',
          });
          if (kind === 'first')
            await page.evaluate(() =>
              (
                globalThis as unknown as { replicaPublicProof: PublicScaleProof }
              ).replicaPublicProof.edit(),
            );
          let writes: number | undefined;
          if (kind === 'install') {
            await page.evaluate(() =>
              (
                globalThis as unknown as { replicaPublicProof: PublicScaleProof }
              ).replicaPublicProof.measure('reset'),
            );
            const install = await run(installLine);
            expect(install.exit, install.out).toBe(0);
            const metrics = await page.evaluate(() =>
              (
                globalThis as unknown as { replicaPublicProof: PublicScaleProof }
              ).replicaPublicProof.measure('get'),
            );
            writes = metrics.writes;
            expect(writes).toBeGreaterThanOrEqual(5000);
            expect(await run('node main.cjs --installed')).toEqual({
              exit: 0,
              out: fixture.oracle['edited:true'],
            });
            expect(await run('node verify.cjs')).toEqual({
              exit: 0,
              out: '{"files":15568,"bytes":73637414}\n',
            });
          }
          if (offline) expect(acquisitions).toEqual([]);
          const nativeNames = await page.evaluate(async (namespace) => {
            const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(
              namespace,
            );
            const names: string[] = [];
            for await (const [name] of root.entries()) names.push(name);
            return names.sort();
          }, scaleNamespace);
          expect(nativeNames).toEqual(['.rifty-replica-v1']);
          records.push({ sample, kind, opening, ...(writes === undefined ? {} : { writes }) });
          await page.evaluate(() =>
            (
              globalThis as unknown as { replicaPublicProof: PublicScaleProof }
            ).replicaPublicProof.close(),
          );
        } finally {
          await context.close();
        }
      }
    }
    console.log('public replica reference', JSON.stringify({ node: fixture.nodeVersion, records }));
    // Sum of all awaited owner flushes is an upper bound on the named first-open tail.
    expect(
      median(
        records
          .filter((r) => r.kind === 'first')
          .map((r) => r.opening.metrics.flushes.reduce((sum, n) => sum + n, 0)),
      ),
    ).toBeLessThanOrEqual(2000);
    // Workbench boot joins complete eager replay plus owner startup. Session execution
    // and full T enumeration above independently prove readiness after that boundary.
    for (const kind of ['offline', 'offline-installed'])
      expect(
        median(records.filter((r) => r.kind === kind).map((r) => r.opening.bootMs)),
      ).toBeLessThanOrEqual(2000);
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
