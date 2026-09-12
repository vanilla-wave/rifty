import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';
import {
  encoded,
  outsideBytes,
  readNativeFiles,
  runNamespaceWorker,
  seedNamespaceOrigin,
} from './fixtures/opfs-storage-namespace.ts';

test('selected native handle bounds both OPFS surfaces across A/B/default reopen', async ({
  page,
  browser,
}) => {
  await gotoHarness(page);
  await seedNamespaceOrigin(page);
  const defaults = await runNamespaceWorker(page, {});
  const a = await runNamespaceWorker(page, { namespace: 'A', write: 'A-write' });
  const b = await runNamespaceWorker(page, { namespace: 'B', write: 'B-write' });
  await page.reload();
  const reopened = await runNamespaceWorker(page, { namespace: 'A' });
  const returnedDefault = await runNamespaceWorker(page, {});
  const physical = await readNativeFiles(page, [
    '/outside-sentinel.bin',
    '/existing.bin',
    '/roundtrip.bin',
    '/A/roundtrip.bin',
    '/B/roundtrip.bin',
    '/A/async.bin',
    '/A/outside-sentinel.bin',
    '/B/outside-sentinel.bin',
  ]);
  console.log(
    `[opfs-namespace] Chrome/${browser.version()} ${JSON.stringify({ defaults, a, b, reopened, returnedDefault, physical })}`,
  );
  for (const result of [defaults, a, b, reopened, returnedDefault]) {
    expect(result.ok).toBe(true);
    if (!result.ok || !('mount' in result)) throw new Error('Native mount failed');
  }
  expect.soft(defaults).toMatchObject({
    mount: { before: { existing: encoded('default-existing'), outside: outsideBytes } },
  });
  expect.soft(a).toMatchObject({
    mount: {
      before: { roots: ['existing.bin'], existing: encoded('A-existing'), outside: null },
      persisted: encoded('A-write'),
      asyncRead: encoded('async:A-write'),
    },
  });
  if (a.ok && 'mount' in a) {
    expect.soft(a.mount.preloadReadNames).not.toContain('outside-sentinel.bin');
  }
  expect.soft(b).toMatchObject({
    mount: { before: { roots: [], prior: null, cache: null, outside: null, existing: null } },
  });
  expect.soft(reopened).toMatchObject({
    mount: { before: { prior: encoded('A-write'), cache: encoded('cache:A-write') } },
  });
  expect.soft(returnedDefault).toMatchObject({
    mount: {
      before: { existing: encoded('default-existing'), prior: null, outside: outsideBytes },
    },
  });
  expect.soft(physical).toEqual({
    '/outside-sentinel.bin': outsideBytes,
    '/existing.bin': encoded('default-existing'),
    '/roundtrip.bin': null,
    '/A/roundtrip.bin': encoded('A-write'),
    '/B/roundtrip.bin': encoded('B-write'),
    '/A/async.bin': encoded('async:A-write'),
    '/A/outside-sentinel.bin': encoded('inside:A-write'),
    '/B/outside-sentinel.bin': encoded('inside:B-write'),
  });
});

test('native file conflict refuses directory selection and preserves original bytes', async ({
  page,
}) => {
  await gotoHarness(page);
  await seedNamespaceOrigin(page);
  const result = await runNamespaceWorker(page, { namespace: 'blocked', write: 'must-not-land' });
  expect(result).toMatchObject({ ok: false, name: 'TypeMismatchError' });
  expect(
    await readNativeFiles(page, ['/blocked', '/roundtrip.bin', '/outside-sentinel.bin']),
  ).toEqual({
    '/blocked': encoded('a file must survive root selection'),
    '/roundtrip.bin': null,
    '/outside-sentinel.bin': outsideBytes,
  });
});

test('an initialized async OPFS instance refuses switching its captured native root', async ({
  page,
}) => {
  await gotoHarness(page);
  await seedNamespaceOrigin(page);
  expect(await runNamespaceWorker(page, { mode: 'reinit' })).toEqual({
    ok: true,
    reinit: { refused: true, existing: encoded('A-existing') },
  });
});
