import { expect, test } from '@playwright/test';
import {
  attemptBootOwner,
  bootOwner,
  closeOwner,
  flushOwnerDurable,
  gotoHarness,
  readOwnerFile,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';
import {
  denyNamespaceProofWrites,
  encoded,
  nativeRootNames,
  outsideBytes,
  readNativeFiles,
  seedNamespaceOrigin,
} from './fixtures/opfs-storage-namespace.ts';

const markerPath = '/.rifty/workbench/v1/projects/scratch/tree/marker.txt';

for (const persistence of ['required', 'preferred'] as const) {
  test(`public ${persistence} owner uses selected namespace and reopens A/B/default independently`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await gotoHarness(page);
    await seedNamespaceOrigin(page);
    const options = {
      workspaceId: 'namespace-owner',
      template: 'hidden-empty',
      persistence,
    } as const;
    const open = async (namespace?: string) => {
      await bootOwner(page, { ...options, ...(namespace === undefined ? {} : { namespace }) });
      expect(
        await page.evaluate(async (url) => {
          const fixture = await import(/* @vite-ignore */ url);
          return fixture.currentWorkbench().snapshot().storage;
        }, sealedWorkbenchFixtureUrl),
      ).toEqual({ policy: persistence, backend: 'opfs', durability: 'durable' });
    };
    try {
      await open();
      await writeOwnerFile(page, '/scratch/marker.txt', 'default-owner');
      await flushOwnerDurable(page);
      await closeOwner(page);
      await open(' owner-A ');
      expect.soft((await readOwnerFile(page, '/scratch/marker.txt')).ok).toBe(false);
      await writeOwnerFile(page, '/scratch/marker.txt', 'A-owner');
      await flushOwnerDurable(page);
      await closeOwner(page);
      await open('owner-B');
      expect.soft((await readOwnerFile(page, '/scratch/marker.txt')).ok).toBe(false);
      await writeOwnerFile(page, '/scratch/marker.txt', 'B-owner');
      await flushOwnerDurable(page);
      // Drop the page/Worker without cooperative close after the durability acknowledgement.
      await page.reload();
      await open(' owner-A ');
      expect
        .soft(await readOwnerFile(page, '/scratch/marker.txt'))
        .toEqual({ ok: true, text: 'A-owner', error: '' });
      await closeOwner(page);
      await open('owner-B');
      expect(await readOwnerFile(page, '/scratch/marker.txt')).toEqual({
        ok: true,
        text: 'B-owner',
        error: '',
      });
      await closeOwner(page);
      await open();
      expect
        .soft(await readOwnerFile(page, '/scratch/marker.txt'))
        .toEqual({ ok: true, text: 'default-owner', error: '' });
      await closeOwner(page);
      expect
        .soft(
          await readNativeFiles(page, [
            markerPath,
            `/ owner-A ${markerPath}`,
            `/owner-B${markerPath}`,
            '/outside-sentinel.bin',
          ]),
        )
        .toEqual({
          [markerPath]: encoded('default-owner'),
          [`/ owner-A ${markerPath}`]: encoded('A-owner'),
          [`/owner-B${markerPath}`]: encoded('B-owner'),
          '/outside-sentinel.bin': outsideBytes,
        });
    } finally {
      await closeOwner(page);
    }
  });
}

