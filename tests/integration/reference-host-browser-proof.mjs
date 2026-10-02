import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { withClientServer } from './client-bundle-browser-proof.mjs';
import { scriptedProvider } from './fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';

const originalRoute = `export function route(request) {
  const path = new URL(request.url).pathname;
  return new Response('missing', {status:404});
}
`;
const healthRoute = originalRoute.replace(
  "  return new Response('missing', {status:404});",
  "  if (path === '/health') return Response.json({ok:true});\n  return new Response('missing', {status:404});",
);
const uptimeRoute = `import ms from 'ms';\n${healthRoute.replace('{ok:true}', '{ok:true,uptime:ms(2000)}')}`;
const invoke = (page, method, ...args) =>
  page.evaluate(({ method, args }) => globalThis.referenceHost[method](...args), { method, args });
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const text = (entry) => entry.content.map((part) => part.text ?? '').join('');

/** Only external model/HTTP delivery is controlled; all project/agent/runtime work is real. */
export async function provePackedReferenceHost(root, registryUrl) {
  const entry = (await readdir(resolve(root, 'dist/assets'))).find((name) =>
    /^referenceHost-.*\.js$/u.test(name),
  );
  assert(entry, 'missing packed reference host entry');
  const first = JSON.parse(
    await readFile(resolve(root, 'dist/producer-vite-snapshot.json'), 'utf8'),
  );
  await withClientServer(root, async (browser, base) => {
    for (const connected of [true, false]) {
      const context = await browser.newContext({ acceptDownloads: true });
      const held = deferred();
      const release = deferred();
      const replies = [
        [{ name: 'read_file', args: { path: 'src/route.js' } }],
        [
          {
            name: 'edit_file',
            args: { path: 'src/route.js', old: originalRoute, new: healthRoute },
          },
        ],
        [{ name: 'shell', args: { command: 'node verify.mjs' } }],
        'Added /health and verified.',
        [{ name: 'shell', args: { command: 'npm install ms' } }],
        ...(connected
          ? [
              [{ name: 'write_file', args: { path: 'src/route.js', content: uptimeRoute } }],
              [{ name: 'shell', args: { command: 'node verify.mjs' } }],
              'Installed ms and verified uptime.',
            ]
          : ['Registry connection missing; dependency was not installed.']),
        [{ name: 'shell', args: { command: 'npm run build' } }],
        'Build completed.',
      ];
      const provider = scriptedProvider(replies);
      const server = createServer(async (request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader(
          'Access-Control-Allow-Headers',
          request.headers['access-control-request-headers'] ?? '*',
        );
        response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        if (request.method === 'OPTIONS') return void response.end();
        if (request.url === '/hold-build') {
          held.resolve();
          await release.promise;
          response.end('released');
          return;
        }
        try {
          const chunks = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString());
          assert(
            body.messages.every((message) => typeof message.content === 'string'),
            'endpoint only accepts string content',
          );
          const result = await provider.fetch(
            new Request('http://fixture.invalid/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(request.headers.authorization
                  ? { Authorization: request.headers.authorization }
                  : {}),
              },
              body: JSON.stringify(body),
            }),
          );
          response.writeHead(result.status, { 'Content-Type': result.headers.get('content-type') });
          response.end(await result.text());
        } catch (error) {
          response.writeHead(500);
          response.end(String(error));
        }
      });
      await new Promise((done) => server.listen(0, '127.0.0.1', done));
      const modelOrigin = `http://127.0.0.1:${server.address().port}`;
      const snapshot = {
        assetUrl: `${base}/dist/producer-vite-snapshot.tar.gz`,
        snapshotId: first.snapshotId,
        templateId: first.templateId,
      };
      const options = {
        namespace: `packed-reference-${connected}`,
        baseUrl: `${modelOrigin}/v1`,
        ...(connected ? { registryUrl } : {}),
      };
      const requests = [];
      context.on('request', (request) => requests.push(request.url()));
      context.on('requestfailed', (request) =>
        console.error('Reference failed request:', request.url(), request.failure()),
      );
      const page = await context.newPage();
      page.on('pageerror', (error) => console.error('Reference page error:', error));
      try {
        await page.goto(base);
        await page.evaluate((entry) => import(entry), `/dist/assets/${entry}`);
        const boot = await invoke(page, 'boot', options);
        assert.equal(boot.coi, false, JSON.stringify(boot));
        assert.equal(boot.support.modes.nonCoi.conclusion, 'supported');
        assert.equal(
          JSON.parse(await page.locator('#support').textContent()).modes.nonCoi.conclusion,
          'supported',
        );
        console.log(`Packed reference registry=${connected}: boot/support`);
        assert.equal(boot.registryConnected, connected);
        assert.deepEqual(
          boot.runtime.filter((event) => event.operation === 'boot').map((event) => event.phase),
          ['worker-spawned', 'storage-admitted', 'toolchain-ready'],
        );
        const manifest = {
          ...JSON.parse(first.packageJsonText),
          scripts: { build: 'node build-log.mjs && vite build' },
        };
        const prepared = await invoke(page, 'prepare', snapshot, {
          'package.json': JSON.stringify(manifest),
          'index.html':
            '<!doctype html><main id="app"></main><script type="module" src="/src/main.js"></script>',
          'src/main.js':
            "import {route} from './route.js'; route(new Request(location.href)).text().then(text=>document.querySelector('#app').textContent=text);",
          'src/route.js': originalRoute,
          'verify.mjs':
            "import {route} from './src/route.js'; const response=route(new Request('http://project.test/health')); console.log(response.status,await response.text());",
          'build-log.mjs': `console.log('out-a'); console.error('err-b'); console.log('out-c'); await (await fetch(${JSON.stringify(`${modelOrigin}/hold-build`)})).text();`,
          'vite.config.js': 'export default {build:{minify:false,sourcemap:false}};',
        });
        for (const phase of ['fetch', 'entries', 'flush-cache', 'flush-payload'])
          assert(
            prepared.runtime.some(
              (event) => event.operation === 'snapshot' && event.phase === phase,
            ),
            `missing real ${phase}`,
          );
        const progress = JSON.parse(await page.locator('#runtime-progress').textContent());
        assert.equal(progress.phase, 'flush-payload');
        assert(progress.persisted > 0);
        assert.equal(progress.persisted, progress.total);
        const fetched = prepared.runtime.filter((event) => event.phase === 'fetch').at(-1);
        const entries = prepared.runtime.filter((event) => event.phase === 'entries').at(-1);
        assert(fetched.bytes > 0);
        assert(entries.written > 0);
        assert.equal(entries.written, entries.total);
        assert.equal(await invoke(page, 'conflict', snapshot), 'snapshot-conflict');
        const edited = await invoke(page, 'send', 'Add a /health route and verify it.');
        assert.equal(edited.trace.status, 'done');
        assert.equal(await invoke(page, 'read', 'src/route.js'), healthRoute);
        assert.match(
          text(
            edited.trace.transcript.find(
              (entry) => entry.role === 'toolResult' && entry.toolName === 'shell',
            ),
          ),
          /200.*"ok":true/u,
        );
        const pair = provider.requests[1].body.messages;
        const call = pair.find((message) => message.role === 'assistant' && message.tool_calls)
          ?.tool_calls[0];
        assert.equal(call.id, 'call-0-0');
        assert.equal(call.function.name, 'read_file');
        assert.deepEqual(JSON.parse(call.function.arguments), { path: 'src/route.js' });
        assert(pair.some((message) => message.role === 'tool' && message.tool_call_id === call.id));
        await invoke(page, 'switchModel');
        const added = await invoke(page, 'send', 'Format uptime with ms.');
        assert.equal(added.trace.status, 'done');
        assert.equal(provider.requests[4].body.model, 'second');
        assert(
          provider.requests[4].body.messages.some(
            (message) => message.role === 'user' && message.content.includes('Add a /health'),
          ),
          'model switch lost history',
        );
        const install = added.trace.transcript.find(
          (entry) =>
            entry.role === 'toolResult' &&
            entry.toolName === 'shell' &&
            text(entry).includes('npm'),
        );
        assert(install, 'missing install receipt');
        if (connected) {
          assert.equal(install.isError, false, text(install));
          assert.match(await invoke(page, 'read', 'package.json'), /"ms"/u);
          assert.equal(
            JSON.parse(await invoke(page, 'read', 'package-lock.json')).packages[''].dependencies
              .ms,
            '^2.0.0',
          );
          assert.match(
            text(
              added.trace.transcript
                .filter((entry) => entry.role === 'toolResult' && entry.toolName === 'shell')
                .at(-1),
            ),
            /"uptime":"2s"/u,
          );
        } else {
          assert.equal(install.isError, true);
          assert.match(text(install), /registry/i);
          assert.equal(
            JSON.parse(await invoke(page, 'read', 'package.json')).dependencies.ms,
            undefined,
          );
          assert.match(
            added.transcript.items
              .filter((item) => item.kind === 'message' && item.role === 'assistant')
              .at(-1).text,
            /Registry connection missing/u,
          );
        }
        console.log(`Packed reference registry=${connected}: edit/install/model switch`);
        const building = invoke(page, 'send', 'Run npm run build.');
        try {
          await Promise.race([
            held.promise,
            building.then(() => {
              throw new Error('Build never reached held HTTP');
            }),
          ]);
          assert.equal(await invoke(page, 'write', 'overlap.txt', 'retry after build'), 'busy');
        } finally {
          release.resolve();
        }
        const built = await building;
        assert.equal(built.trace.status, 'done');
        assert.equal(await invoke(page, 'write', 'overlap.txt', 'retry after build'), 'written');
        assert.equal(await invoke(page, 'read', 'overlap.txt'), 'retry after build');
        assert.match(await invoke(page, 'read', 'dist/index.html'), /script.*src=/u);
        const buildResult = built.trace.transcript
          .filter((entry) => entry.role === 'toolResult' && entry.toolName === 'shell')
          .at(-1);
        assert.equal(buildResult.isError, false, text(buildResult));
        assert.match(text(buildResult), /out-a\nerr-b\nout-c\n/u);
        assert(
          provider.requests
            .at(-1)
            .body.messages.some(
              (message) =>
                message.role === 'tool' && message.content.includes('out-a\nerr-b\nout-c\n'),
            ),
        );
        assert(
          built.rendered.some((state) =>
            state.items.some((item) => item.kind === 'tool' && item.state === 'running'),
          ),
        );
        assert(
          built.transcript.items.some((item) => item.kind === 'tool' && item.state === 'success'),
        );
        if (!connected)
          assert(
            built.transcript.items.some((item) => item.kind === 'tool' && item.state === 'error'),
          );
        assert.deepEqual(
          JSON.parse(await page.locator('#transcript').textContent()),
          JSON.parse(JSON.stringify(built.transcript)),
        );
        assert.equal(await invoke(page, 'normalize', '\u001b[31ma\u001b[0m\rb\r\n'), 'a\nb\n');
        const downloaded = page.waitForEvent('download');
        await invoke(page, 'download');
        const traceDownload = await downloaded;
        assert.equal(JSON.parse(await readFile(await traceDownload.path(), 'utf8')).status, 'done');
        console.log(`Packed reference registry=${connected}: build/order/busy/transcript/trace`);
        const savedManifest = await invoke(page, 'read', 'package.json');
        const savedLock = await invoke(page, 'read', 'package-lock.json');
        const source = await invoke(page, 'read', 'src/route.js');
        const fetchCount = requests.filter((url) => url === snapshot.assetUrl).length;
        await invoke(page, 'close');
        await invoke(page, 'boot', options);
        await invoke(page, 'open');
        assert.equal(requests.filter((url) => url === snapshot.assetUrl).length, fetchCount);
        assert.equal(await invoke(page, 'read', 'src/route.js'), source);
        assert.equal(await invoke(page, 'read', 'package.json'), savedManifest);
        assert.equal(await invoke(page, 'read', 'package-lock.json'), savedLock);
        const afterManifest = JSON.parse(await invoke(page, 'read', 'package.json'));
        const afterLock = JSON.parse(await invoke(page, 'read', 'package-lock.json'));
        assert.equal(afterManifest.dependencies.ms, connected ? '^2.0.0' : undefined);
        assert.equal(afterLock.packages[''].dependencies.ms, connected ? '^2.0.0' : undefined);
        assert.equal(await invoke(page, 'read', 'src/route.js'), source);
        const verified = await invoke(page, 'run', 'node verify.mjs');
        assert.equal(verified.exitCode, 0, JSON.stringify(verified));
        assert.match(verified.stdout, connected ? /"uptime":"2s"/u : /"ok":true/u);
        const other = await context.newPage();
        await other.goto(base);
        await other.evaluate((entry) => import(entry), `/dist/assets/${entry}`);
        const occupied = await invoke(other, 'boot', { ...options, startupTimeoutMs: 5000 });
        assert.equal(occupied.kind, 'occupied', JSON.stringify(occupied));
        assert(occupied.runtime.some((event) => event.phase === 'waiting-for-storage-writer'));
        await invoke(page, 'close');
        const retried = await invoke(other, 'boot', options);
        assert.equal(retried.support.modes.nonCoi.conclusion, 'supported');
        await invoke(other, 'open');
        assert.equal(await invoke(other, 'read', 'src/route.js'), source);
        assert.equal(await invoke(other, 'read', 'package.json'), savedManifest);
        assert.equal(await invoke(other, 'read', 'package-lock.json'), savedLock);
        await invoke(other, 'close');
        assert(
          !requests.some((url) => /\/sw\.js(?:\?|$)/u.test(url)),
          'reference runtime registered a service worker',
        );
        if (!connected)
          assert(
            !requests.some((url) => url.startsWith(registryUrl)),
            'unconnected journey attempted registry acquisition',
          );
        assert(
          provider.requests.every((request) => request.authorization === 'Bearer fixture-key'),
        );
        assert.equal(provider.requests.length, replies.length);
        console.log(
          `Packed reference host: registry=${connected}; real edit/install/build/order/busy/reopen/occupied; shared transcript`,
        );
      } finally {
        release.resolve();
        try {
          await context.close();
        } finally {
          server.closeAllConnections();
          await new Promise((done) => server.close(done));
        }
      }
    }
  });
}
