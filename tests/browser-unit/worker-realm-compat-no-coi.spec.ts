import { type Page, expect, test } from '@playwright/test';

const workspacePath = process.cwd().replaceAll('\\', '/');
const compatModuleUrl = `/@fs${workspacePath}/packages/runtime-js/src/ipc/worker-realm-compat.ts`;

async function gotoNoCoiHarness(page: Page): Promise<void> {
  await page.route(/\/unit-harness\.html\?no-coi=1$/, async (route) => {
    const upstream = await route.fetch();
    const headers = Object.fromEntries(
      Object.entries(upstream.headers()).filter(
        ([name]) =>
          name !== 'cross-origin-opener-policy' && name !== 'cross-origin-embedder-policy',
      ),
    );
    await route.fulfill({ response: upstream, headers });
  });

  const response = await page.goto('/unit-harness.html?no-coi=1');
  expect(response).not.toBeNull();
  if (response === null) throw new Error('no-COI harness navigation returned no response');
  const headers = await response.allHeaders();
  expect(headers['cross-origin-opener-policy']).toBeUndefined();
  expect(headers['cross-origin-embedder-policy']).toBeUndefined();
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-coi', 'false');
  expect(
    await page.evaluate(() => ({
      crossOriginIsolated: globalThis.crossOriginIsolated,
      sharedArrayBufferType: typeof globalThis.SharedArrayBuffer,
    })),
  ).toEqual({ crossOriginIsolated: false, sharedArrayBufferType: 'undefined' });
}

test('direct TextDecoder install preserves private decode without SharedArrayBuffer', async ({
  page,
}) => {
  await gotoNoCoiHarness(page);

  const result = await page.evaluate(async (moduleUrl) => {
    const compat = await import(/* @vite-ignore */ moduleUrl);
    const nativeDecode = TextDecoder.prototype.decode;
    let delegateCalls = 0;
    TextDecoder.prototype.decode = function (
      this: TextDecoder,
      input?: AllowSharedBufferSource,
      options?: TextDecodeOptions,
    ): string {
      delegateCalls += 1;
      return nativeDecode.call(this, input, options);
    };
    const before = TextDecoder.prototype.decode;
    const installed = compat.installSharedMemoryTolerantTextDecoder(TextDecoder);
    const afterInstall = TextDecoder.prototype.decode;
    const repeated = compat.installSharedMemoryTolerantTextDecoder(TextDecoder);
    const afterRepeat = TextDecoder.prototype.decode;
    const decoded = new TextDecoder().decode(new Uint8Array([111, 107]));
    return {
      installed,
      identityChanged: afterInstall !== before,
      repeated,
      repeatKeptIdentity: afterRepeat === afterInstall,
      decoded,
      delegateCalls,
    };
  }, compatModuleUrl);

  expect(result).toEqual({
    installed: true,
    identityChanged: true,
    repeated: false,
    repeatKeptIdentity: true,
    decoded: 'ok',
    delegateCalls: 1,
  });
});

test('aggregate realm install keeps sibling shims and private decode without SharedArrayBuffer', async ({
  page,
}) => {
  await gotoNoCoiHarness(page);

  const result = await page.evaluate(async (moduleUrl) => {
    const compat = await import(/* @vite-ignore */ moduleUrl);
    const nativeDecode = TextDecoder.prototype.decode;
    let delegateCalls = 0;
    TextDecoder.prototype.decode = function (
      this: TextDecoder,
      input?: AllowSharedBufferSource,
      options?: TextDecodeOptions,
    ): string {
      delegateCalls += 1;
      return nativeDecode.call(this, input, options);
    };
    const before = TextDecoder.prototype.decode;
    compat.installWorkerRealmCompat();
    const afterInstall = TextDecoder.prototype.decode;
    const selfDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'self');
    const globalAlias = (globalThis as typeof globalThis & { global?: unknown }).global;
    compat.installWorkerRealmCompat();
    const afterRepeat = TextDecoder.prototype.decode;
    const decoded = new TextDecoder().decode(new Uint8Array([111, 107]));
    return {
      identityChanged: afterInstall !== before,
      repeatKeptIdentity: afterRepeat === afterInstall,
      globalIsGlobalThis: globalAlias === globalThis,
      selfIsGlobalThis: globalThis.self === globalThis,
      selfWritable: selfDescriptor?.writable === true,
      decoded,
      delegateCalls,
    };
  }, compatModuleUrl);

  expect(result).toEqual({
    identityChanged: true,
    repeatKeptIdentity: true,
    globalIsGlobalThis: true,
    selfIsGlobalThis: true,
    selfWritable: true,
    decoded: 'ok',
    delegateCalls: 1,
  });
});