test('valid ephemeral namespace creates no OPFS directory or persistent owner payload', async ({
  page,
}) => {
  await gotoHarness(page);
  await seedNamespaceOrigin(page);
  const before = await nativeRootNames(page);
  try {
    await bootOwner(page, {
      workspaceId: 'namespace-ephemeral',
      persistence: 'ephemeral',
      namespace: ' ephemeral-unused ',
    });
    expect(
      await page.evaluate(async (url) => {
        const fixture = await import(/* @vite-ignore */ url);
        return fixture.currentWorkbench().snapshot().storage;
      }, sealedWorkbenchFixtureUrl),
    ).toEqual({ policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' });
    await writeOwnerFile(page, '/scratch/marker.txt', 'memory-only');
    expect(await readOwnerFile(page, '/scratch/marker.txt')).toEqual({
      ok: true,
      text: 'memory-only',
      error: '',
    });
    await closeOwner(page);
    expect(await nativeRootNames(page)).toEqual(before);
    expect(await readNativeFiles(page, [markerPath, '/outside-sentinel.bin'])).toEqual({
      [markerPath]: null,
      '/outside-sentinel.bin': outsideBytes,
    });
  } finally {
    await closeOwner(page);
  }
});

test('required owner refuses a namespace occupied by a native file without changing it', async ({
  page,
}) => {
  await gotoHarness(page);
  await seedNamespaceOrigin(page);
  const before = await nativeRootNames(page);
  try {
    const attempt = await attemptBootOwner(page, {
      workspaceId: 'namespace-file-conflict',
      persistence: 'required',
      namespace: 'blocked',
    });
    expect.soft(attempt.ok).toBe(false);
    await closeOwner(page);
    expect.soft(await nativeRootNames(page)).toEqual(before);
    expect(await readNativeFiles(page, ['/blocked', '/outside-sentinel.bin'])).toEqual({
      '/blocked': encoded('a file must survive root selection'),
      '/outside-sentinel.bin': outsideBytes,
    });
  } finally {
    await closeOwner(page);
  }
});

test('preferred owner falls back to memory on native namespace file conflict and preserves origin', async ({
  page,
}) => {
  await gotoHarness(page);
  await seedNamespaceOrigin(page);
  const before = await nativeRootNames(page);
  try {
    await bootOwner(page, {
      workspaceId: 'namespace-preferred-conflict',
      persistence: 'preferred',
      namespace: 'blocked',
    });
    expect
      .soft(
        await page.evaluate(async (url) => {
          const fixture = await import(/* @vite-ignore */ url);
          return fixture.currentWorkbench().snapshot().storage;
        }, sealedWorkbenchFixtureUrl),
      )
      .toEqual({
        policy: 'preferred',
        backend: 'memory',
        durability: 'ephemeral',
        fallback: { reason: expect.any(String) },
      });
    await writeOwnerFile(page, '/scratch/marker.txt', 'fallback-only');
    expect(await readOwnerFile(page, '/scratch/marker.txt')).toEqual({
      ok: true,
      text: 'fallback-only',
      error: '',
    });
    await closeOwner(page);
    expect.soft(await nativeRootNames(page)).toEqual(before);
    expect
      .soft(await readNativeFiles(page, [markerPath, '/blocked', '/outside-sentinel.bin']))
      .toEqual({
        [markerPath]: null,
        '/blocked': encoded('a file must survive root selection'),
        '/outside-sentinel.bin': outsideBytes,
      });
  } finally {
    await closeOwner(page);
  }
});

for (const persistence of ['required', 'preferred'] as const) {
  test(`${persistence} namespace proof refusal preserves existing roots and permits fresh recovery`, async ({
    page,
  }) => {
    await gotoHarness(page);
    await seedNamespaceOrigin(page);
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const b = await root.getDirectoryHandle('B', { create: true });
      const file = await b.getFileHandle('existing.bin', { create: true });
      const writable = await file.createWritable();
      await writable.write(new Uint8Array([7, 0, 128, 255]));
      await writable.close();
    });
    const paths = [
      '/outside-sentinel.bin',
      '/existing.bin',
      '/A/existing.bin',
      '/B/existing.bin',
      '/blocked',
    ];
    const before = await readNativeFiles(page, paths);
    const rootNames = await nativeRootNames(page);
    const restore = await denyNamespaceProofWrites(page, 'A');
    const options = { workspaceId: 'namespace-proof-fault', namespace: 'A', persistence } as const;
    try {
      const attempt = await attemptBootOwner(page, options);
      if (persistence === 'required') {
        expect.soft(attempt.ok).toBe(false);
        expect
          .soft(attempt.messages.join('\n'))
          .toContain('namespace-proof-denied:A/.rifty/workbench/v1/storage-proof/');
      } else {
        expect(attempt).toEqual({ ok: true, messages: [] });
        expect
          .soft(
            await page.evaluate(async (url) => {
              const fixture = await import(/* @vite-ignore */ url);
              return fixture.currentWorkbench().snapshot().storage;
            }, sealedWorkbenchFixtureUrl),
          )
          .toEqual({
            policy: 'preferred',
            backend: 'memory',
            durability: 'ephemeral',
            fallback: {
              reason: expect.stringContaining(
                'namespace-proof-denied:A/.rifty/workbench/v1/storage-proof/',
              ),
            },
          });
        await writeOwnerFile(page, '/scratch/fallback-only.txt', 'memory-only');
      }
    } finally {
      await closeOwner(page);
      await restore();
    }
    expect.soft(await nativeRootNames(page)).toEqual(rootNames);
    expect(await readNativeFiles(page, paths)).toEqual(before);
    try {
      await bootOwner(page, { ...options, persistence: 'required' });
      expect.soft((await readOwnerFile(page, '/scratch/fallback-only.txt')).ok).toBe(false);
      expect(
        await page.evaluate(async (url) => {
          const fixture = await import(/* @vite-ignore */ url);
          return fixture.currentWorkbench().snapshot().storage;
        }, sealedWorkbenchFixtureUrl),
      ).toEqual({ policy: 'required', backend: 'opfs', durability: 'durable' });
      await writeOwnerFile(page, '/scratch/recovered.txt', 'proof-recovered');
      await flushOwnerDurable(page);
      await closeOwner(page);
      await bootOwner(page, { ...options, persistence: 'required' });
      expect(await readOwnerFile(page, '/scratch/recovered.txt')).toEqual({
        ok: true,
        text: 'proof-recovered',
        error: '',
      });
    } finally {
      await closeOwner(page);
    }
    expect.soft(await nativeRootNames(page)).toEqual(rootNames);
    expect(await readNativeFiles(page, paths)).toEqual(before);
  });
}
