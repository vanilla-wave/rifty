import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';
import {
  messagePortKeepaliveCases,
  messagePortRows,
} from './fixtures/message-port-keepalive-cases.ts';
import { nativeWorkerLifecycle } from './fixtures/worker-lifecycle-oracle.ts';

for (const fixture of messagePortKeepaliveCases) {
  test(`MessagePort keepalive: ${fixture.name}`, async ({ page }) => {
    const oracle = await nativeWorkerLifecycle(fixture);
    expect(oracle.code).toBe(0);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-port-${fixture.name}`,
      hiddenEmptyBoot: true,
      persistence: 'ephemeral',
    });
    try {
      await writeOwnerFile(page, '/scratch/child.cjs', fixture.child);
      await writeOwnerFile(page, '/scratch/main.cjs', fixture.parent);
      const result = await page.evaluate(async (fixtureUrl) => {
        const fixture = await import(/* @vite-ignore */ fixtureUrl);
        const terminal = fixture.currentProject().terminals.open();
        let output = '';
        const detach = terminal.attach((chunk: string) => {
          output += chunk;
        });
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const run = terminal.run('node main.cjs');
          const outcome = await Promise.race([
            run.exited.then((exit: { code: number | null; signal: string | null }) => ({
              timedOut: false,
              exit,
            })),
            new Promise<{ timedOut: true; exit: null }>((resolve) => {
              timeout = setTimeout(() => resolve({ timedOut: true, exit: null }), 6_000);
            }),
          ]);
          await terminal.close();
          return { ...outcome, output, coi: crossOriginIsolated };
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
          detach();
          await terminal.close();
        }
      }, sealedWorkbenchFixtureUrl);
      expect(result.coi).toBe(true);
      expect(result.timedOut, result.output).toBe(false);
      expect(result.exit, result.output).toEqual({ code: oracle.code, signal: null });
      expect(messagePortRows(result.output)).toEqual(messagePortRows(oracle.stdout));
    } finally {
      await closeOwner(page);
    }
  });
}

test('managed MessagePort transfer has a named ceiling without detaching ArrayBuffer companions', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-port-transfer-ceiling',
    hiddenEmptyBoot: true,
    persistence: 'ephemeral',
  });
  try {
    await writeOwnerFile(
      page,
      '/scratch/main.cjs',
      `
const {port1: managed, port2: peer} = new MessageChannel();
const {port1: sender, port2: receiver} = new MessageChannel();
managed.ref();
const outcomes = [];
for (const send of [
  (buffer) => sender.postMessage({port: managed, buffer}, [managed, buffer]),
  (buffer) => structuredClone({port: managed, buffer}, {transfer: [managed, buffer]}),
]) {
  const buffer = new ArrayBuffer(4);
  try { send(buffer); outcomes.push('NO_THROW'); }
  catch (error) { outcomes.push([error.name, error.feature, buffer.byteLength, managed.hasRef()]); }
}
console.log('PORT|transfer=' + JSON.stringify(outcomes));
managed.unref();managed.close();peer.close();sender.close();receiver.close();
`,
    );
    const result = await page.evaluate(async (url) => {
      const fixture = await import(/* @vite-ignore */ url);
      return fixture.executeProjectLine('node main.cjs');
    }, sealedWorkbenchFixtureUrl);
    expect(result.exit, result.out).toBe(0);
    expect(messagePortRows(result.out)).toEqual([
      `PORT|transfer=${JSON.stringify(
        Array.from({ length: 2 }, () => [
          'NotImplementedError',
          'MessagePort.transfer.managed',
          4,
          true,
        ]),
      )}`,
    ]);
  } finally {
    await closeOwner(page);
  }
});

test('second kernel bundle retains the pinned host channel after the public shim installs', async ({
  page,
}) => {
  await gotoHarness(page);
  const root = `/@fs${process.cwd()}`;
  const result = await page.evaluate(
    async ({ ownerUrl, compatUrl }) => {
      const native = MessageChannel;
      const nativePost = MessagePort.prototype.postMessage;
      const first = await import(/* @vite-ignore */ ownerUrl);
      const original = first.getKernelHostMessageChannel();
      const compat = await import(/* @vite-ignore */ compatUrl);
      compat.installWorkerRealmCompat();
      const publicShim = MessageChannel;
      const secondCompat = await import(/* @vite-ignore */ `${compatUrl}?second-port-compat`);
      secondCompat.installWorkerRealmCompat();
      const second = await import(/* @vite-ignore */ `${ownerUrl}?second-message-port-owner`);
      const repeated = second.getKernelHostMessageChannel();
      const raw = new repeated();
      const publicChannel = new MessageChannel();
      const nativeBrand = await new Promise<boolean>((resolve) => {
        publicChannel.port2.onmessage = (event) => resolve(event.data === 'native-brand');
        nativePost.call(publicChannel.port1, 'native-brand');
      });
      const result = {
        original: original === native,
        retained: repeated === original,
        publicShim: MessageChannel !== original,
        rawNative: raw.port1 instanceof MessagePort,
        installedOnce: MessageChannel === publicShim,
        nativeBrand,
      };
      raw.port1.close();
      raw.port2.close();
      publicChannel.port1.close();
      publicChannel.port2.close();
      return result;
    },
    {
      ownerUrl: `${root}/packages/kernel/src/shared-globals.ts`,
      compatUrl: `${root}/packages/runtime-js/src/ipc/worker-realm-compat.ts`,
    },
  );
  expect(result).toEqual({
    original: true,
    retained: true,
    publicShim: true,
    rawNative: true,
    installedOnce: true,
    nativeBrand: true,
  });
});
