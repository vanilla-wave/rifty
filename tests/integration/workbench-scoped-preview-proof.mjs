import assert from 'node:assert/strict';

const prefix = '/sandbox/p/';
const hostApi = 'packed host root API\n';
const hostFile = 'packed host static file\n';
const messageSource = (message) => `export const message = ${JSON.stringify(message)};\n`;

async function previewFacts(page) {
  const facts = await page.evaluate(async () => {
    const proof = await window.__RIFTY_PACKED_SCOPED_PREVIEW__;
    return {
      previewUrl: proof.previewUrl,
      buildOutput: proof.buildOutput,
      storage: proof.storage,
      snapshotId: proof.snapshotId,
      applicationMode: proof.applicationMode,
      sources: await proof.readSources(),
      control: await proof.controlProof(),
    };
  });
  assert.match(facts.buildOutput, /built in|build completed/i, 'real scoped Vite build');
  return facts;
}

async function closePreview(page) {
  await page.evaluate(async () => {
    await (await window.__RIFTY_PACKED_SCOPED_PREVIEW__).close();
    document.querySelector('#preview').src = 'about:blank';
  });
}

async function reopenPreview(page, url) {
  await closePreview(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return previewFacts(page);
}

async function hostFacts(page) {
  return page.evaluate(async () => ({
    controller: navigator.serviceWorker.controller?.scriptURL ?? null,
    api: await fetch('/api/collision.txt', { cache: 'no-store' }).then((response) =>
      response.text(),
    ),
    file: await fetch('/host-file.txt', { cache: 'no-store' }).then((response) => response.text()),
    document: document.querySelector('#outside')?.textContent ?? null,
  }));
}

async function guestFacts(page, message) {
  await page.waitForFunction(
    (message) => {
      const document = window.document.querySelector('#preview')?.contentDocument;
      const logo = document?.querySelector('#logo');
      return (
        document?.querySelector('#app')?.textContent === message &&
        document?.querySelector('#api')?.textContent === 'guest root API\n' &&
        document?.querySelector('#chunk')?.textContent === 'guest dynamic chunk' &&
        logo?.complete &&
        logo.naturalWidth === 7
      );
    },
    message,
    { timeout: 120_000 },
  );
  const actual = await page
    .frameLocator('#preview')
    .locator('#app')
    .evaluate(async (app) => {
      const logo = document.querySelector('#logo');
      const main = document.querySelector('script[src*="/src/main.ts"]');
      const style = document.querySelector('link[href*="/src/style.css"]');
      return {
        message: app.textContent,
        color: getComputedStyle(app).color,
        image: [logo.naturalWidth, logo.naturalHeight],
        imagePath: new URL(logo.src).pathname,
        modulePath: new URL(main.src).pathname,
        cssPath: new URL(style.href).pathname,
        api: document.querySelector('#api').textContent,
        chunk: document.querySelector('#chunk').textContent,
        file: await fetch('/host-file.txt', { cache: 'no-store' }).then((response) =>
          response.text(),
        ),
      };
    });
  assert.deepEqual(
    actual,
    {
      message,
      color: 'rgb(12, 34, 56)',
      image: [7, 5],
      imagePath: '/guest-image.svg',
      modulePath: '/src/main.ts',
      cssPath: '/src/style.css',
      api: 'guest root API\n',
      chunk: 'guest dynamic chunk',
      file: 'guest static file\n',
    },
    'unchanged absolute guest URLs resolve to guest module/CSS/image/API/chunk bytes',
  );
}

async function proveHmr(page, message, { waitForHmrBridge, assertHmrProof }) {
  const app = page.frameLocator('#preview').locator('#app');
  await waitForHmrBridge(app, 30_000);
  const key = `rifty:packed-scoped:${Date.now()}`;
  await app.evaluate((_, key) => {
    globalThis.__riftyPackedHmrSentinel = key;
    localStorage.setItem(`${key}:messages`, '[]');
    localStorage.removeItem(`${key}:beforeunload`);
    globalThis.addEventListener(
      'beforeunload',
      () => localStorage.setItem(`${key}:beforeunload`, '1'),
      { once: true },
    );
    globalThis.addEventListener('rifty:ws:message', (event) => {
      const messages = JSON.parse(localStorage.getItem(`${key}:messages`) ?? '[]');
      messages.push(event.detail);
      localStorage.setItem(`${key}:messages`, JSON.stringify(messages));
    });
  }, key);
  await page.evaluate(
    async (message) => (await window.__RIFTY_PACKED_SCOPED_PREVIEW__).writeMessage(message),
    message,
  );
  await guestFacts(page, message);
  assert.equal(
    await page.evaluate(
      async () => (await (await window.__RIFTY_PACKED_SCOPED_PREVIEW__).readSources()).message,
    ),
    messageSource(message),
    'HMR edit commits exact source bytes',
  );
  const proof = await app.evaluate(
    (_, key) => ({
      sentinel: globalThis.__riftyPackedHmrSentinel,
      beforeUnload: localStorage.getItem(`${key}:beforeunload`),
      messages: JSON.parse(localStorage.getItem(`${key}:messages`) ?? '[]'),
    }),
    key,
  );
  assertHmrProof({ expectedSentinel: key, ...proof });
}

async function stopScopedServiceWorker(context, page, scriptURL) {
  const cdp = await context.newCDPSession(page);
  const versions = new Map();
  const listeners = new Set();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: incoming }) => {
    for (const version of incoming) versions.set(version.versionId, version);
    for (const listener of [...listeners]) listener();
  });
  const observed = (predicate, label) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`Native SW ${label} was not observed`));
      }, 10_000);
      const check = () => {
        const value = [...versions.values()].find(predicate);
        if (value === undefined) return;
        clearTimeout(timer);
        listeners.delete(check);
        resolve(value);
      };
      listeners.add(check);
      check();
    });
  try {
    await cdp.send('ServiceWorker.enable');
    await page.evaluate(async () => (await window.__RIFTY_PACKED_SCOPED_PREVIEW__).controlProof());
    const active = await observed(
      (version) =>
        version.scriptURL === scriptURL &&
        version.status === 'activated' &&
        version.runningStatus === 'running',
      'activation',
    );
    const stopped = observed(
      (version) => version.versionId === active.versionId && version.runningStatus === 'stopped',
      'stop',
    );
    await cdp.send('ServiceWorker.stopWorker', { versionId: active.versionId });
    await stopped;
    const pong = await page.evaluate(async () =>
      (await window.__RIFTY_PACKED_SCOPED_PREVIEW__).controlProof(),
    );
    await observed(
      (version) => version.versionId === active.versionId && version.runningStatus === 'running',
      'restart',
    );
    return { versionId: active.versionId, pong };
  } finally {
    await cdp.detach();
  }
}

