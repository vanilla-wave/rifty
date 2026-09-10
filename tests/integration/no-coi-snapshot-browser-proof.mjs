import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withClientServer } from './client-bundle-browser-proof.mjs';

/** Packed public producer/SDK and copied worker; headerless native OPFS throughout. */
export async function provePackedNoCoiSnapshots(root) {
  const entry = (await readdir(resolve(root, 'dist/assets'))).find((name) =>
    /^noCoiProject-.*\.js$/u.test(name),
  );
  assert(entry, 'missing packed SDK acceptance entry');
  const metadata = JSON.parse(
    await readFile(resolve(root, 'dist/producer-vite-snapshot.json'), 'utf8'),
  );
  const update = JSON.parse(
    await readFile(resolve(root, 'dist/producer-vite-update.json'), 'utf8'),
  );
  await withClientServer(root, async (browser, base) => {
    const context = await browser.newContext();
    const acquisition = [];
    const snapshots = [];
    context.on('request', (request) => {
      if (/npm-registry|registry\.npmjs|eddy/iu.test(request.url()))
        acquisition.push(request.url());
      if (/producer-vite-(?:snapshot|update)\.tar\.gz/u.test(request.url()))
        snapshots.push(request.url());
    });
    const descriptor = {
      assetUrl: `${base}/dist/producer-vite-snapshot.tar.gz`,
      snapshotId: metadata.snapshotId,
      templateId: metadata.templateId,
    };
    const changed = {
      assetUrl: `${base}/dist/producer-vite-update.tar.gz`,
      snapshotId: update.snapshotId,
      templateId: update.templateId,
    };
    const invoke = (page, method, ...args) =>
      page.evaluate(async ({ method, args }) => globalThis.packedSdkProject[method](...args), {
        method,
        args,
      });
    const boot = async (page, namespace = 'packed-sdk-project', fault = undefined) => {
      await page.goto(base);
      await page.evaluate((entry) => import(entry), `/dist/assets/${entry}`);
      assert.deepEqual(
        await invoke(
          page,
          'boot',
          `${base}/dist/rifty/no-coi-toolchain-worker.js`,
          namespace,
          fault,
        ),
        { coi: false, backend: 'opfs' },
      );
    };
    try {
      let page = await context.newPage();
      await boot(page);
      await invoke(page, 'seed');
      await invoke(page, 'apply', descriptor);
      let build = await invoke(page, 'build');
      assert.equal(build.exitCode, 0);
      assert.match(build.js, /packed-sdk-initial/u);
      await invoke(
        page,
        'write',
        '/main.js',
        'document.body.textContent = "packed-sdk-saved-edit";',
      );
      const dependency = `${await invoke(page, 'read', '/node_modules/vite/package.json')}\n `;
      await invoke(page, 'write', '/node_modules/vite/package.json', dependency);
      await invoke(page, 'dispose');
      const acquired = snapshots.length;
      await boot(page);
      await invoke(page, 'open');
      assert.equal(snapshots.length, acquired, 'saved open fetched an unused artifact');
      assert.equal(await invoke(page, 'read', '/node_modules/vite/package.json'), dependency);
      build = await invoke(page, 'build');
      assert.equal(build.exitCode, 0);
      assert.match(build.js, /packed-sdk-saved-edit/u);
      await assert.rejects(invoke(page, 'apply', descriptor), /conflict/iu);
      assert.equal(await invoke(page, 'read', '/node_modules/vite/package.json'), dependency);
      await invoke(page, 'apply', descriptor, true);
      assert.notEqual(changed.snapshotId, descriptor.snapshotId);
      await assert.rejects(invoke(page, 'apply', changed), /conflict/iu);
      await invoke(page, 'apply', changed, true);
      assert.equal(JSON.parse(await invoke(page, 'read', '/package.json')).version, '1.0.1');
      build = await invoke(page, 'build');
      assert.equal(build.exitCode, 0);
      assert.match(build.js, /packed-sdk-saved-edit/u);

      await invoke(page, 'write', '/package-lock.json', '{broken');
      await invoke(page, 'dispose');
      await boot(page);
      await invoke(page, 'open');
      const local = await invoke(page, 'evaluate', "require('/project/local.cjs');void 0");
      assert.equal(local.result.ok, true);
      assert.match(local.output, /packed-sdk-independent-source/u);
      await assert.rejects(invoke(page, 'build'), /adapter|esbuild|runtime/iu);
      assert.equal(await invoke(page, 'read', '/package-lock.json'), '{broken');
      await invoke(page, 'apply', changed, true);
      assert.equal((await invoke(page, 'build')).exitCode, 0);
      await invoke(page, 'dispose');
      await page.close();

      page = await context.newPage();
      await boot(page, 'packed-sdk-interrupted', 'hold');
      await invoke(page, 'seed');
      await invoke(page, 'beginApply', descriptor);
      await page.waitForFunction(() => globalThis.packedSdkProject.state().held, undefined, {
        timeout: 60_000,
      });
      assert.deepEqual(await invoke(page, 'state'), { held: true, applyState: 'pending' });
      await page.close();
      page = await context.newPage();
      await boot(page, 'packed-sdk-interrupted');
      await invoke(page, 'open');
      const independent = await invoke(page, 'evaluate', "require('/project/local.cjs');void 0");
      assert.equal(independent.result.ok, true);
      assert.match(independent.output, /packed-sdk-independent-source/u);
      await assert.rejects(invoke(page, 'build'));
      await invoke(page, 'apply', descriptor, true);
      assert.equal((await invoke(page, 'build')).exitCode, 0);
      await invoke(page, 'dispose');
      await page.close();

      page = await context.newPage();
      await boot(page, 'packed-sdk-quota', 'quota');
      await invoke(page, 'seed');
      await assert.rejects(invoke(page, 'apply', descriptor), /persist|quota/iu);
      await invoke(page, 'open');
      assert.equal(
        (await invoke(page, 'evaluate', "require('/project/local.cjs');void 0")).result.ok,
        true,
      );
      await invoke(page, 'dispose');
      await page.close();
      assert.deepEqual(
        acquisition,
        [],
        'SDK snapshot/saved use attempted registry/Eddy acquisition',
      );
      console.log(
        `Packed no-COI SDK: Chromium/${browser.version()}, real Vite 7.3.6 apply/build/edit/reopen/force/update/native interruption+quota; zero registry/Eddy requests`,
      );
    } finally {
      await context.close();
    }
  });
}
