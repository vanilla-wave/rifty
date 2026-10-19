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
      expect
        .soft(rows(run.out), `${fixture.name}: ${run.out}`)
        .toEqual(rows(oracles.get(fixture.name)?.stdout ?? ''));
    }
  } finally {
    await closeOwner(page);
  }
});

test('Node Fetch goal: multipart network response has one body state', async ({ page }) => {
  test.setTimeout(120_000);
  let unreadEnded = false;
  const server = createServer((request, response) => {
    if (request.url?.endsWith('/disconnect')) {
      request.destroy();
      return;
    }
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
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
    } finally {
      await closeOwner(page);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
