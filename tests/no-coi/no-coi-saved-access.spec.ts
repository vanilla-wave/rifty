import { expect, test } from '@playwright/test';

const root = process.cwd().replaceAll('\\', '/');
for (const state of ['missing', 'pending', 'legacy', 'corrupt-lock', 'missing-lock'] as const) {
  test(`ordinary saved access ignores ${state} installation proof`, async ({ page, context }) => {
    const requests: string[] = [];
    context.on('request', (request) => {
      if (/unused-registry|eddy/.test(request.url())) requests.push(request.url());
    });
    await page.goto('/no-coi-harness.html');
    const result = await page.evaluate(
      async ({ root, state }) => {
        const namespace = await (await navigator.storage.getDirectory()).getDirectoryHandle(
          'saved-access',
          { create: true },
        );
        const project = await namespace.getDirectoryHandle('project', { create: true });
        const write = async (
          directory: FileSystemDirectoryHandle,
          name: string,
          content: string,
        ) => {
          const writer = await (
            await directory.getFileHandle(name, { create: true })
          ).createWritable();
          await writer.write(content);
          await writer.close();
        };
        await write(project, 'local.cjs', 'module.exports = 6 * 7;');
        await write(
          project,
          'package.json',
          '{"name":"saved-access","dependencies":{"absent":"1.0.0"}}',
        );
        if (state !== 'missing-lock')
          await write(
            project,
            'package-lock.json',
            state === 'corrupt-lock' ? '{broken' : '{"lockfileVersion":3,"packages":{}}',
          );
        if (state === 'pending' || state === 'legacy') {
          const dependencies = await project.getDirectoryHandle('node_modules', { create: true });
          await write(
            dependencies,
            '.rifty-install-stamp.json',
            JSON.stringify({
              version: state === 'legacy' ? 3 : 4,
              durability: 'pending',
              epoch: 'interrupted',
            }),
          );
        }
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
