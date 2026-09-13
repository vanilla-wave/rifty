import { expect, test } from '@playwright/test';
import { accessNativeReplica, encoded } from '../browser-unit/fixtures/opfs-storage-namespace.ts';

const root = process.cwd().replaceAll('\\', '/');
for (const state of ['missing', 'pending', 'legacy', 'corrupt-lock', 'missing-lock'] as const) {
  test(`ordinary saved access ignores ${state} installation proof`, async ({ page, context }) => {
    const requests: string[] = [];
    context.on('request', (request) => {
      if (/\/unused-registry(?:\/|$)|\/eddy(?:\/|$)|registry\.npmjs\.org/.test(request.url()))
        requests.push(request.url());
    });
    await page.goto('/no-coi-harness.html');
    const files: Record<string, readonly number[]> = {
      '/project/local.cjs': encoded('module.exports = 6 * 7;'),
      '/project/package.json': encoded('{"name":"saved-access","dependencies":{"absent":"1.0.0"}}'),
    };
    if (state !== 'missing-lock')
      files['/project/package-lock.json'] = encoded(
        state === 'corrupt-lock' ? '{broken' : '{"lockfileVersion":3,"packages":{}}',
      );
    if (state === 'pending' || state === 'legacy')
      files['/project/node_modules/.rifty-install-stamp.json'] = encoded(
        JSON.stringify({
          version: state === 'legacy' ? 3 : 4,
          durability: 'pending',
          epoch: 'interrupted',
        }),
      );
    await accessNativeReplica(page, { namespace: 'saved-access', files });
    const result = await page.evaluate(
      async ({ root }) => {
        const fixture = await import(`/@fs${root}/tests/no-coi/fixtures/no-coi-snapshot-page.ts`);
        await fixture.boot(
          `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          'saved-access',
        );
        try {
          // Existing input shape reaches the former saved-install gate on the baseline.
          await fixture.open('/unused-registry');
          const local = await fixture.evaluate("console.log(require('/project/local.cjs'));void 0");
          const missing = await fixture.evaluate("require('/project/node_modules/absent')");
          return { local, missing, source: await fixture.read('/project/local.cjs') };
        } finally {
          fixture.dispose();
        }
      },
      { root, state },
    );
    expect(result.local).toMatchObject({ result: { ok: true }, output: '42\n' });
    expect(result.missing).toMatchObject({
      result: { ok: false, error: { message: expect.stringMatching(/Cannot find module/) } },
    });
    expect(result.source).toBe('module.exports = 6 * 7;');
    expect(requests).toEqual([]);
  });
}