export async function provePackedScopedPreview({
  browser,
  origin,
  registryRequests,
  waitForHmrBridge,
  assertHmrProof,
}) {
  const registryBefore = registryRequests.length;
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const requests = [];
  const blocked = [];
  const errors = [];
  context.on('request', (request) => requests.push(request.url()));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === 'blob:' || url.protocol === 'data:')
      await route.continue();
    else {
      blocked.push(url.href);
      await route.abort('blockedbyclient');
    }
  });
  const page = await context.newPage();
  const outside = await context.newPage();
  for (const target of [page, outside])
    target.on('pageerror', (error) => errors.push(error.message));
  try {
    await outside.goto(`${origin}/outside.html`, { waitUntil: 'domcontentloaded' });
    const outsideBefore = await hostFacts(outside);
    assert.deepEqual(outsideBefore, {
      controller: null,
      api: hostApi,
      file: hostFile,
      document: 'unrelated host document',
    });
    await page.goto(`${origin}/sandbox/`, { waitUntil: 'domcontentloaded' });
    const opened = await previewFacts(page);
    assert.equal(opened.applicationMode, 'initial-deployment-only');
    assert.equal(opened.sources.message, messageSource('scoped-vite-ready'));
    const operationProof = await page.evaluate(async () =>
      (await window.__RIFTY_PACKED_SCOPED_PREVIEW__).proveOperationBudgets(),
    );
    const advertised = new URL(opened.previewUrl, origin);
    assert.equal(advertised.origin, origin);
    assert.match(
      advertised.pathname,
      /^\/sandbox\/p\/\d+\/$/,
      'public scoped preview advertisement',
    );
    assert.deepEqual(opened.storage, {
      policy: 'required',
      backend: 'opfs',
      durability: 'durable',
    });
    assert.equal(
      operationProof.archivedSource,
      `${messageSource('scoped-vite-ready')}\n// packed public operation budgets\n`,
    );
    assert.ok(operationProof.scmPaths.includes('/src/message.ts'));
    assert.equal(opened.control.scope, `${origin}/sandbox/`);
    assert.equal(opened.control.previewPrefix, prefix);
    const [legacyScript, scopedScript] = await Promise.all([
      context.request.get(`${origin}/rifty/sw.js`),
      context.request.get(opened.control.scriptURL),
    ]);
    assert.equal(legacyScript.status(), 200);
    assert.equal(scopedScript.status(), 200);
    assert.equal(legacyScript.headers()['service-worker-allowed'], '/');
    assert.equal(
      scopedScript.headers()['service-worker-allowed'],
      undefined,
      'scoped copied SW has no root allowance',
    );
    assert.deepEqual(
      await scopedScript.body(),
      await legacyScript.body(),
      'both routes serve the exact same copied published SW',
    );
    await guestFacts(page, 'scoped-vite-ready');
    const host = await hostFacts(page);
    assert.deepEqual(host, {
      controller: opened.control.scriptURL,
      api: hostApi,
      file: hostFile,
      document: null,
    });
    assert.deepEqual(await hostFacts(outside), outsideBefore);
    await proveHmr(page, 'scoped-vite-edited', { waitForHmrBridge, assertHmrProof });
    const dependencyEdit = await page.evaluate(async () =>
      (await window.__RIFTY_PACKED_SCOPED_PREVIEW__).editSnapshotDependency(),
    );
    assert.equal(dependencyEdit.original, opened.sources.vitePackageJson);
    assert.notEqual(dependencyEdit.edited, dependencyEdit.original);

    // End all live Workbench/preview bindings before checking immutable SW restart configuration.
    await closePreview(page);
    const restarted = await stopScopedServiceWorker(context, page, opened.control.scriptURL);
    assert.deepEqual(
      restarted.pong,
      opened.control,
      'native stopped/restarted SW retains its script-query configuration',
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reopened = await previewFacts(page);
    assert.equal(reopened.applicationMode, 'initial-deployment-only');
    assert.deepEqual(
      reopened.sources,
      {
        message: messageSource('scoped-vite-edited'),
        vitePackageJson: dependencyEdit.edited,
      },
      'saved reopen retains exact edited source and snapshot dependency',
    );
    assert.deepEqual(
      reopened.control,
      opened.control,
      'actual controller prefix survives host reload and new public open',
    );
    assert.equal(new URL(reopened.previewUrl, origin).pathname, advertised.pathname);
    await guestFacts(page, 'scoped-vite-edited');
    await proveHmr(page, 'scoped-vite-reopened', { waitForHmrBridge, assertHmrProof });

    const applied = await reopenPreview(page, `${origin}/sandbox/?apply=1`);
    assert.equal(applied.applicationMode, 'apply-snapshot');
    assert.equal(applied.snapshotId, opened.snapshotId, 'explicit apply uses the same snapshotId');
    assert.deepEqual(
      applied.sources,
      {
        message: messageSource('scoped-vite-reopened'),
        vitePackageJson: dependencyEdit.original,
      },
      'same-ID overwrite restores snapshot target and preserves unrelated edited source',
    );
    assert.deepEqual(applied.control, opened.control);
    assert.equal(new URL(applied.previewUrl, origin).pathname, advertised.pathname);
    await guestFacts(page, 'scoped-vite-reopened');
    await proveHmr(page, 'scoped-vite-applied', { waitForHmrBridge, assertHmrProof });

    const appliedReopened = await reopenPreview(page, `${origin}/sandbox/`);
    assert.equal(appliedReopened.applicationMode, 'initial-deployment-only');
    assert.deepEqual(
      appliedReopened.sources,
      {
        message: messageSource('scoped-vite-applied'),
        vitePackageJson: dependencyEdit.original,
      },
      'default reopen retains exact state after same-ID apply and HMR',
    );
    await guestFacts(page, 'scoped-vite-applied');

    const freshApplied = await reopenPreview(page, `${origin}/sandbox/?fresh=1&apply=1`);
    assert.equal(freshApplied.applicationMode, 'apply-snapshot');
    assert.equal(freshApplied.snapshotId, opened.snapshotId);
    assert.deepEqual(
      freshApplied.sources,
      {
        message: messageSource('scoped-vite-ready'),
        vitePackageJson: dependencyEdit.original,
      },
      'fresh apply starts from supplied files and the real dependency snapshot',
    );
    assert.deepEqual(freshApplied.control, opened.control);
    assert.equal(new URL(freshApplied.previewUrl, origin).pathname, advertised.pathname);
    await guestFacts(page, 'scoped-vite-ready');
    await proveHmr(page, 'scoped-vite-fresh-applied', { waitForHmrBridge, assertHmrProof });

    const freshReopened = await reopenPreview(page, `${origin}/sandbox/?fresh=1`);
    assert.equal(freshReopened.applicationMode, 'initial-deployment-only');
    assert.deepEqual(
      freshReopened.sources,
      {
        message: messageSource('scoped-vite-fresh-applied'),
        vitePackageJson: dependencyEdit.original,
      },
      'default reopen retains exact state after fresh apply and HMR',
    );
    await guestFacts(page, 'scoped-vite-fresh-applied');
    assert.deepEqual(await hostFacts(outside), outsideBefore);
    await outside.reload({ waitUntil: 'domcontentloaded' });
    assert.deepEqual(await hostFacts(outside), outsideBefore);
    assert.deepEqual(await hostFacts(page), host);
    await page.evaluate(async () => (await window.__RIFTY_PACKED_SCOPED_PREVIEW__).close());
    await page.close();
    await outside.close();
    assert.equal(
      registryRequests.length,
      registryBefore,
      'scoped snapshot-only journey has zero registry requests, including SW proxy',
    );
    assert.deepEqual(blocked, [], 'scoped journey attempts no external acquisition');
    assert.deepEqual(
      requests.filter((href) => {
        const url = new URL(href);
        return (
          (url.origin !== origin && url.protocol !== 'blob:' && url.protocol !== 'data:') ||
          /npm-registry|eddy/.test(url.pathname)
        );
      }),
      [],
      'all scoped page/worker/SW requests remain copied assets or explicit local host routes',
    );
    assert.deepEqual(errors, [], 'scoped public browser errors');
    console.log(
      `Packed scoped preview: /sandbox/ static SW, ${advertised.pathname}, real Vite initial/edit/saved reopen/same-ID overwrite/fresh apply with build/assets/API/HMR/reopen, native SW version ${restarted.versionId} stop/restart; unchanged outside host; zero registry/Eddy`,
    );
  } finally {
    if (!page.isClosed())
      await page
        .evaluate(async () => (await window.__RIFTY_PACKED_SCOPED_PREVIEW__)?.close())
        .catch(() => {});
    await context.close();
  }
}
