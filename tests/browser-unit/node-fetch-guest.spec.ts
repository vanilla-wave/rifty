import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import { runNodeOracle, runOwnerCommand } from './fixtures/message-port-ref-cases.ts';
import {
  cloneAccessorCeilingCase,
  fetchGuestCases,
  honoFetchCase,
  networkFetchCase,
} from './fixtures/node-fetch-guest-cases.ts';

const rows = (output: string): string[] =>
  output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.startsWith('FETCH|'));

// Real upstream Hono bytes; identical bundled program in Node and rifty.
function honoProgram(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rifty-fetch-hono-'));
  try {
    execFileSync('tar', [
      '-xzf',
      fileURLToPath(new URL('./fixtures/npm/hono-4.13.13.tgz', import.meta.url)),
      '-C',
      dir,
    ]);
    const result = buildSync({
      stdin: { contents: honoFetchCase, resolveDir: dir },
      alias: { hono: join(dir, 'package/dist/cjs/index.js') },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      target: 'es2022',
    });
    return result.outputFiles[0].text;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Node Fetch goal: real Hono and body lifecycle match live Node', async ({ page }) => {
  test.setTimeout(300_000);
  const cases = [{ name: 'hono', source: honoProgram() }, ...fetchGuestCases];
  const oracles = new Map<string, Awaited<ReturnType<typeof runNodeOracle>>>();
  for (const fixture of cases) {
    const oracle = await runNodeOracle(fixture.source);
    expect(oracle.code, `${fixture.name}: ${oracle.stderr}`).toBe(0);
    expect(rows(oracle.stdout).length, fixture.name).toBeGreaterThan(0);
    if (fixture.name === 'patch-method-warning')
      expect(oracle.stderr).toContain('[UNDICI-FETCH-patch] Warning:');
    oracles.set(fixture.name, oracle);
  }
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-node-fetch-guest',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    for (const fixture of cases) {
      await writeOwnerFile(page, `/scratch/${fixture.name}.cjs`, fixture.source);
      const run = await runOwnerCommand(page, `node ${fixture.name}.cjs`, 40_000);
      expect.soft(run.timedOut, `${fixture.name}: ${run.out}`).toBe(false);
      expect.soft(run.exit, `${fixture.name}: ${run.out}`).toBe(oracles.get(fixture.name)?.code);
      if (fixture.name === 'patch-method-warning')
        expect.soft(run.out).toContain('[UNDICI-FETCH-patch] Warning:');
      expect
        .soft(rows(run.out), `${fixture.name}: ${run.out}`)
        .toEqual(rows(oracles.get(fixture.name)?.stdout ?? ''));
    }
  } finally {
    await closeOwner(page);
  }
});

// Compat ❌ "Uncloneable reached only via accessor" + ⚠️ "Tag on a host object": guest outcome, not Node's.
test('Node Fetch ceiling: an uncloneable behind a getter clones its own fields', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-node-fetch-clone-ceiling',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    await writeOwnerFile(
      page,
      '/scratch/clone-accessor-ceiling.cjs',
      cloneAccessorCeilingCase.source,
    );
    const run = await runOwnerCommand(page, 'node clone-accessor-ceiling.cjs', 40_000);
    expect(run.timedOut, run.out).toBe(false);
    expect(run.exit, run.out).toBe(0);
    expect(rows(run.out), run.out).toEqual([
      'FETCH|clone-getter=["accepted",{"a":{}}]',
      'FETCH|clone-error-cause-getter=["accepted",1]',
      'FETCH|clone-tagged-port-transfer=["DataCloneError","Cannot clone object of unsupported type.",25]',
      'FETCH|clone-tagged-module=["DataCloneError","Cannot clone object of unsupported type.",25]',
    ]);
  } finally {
    await closeOwner(page);
  }
});

