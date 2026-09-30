import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { bakeApplicationPackage } from '../browser-unit/fixtures/snapshot-application-package.ts';
import { type Page, expect, test } from './fixtures/test.ts';
const root = process.cwd().replaceAll('\\', '/');
const fixture = `/@fs${root}/tests/no-coi/fixtures/no-coi-snapshot-page.ts`;
let snapshot: Awaited<ReturnType<typeof bakeApplicationPackage>>;
let chunkedUrl: string;
const server = createServer((_request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  const bytes = Buffer.from(snapshot.archive);
  response.write(bytes.subarray(0, 128));
  response.end(bytes.subarray(128));
});
test.beforeAll(async () => {
  snapshot = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(
          new URL('../browser-unit/fixtures/snapshot-application-package.ts', import.meta.url),
        ),
      ],
      { encoding: 'utf8', timeout: 30_000 },
    ),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
  chunkedUrl = `http://127.0.0.1:${address.port}/snapshot`;
});
test.afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);
async function invoke<T = unknown>(page: Page, method: string, args: unknown[] = []): Promise<T> {
  return page.evaluate(
    async ({ fixture, method, args }) =>
      Reflect.get(await import(/* @vite-ignore */ fixture), method)(...args),
    { fixture, method, args },
  );
}
async function boot(page: Page, fault?: string) {
  await page.goto('/no-coi-harness.html');
  await invoke(page, 'boot', [
    fault
      ? `/@fs${root}/tests/no-coi/fixtures/no-coi-snapshot-fault-worker.ts?fault=${fault}`
      : `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
  ]);
}
interface Progress {
  type: string;
  operation: string;
  id: number;
  phase: string;
  bytes?: number;
  total?: number;
  written?: number;
  persisted?: number;
}
const descriptor = () => ({
  assetUrl: '/kit-snapshot',
  snapshotId: snapshot.snapshotId,
  templateId: 'opfs-ms',
});
for (const transport of ['declared', 'encoded', 'chunked'] as const) {
  const encoded = transport === 'encoded';
  test(`snapshot real bytes, applied entries and native flush counts; transport=${transport}`, async ({
    page,
    context,
  }) => {
    await context.route('**/kit-snapshot', (route) =>
      route.fulfill({
        body: Buffer.from(snapshot.archive),
        headers: {
          'content-length': String(snapshot.archive.length),
          ...(encoded ? { 'content-encoding': 'gzip' } : {}),
        },
      }),
    );
    await boot(page);
    try {
      const input = {
        ...descriptor(),
        ...(transport === 'chunked' ? { assetUrl: chunkedUrl } : {}),
      };
      await invoke(page, 'apply', [input]);
      const events = await invoke<Progress[]>(page, 'takeProgress');
      const fetches = events.filter((e) => e.phase === 'fetch');
      expect(fetches.length).toBeGreaterThan(0);
      expect(fetches.at(-1)?.bytes).toBe(
        encoded ? gunzipSync(Buffer.from(snapshot.archive)).length : snapshot.archive.length,
      );
      for (const event of fetches)
        expect(event.total).toBe(transport === 'declared' ? snapshot.archive.length : undefined);
      const entries = events.filter((e) => e.phase === 'entries');
      const native = await invoke<string[]>(page, 'nativePayloadEntries');
      expect(entries.at(-1)).toMatchObject({ written: native.length, total: native.length });
      for (const phase of ['flush-cache', 'flush-payload']) {
        const flushes = events.filter((e) => e.phase === phase);
        expect(flushes.length).toBeGreaterThan(0);
        expect(flushes.at(-1)?.persisted).toBe(flushes.at(-1)?.total);
        expect(flushes.at(-1)?.total).toBeGreaterThan(0);
      }
      expect(events.every((e) => e.type === 'progress' && e.operation === 'snapshot')).toBe(true);
      expect(new Set(events.map((e) => e.id)).size).toBe(1);
      // Same bytes are admitted; zero writes must not replay a prior operation's counts.
      await invoke(page, 'apply', [input]);
      const same = await invoke<Progress[]>(page, 'takeProgress');
      expect(same[0]?.id).not.toBe(events[0]?.id);
      expect(same.filter((e) => e.phase === 'entries').at(-1)).toMatchObject({
        written: 0,
        total: 0,
      });
    } finally {
      await invoke(page, 'dispose');
    }
  });
}
for (const fault of [
  'wrong-id',
  'wrong-template',
  'incompatible-runtime',
  'corrupt',
  'malformed',
  'missing',
  'conflict',
  'quota',
  'resident',
] as const) {
  test(`snapshot ${fault} root discriminator preserves the actual failure`, async ({
    page,
    context,
  }) => {
    await context.route('**/kit-snapshot', (route) =>
      route.fulfill({
        status: fault === 'missing' ? 404 : 200,
        body:
          fault === 'corrupt'
            ? 'corrupt'
            : Buffer.from(
                fault === 'incompatible-runtime'
                  ? snapshot.incompatible.archive
                  : fault === 'malformed'
                    ? snapshot.malformed.archive
                    : snapshot.archive,
              ),
      }),
    );
    await boot(page, fault === 'quota' ? 'quota' : undefined);
    try {
      if (fault === 'conflict')
        await invoke(page, 'write', ['/project/package.json', '{"saved":true}']);
      if (fault === 'resident') await invoke(page, 'startLocalServer');
      const input = {
        ...descriptor(),
        ...(fault === 'wrong-id' ? { snapshotId: `sha256:${'0'.repeat(64)}` } : {}),
        ...(fault === 'wrong-template' ? { templateId: 'wrong' } : {}),
        ...(fault === 'incompatible-runtime'
          ? { snapshotId: snapshot.incompatible.snapshotId }
          : {}),
        ...(fault === 'malformed' ? { snapshotId: snapshot.malformed.snapshotId } : {}),
      };
      const outcome = await invoke<{ kind?: string; name?: string; message?: string }>(
        page,
        'applyOutcome',
        [input],
      );
      expect(outcome.name).toBeTruthy();
      expect(outcome.kind).toBe(
        fault === 'conflict'
          ? 'snapshot-conflict'
          : fault === 'quota'
            ? 'persistence'
            : fault === 'resident'
              ? 'resident-busy'
              : fault === 'missing' || fault === 'malformed'
                ? undefined
                : 'snapshot-mismatch',
      );
      const events = await invoke<Progress[]>(page, 'takeProgress');
      if (fault !== 'quota')
        expect(events.filter((e) => e.phase === 'entries' || e.phase.startsWith('flush-'))).toEqual(
          [],
        );
      else {
        expect(events.some((e) => e.phase === 'entries')).toBe(true);
        expect(
          events
            .filter((e) => e.phase === 'flush-payload')
            .some((e) => e.persisted === e.total && (e.total ?? 0) > 0),
        ).toBe(false);
      }
      if (fault === 'conflict')
        expect(await invoke(page, 'read', ['/project/package.json'])).toBe('{"saved":true}');
    } finally {
      await invoke(page, 'dispose');
    }
  });
}
