import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withClientServer } from './client-bundle-browser-proof.mjs';

/** Packed public producer/SDK and copied worker; headerless native OPFS throughout. */
export async function provePackedNoCoiSnapshots(
  root,
  profile = 'snapshot',
  registryOrigin = undefined,
) {
  const entry = (await readdir(resolve(root, 'dist/assets'))).find((name) =>
    /^noCoiProject-.*\.js$/u.test(name),
  );
  assert(entry, 'missing packed SDK acceptance entry');
  const metadata = JSON.parse(
    await readFile(resolve(root, `dist/producer-vite-${profile}.json`), 'utf8'),
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
      if (/producer-vite-(?:snapshot|update|frozen)\.tar\.gz/u.test(request.url()))
        snapshots.push(request.url());
    });
    const descriptor = {
      assetUrl: `${base}/dist/producer-vite-${profile}.tar.gz`,
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
    const boot = async (
      page,
      namespace = `packed-sdk-${profile}`,
      fault = undefined,
      registryUrl = undefined,
    ) => {
      await page.goto(base);
      await page.evaluate((entry) => import(entry), `/dist/assets/${entry}`);
      assert.deepEqual(
        await invoke(
          page,
          'boot',
          `${base}/dist/rifty/no-coi-toolchain-worker.js`,
          namespace,
          fault,
          registryUrl,
        ),
        { coi: false, backend: 'opfs' },
      );
    };
    try {
      let page = await context.newPage();
      await boot(page);
      await invoke(page, 'seed');
      await invoke(page, 'seedCache');
      const cacheBefore = await invoke(page, 'cacheTree');
      await invoke(page, 'apply', descriptor);
      if (profile === 'frozen') assert.deepEqual(await invoke(page, 'cacheTree'), cacheBefore);
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
      if (profile === 'frozen') assert.deepEqual(await invoke(page, 'cacheTree'), cacheBefore);
      await invoke(page, 'dispose');
      // Replay keeps the baseline same-page reopen; frozen proves the closed-page reopen (I2).
      if (profile === 'frozen') {
        await page.close();
        page = await context.newPage();
      }
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
      assert.equal((await invoke(page, 'build')).exitCode, 0);
      if (profile === 'frozen') assert.deepEqual(await invoke(page, 'cacheTree'), cacheBefore);
      assert.notEqual(changed.snapshotId, descriptor.snapshotId);
      await assert.rejects(invoke(page, 'apply', changed), /conflict/iu);
      await invoke(page, 'apply', changed, true);
      assert.equal(JSON.parse(await invoke(page, 'read', '/package.json')).version, '1.0.1');
      assert.equal(
        JSON.parse(await invoke(page, 'read', '/node_modules/ms/package.json')).version,
        '2.0.0',
      );
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
      // Upstream Node packages read the saved tree; no legacy adapter needs the lock.
      const invalidLockBuild = await invoke(page, 'build');
      assert.equal(invalidLockBuild.exitCode, 0);
      assert.match(invalidLockBuild.js, /packed-sdk-saved-edit/u);
      assert.equal(await invoke(page, 'read', '/package-lock.json'), '{broken');
      await invoke(page, 'apply', changed, true);
      assert.equal((await invoke(page, 'build')).exitCode, 0);
      await invoke(page, 'dispose');
      await page.close();

      page = await context.newPage();
      await boot(page, `packed-sdk-interrupted-${profile}`, 'hold');
      await invoke(page, 'seed');
      await invoke(page, 'beginApply', descriptor);
      await page.waitForFunction(() => globalThis.packedSdkProject.state().held, undefined, {
        timeout: 60_000,
      });
      assert.deepEqual(await invoke(page, 'state'), { held: true, applyState: 'pending' });
      await page.close();
      page = await context.newPage();
      await boot(page, `packed-sdk-interrupted-${profile}`);
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
      await boot(page, `packed-sdk-quota-${profile}`, 'quota');
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
        `Packed no-COI SDK: Chromium/${browser.version()}, ${profile}, real Vite 7.3.6 apply/build/edit/reopen/force/update/native interruption+quota; zero registry/Eddy requests`,
      );
      if (profile === 'frozen')
        await proveColdFrozenInstall(context, boot, invoke, descriptor, registryOrigin);
    } finally {
      await context.close();
    }
  });
}

/** Cold cache after frozen apply: what the terminal user and the SDK caller read (ADR-0547). */
async function proveColdFrozenInstall(context, boot, invoke, descriptor, registryOrigin) {
  assert(registryOrigin, 'frozen cold-install proof needs the packed registry');
  const registryRequests = [];
  const page = await context.newPage();
  context.on('request', (request) => {
    if (request.url().startsWith(registryOrigin)) registryRequests.push(request.url());
  });
  await boot(page, 'packed-sdk-cold-install-frozen', undefined, registryOrigin);
  await invoke(page, 'seed');
  await invoke(page, 'apply', descriptor);
  const lock = JSON.parse(await invoke(page, 'read', '/package-lock.json')).packages;
  const trigger = lock['node_modules/esbuild'];
  const substitute = `esbuild-wasm@${lock['node_modules/esbuild-wasm'].version}`;
  const expected = [
    `EBROKENLOCK: package-lock.json installs esbuild@${trigger.version} from its substitute ${substitute} (shadow recipe ${trigger.riftyShadowRecipe}), but the tarball cache holds no intact ${substitute}.`,
    'Lockfile replay takes substitute bytes only from the tarball cache and never downloads them.',
    'To reinstall this lockfile exactly, restore those bytes to the tarball cache;',
    'or delete package-lock.json and run install again to re-resolve through the registry (installed versions may change).',
  ].join(' ');
  const terminal = await invoke(page, 'terminal', 'npm install');
  assert.equal(terminal.exitCode, 1, terminal.stderr);
  assert.equal(terminal.stderr, `npm: ${expected}\n`);
  const sdk = await invoke(page, 'install', registryOrigin);
  assert.deepEqual(sdk, { ok: false, message: expected });
  assert.deepEqual(
    registryRequests.filter((url) => url.includes('esbuild-wasm')),
    [],
    'substitute bytes are never downloaded',
  );
  await invoke(page, 'dispose');
  await page.close();
  console.log(`Frozen cold-cache install, terminal stderr: ${terminal.stderr.trimEnd()}`);
  console.log(`Frozen cold-cache install, toolchain.install rejection: ${sdk.message}`);
}