test('Node Fetch goal: multipart network response has one body state', async ({ page }) => {
  test.setTimeout(120_000);
  let unreadEnded = false;
  let cacheHits = 0;
  const server = createServer((request, response) => {
    if (request.url?.endsWith('/disconnect')) {
      request.destroy();
      return;
    }
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
    if (request.url?.endsWith('/redirect')) {
      response.writeHead(302, { location: './metadata' });
      response.end();
      return;
    }
    if (request.url?.endsWith('/metadata')) {
      response.writeHead(207, 'Multi-Status', {
        'x-fetch-proof': 'exposed',
        'access-control-expose-headers': 'x-fetch-proof',
      });
      response.end('redirect body');
      return;
    }
    if (request.url?.endsWith('/referrer')) {
      response.end(request.headers.referer ?? '');
      return;
    }
    if (request.url?.endsWith('/cache')) {
      response.setHeader('cache-control', 'public, max-age=3600');
      response.end(JSON.stringify([++cacheHits, request.headers.host !== 'override.test']));
      return;
    }
    if (request.url?.endsWith('/unread')) {
      response.writeHead(200);
      response.flushHeaders();
      setTimeout(() => {
        unreadEnded = true;
        response.end('unread');
      }, 500);
      return;
    }
    if (request.url?.endsWith('/slow')) {
      response.writeHead(200);
      response.write('pending');
      return;
    }
    if (request.method === 'OPTIONS') {
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      if (request.url?.endsWith('/native-http')) {
        response.end(text);
        return;
      }
      const boundary = /boundary=(.*)/.exec(request.headers['content-type'] ?? '')?.[1];
      response.end(
        JSON.stringify([
          boundary !== undefined && text.includes(`--${boundary}--`),
          text.includes('upload payload'),
        ]),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/upload`;
  try {
    const source = networkFetchCase(url);
    const oracle = await runNodeOracle(source);
    expect(oracle.code, oracle.stderr).toBe(0);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: 'bu-node-fetch-network',
      template: 'hidden-empty',
      persistence: 'ephemeral',
    });
    try {
      const install = await execLine(page, 'npm install');
      expect(install.exit, install.out).toBe(0);
      await writeOwnerFile(page, '/scratch/network.cjs', source);
      const run = await runOwnerCommand(page, 'node network.cjs', 40_000);
      expect.soft(run.timedOut, run.out).toBe(false);
      expect.soft(rows(run.out), run.out).toEqual(rows(oracle.stdout));
      expect.soft(run.exit, run.out).toBe(oracle.code);
      const cacheSource = `(async()=>{
        for(const cache of ['default','force-cache','only-if-cached']) {
          const values=[];
          for(let i=0;i<2;i++) values.push(await(await fetch(${JSON.stringify(`${url}/cache`)},{cache,mode:'same-origin',headers:{host:'override.test'}})).json());
          console.log('FETCH|cache='+JSON.stringify(values));
        }
      })().catch(e=>{console.error(e);process.exitCode=1;});`;
      cacheHits = 0;
      const cacheOracle = await runNodeOracle(cacheSource);
      expect(cacheOracle.code, cacheOracle.stderr).toBe(0);
      cacheHits = 0;
      await writeOwnerFile(page, '/scratch/cache.cjs', cacheSource);
      const cacheRun = await runOwnerCommand(page, 'node cache.cjs', 20_000);
      expect.soft(cacheRun.exit, cacheRun.out).toBe(0);
      expect.soft(rows(cacheRun.out), cacheRun.out).toEqual(rows(cacheOracle.stdout));
      const localReferrer = `${new URL(page.url()).origin}/source`;
      const referrerSource = `(async()=>{
        for(const init of [{referrer:''},{referrer:${JSON.stringify(localReferrer)},referrerPolicy:'unsafe-url'},{referrer:'https://example.test/source',referrerPolicy:'no-referrer'}])
          console.log('FETCH|referrer='+JSON.stringify(await(await fetch(${JSON.stringify(`${url}/referrer`)},init)).text()));
      })().catch(e=>{console.error(e);process.exitCode=1;});`;
      const referrerOracle = await runNodeOracle(referrerSource);
      expect(referrerOracle.code, referrerOracle.stderr).toBe(0);
      await writeOwnerFile(page, '/scratch/referrer.cjs', referrerSource);
      const referrerRun = await runOwnerCommand(page, 'node referrer.cjs', 20_000);
      expect.soft(referrerRun.exit, referrerRun.out).toBe(0);
      expect.soft(rows(referrerRun.out), referrerRun.out).toEqual(rows(referrerOracle.stdout));
      for (const [name, init, setup, feature] of [
        ['user-agent', "{headers:{'user-agent':'guest'}}", '', 'fetch.requestHeaders'],
        ['dispatcher', '{dispatcher:{}}', '', 'fetch.dispatcher'],
        [
          'referrer',
          "{referrer:'https://example.test/source',referrerPolicy:'unsafe-url'}",
          '',
          'fetch.referrer',
        ],
        [
          'global-dispatcher',
          '{}',
          "globalThis[Symbol.for('undici.globalDispatcher.1')]={};",
          'fetch.dispatcher',
        ],
      ]) {
        await writeOwnerFile(
          page,
          '/scratch/ceiling.cjs',
          `${setup}
          fetch(${JSON.stringify(url)},${init}).then(()=>console.log('FETCH|accepted'),e=>console.log('FETCH|'+e.name+':'+e.feature));`,
        );
        const ceiling = await runOwnerCommand(page, 'node ceiling.cjs', 20_000);
        expect.soft(ceiling.exit, `${name}: ${ceiling.out}`).toBe(0);
        expect.soft(rows(ceiling.out), name).toEqual([`FETCH|NotImplementedError:${feature}`]);
      }
      const lockedOverrideSource = `(async()=>{
        const aborter=new AbortController();aborter.abort(new Error('stop'));
        let calls=0,reader,stream;const blob=new Blob(['x']);
        blob.stream=()=>{stream=new ReadableStream({start(c){c.enqueue(Uint8Array.of(65));c.close();}});
          reader=stream.getReader();stream.cancel=()=>{calls++;return Promise.resolve();};return stream;};
        let result;
        try{await fetch(${JSON.stringify(url)},{method:'POST',body:blob,signal:aborter.signal});result=['accepted'];}
        catch(error){result=[error.name,error.feature??null];}
        console.log('FETCH|locked-override='+JSON.stringify([...result,calls,stream.locked,(await reader.read()).value[0]]));
      })().catch(error=>{console.error(error);process.exitCode=1;});`;
      const lockedOracle = await runNodeOracle(lockedOverrideSource);
      expect(lockedOracle.code, lockedOracle.stderr).toBe(0);
      expect(rows(lockedOracle.stdout)).toEqual(['FETCH|locked-override=["Error",null,1,true,65]']);
      await writeOwnerFile(page, '/scratch/locked-override.cjs', lockedOverrideSource);
      const lockedOverride = await runOwnerCommand(page, 'node locked-override.cjs', 20_000);
      expect(lockedOverride.exit, lockedOverride.out).toBe(0);
      expect(rows(lockedOverride.out)).toEqual([
        'FETCH|locked-override=["NotImplementedError","fetch.abortBodyState",0,true,65]',
      ]);
      // User-approved browser transport ceiling, deliberately distinct from Node's wire behavior.
      await writeOwnerFile(
        page,
        '/scratch/cookie.cjs',
        `fetch(${JSON.stringify(url)}, {headers:{cookie:'a=1'}})
        .then(() => console.log('FETCH|cookie=accepted'), e => console.log('FETCH|cookie='+e.name+':'+e.feature));`,
      );
      const cookie = await runOwnerCommand(page, 'node cookie.cjs', 20_000);
      expect.soft(cookie.timedOut, cookie.out).toBe(false);
      expect.soft(cookie.exit, cookie.out).toBe(0);
      expect
        .soft(rows(cookie.out), cookie.out)
        .toEqual(['FETCH|cookie=NotImplementedError:fetch.requestHeaders']);
      await writeOwnerFile(
        page,
        '/scratch/stream-upload.cjs',
        `fetch(${JSON.stringify(url)}, {
        method:'POST',duplex:'half',body:new ReadableStream({start(c){c.enqueue(new Uint8Array([65]));c.close();}})
      }).then(()=>console.log('FETCH|stream=accepted'),e=>console.log('FETCH|stream='+e.name+':'+e.feature));`,
      );
      const streaming = await runOwnerCommand(page, 'node stream-upload.cjs', 20_000);
      expect(streaming.timedOut, streaming.out).toBe(false);
      expect(streaming.exit, streaming.out).toBe(0);
      expect(rows(streaming.out), streaming.out).toEqual([
        'FETCH|stream=NotImplementedError:fetch.streamingUpload',
      ]);
      const unread = `fetch(${JSON.stringify(`${url}/unread`)}).then(() => console.log('FETCH|unread=headers'));`;
      unreadEnded = false;
      const unreadOracle = await runNodeOracle(unread);
      expect(unreadOracle.code, unreadOracle.stderr).toBe(0);
      expect(unreadEnded, 'Node exits after the unread network response reaches EOF').toBe(true);
      unreadEnded = false;
      await writeOwnerFile(page, '/scratch/unread.cjs', unread);
      const unreadRun = await runOwnerCommand(page, 'node unread.cjs', 20_000);
      expect(unreadRun.timedOut, unreadRun.out).toBe(false);
      expect(unreadRun.exit, unreadRun.out).toBe(0);
      expect(rows(unreadRun.out)).toEqual(rows(unreadOracle.stdout));
      expect(unreadEnded, 'guest must not exit at headers while network body remains pending').toBe(
        true,
      );
      const workerUrl = `/@fs${fileURLToPath(new URL('./fixtures/node-network-fetch-worker.ts', import.meta.url))}`;
      const nativeTransport = await page.evaluate(
        async ({ workerUrl, url }) => {
          const workerModule = await import(/* @vite-ignore */ `${workerUrl}?worker&url`);
          return new Promise((resolve, reject) => {
            const worker = new Worker(workerModule.default, { type: 'module' });
            const timeout = setTimeout(() => {
              worker.terminate();
              reject(new Error('native HTTP transport timed out'));
            }, 20_000);
            worker.onmessage = ({ data }) => {
              clearTimeout(timeout);
              worker.terminate();
              resolve(data);
            };
            worker.onerror = (event) => {
              clearTimeout(timeout);
              worker.terminate();
              reject(new Error(event.message));
            };
            worker.postMessage({ url });
          });
        },
        { workerUrl, url: `${url}/native-http` },
      );
      expect(nativeTransport).toEqual({ held: true, text: 'hello', jsResponse: true, refs: 0 });
    } finally {
      await closeOwner(page);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
