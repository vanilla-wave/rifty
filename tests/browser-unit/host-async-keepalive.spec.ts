import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';
import {
  fetchFormDataCase,
  hostAsyncCases,
  uncountedHostTaskCase,
  webSocketCase,
} from './fixtures/host-async-keepalive-cases.ts';
import { runNodeOracle, runOwnerCommand } from './fixtures/message-port-ref-cases.ts';

// Goal honest-guest-package-adaptations I1: a pending host-task-async request of
// a Node-surface API keeps a run-to-completion child alive until it settles.
// Each case runs verbatim in real Node (live oracle) and as rifty `node <case>.cjs`.
function rows(output: string): string[] {
  return output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.startsWith('HA|'));
}

test('host-async Node carriers hold the loop until they settle, as in Node', async ({ page }) => {
  test.setTimeout(300_000);
  const oracles = new Map<string, Awaited<ReturnType<typeof runNodeOracle>>>();
  for (const fixture of hostAsyncCases) {
    const oracle = await runNodeOracle(fixture.source);
    expect(rows(oracle.stdout).length, `${fixture.name}: ${oracle.stderr}`).toBeGreaterThan(0);
    oracles.set(fixture.name, oracle);
  }
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-host-async-keepalive',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    // `node` needs the package-tree readiness stamp that an install publishes.
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    for (const fixture of hostAsyncCases) {
      const oracle = oracles.get(fixture.name);
      await writeOwnerFile(page, `/scratch/${fixture.name}.cjs`, fixture.source);
      const run = await runOwnerCommand(page, `node ${fixture.name}.cjs`, 40_000);
      expect.soft(run.timedOut, `${fixture.name}: ${run.out}`).toBe(false);
      expect.soft(rows(run.out), `${fixture.name}: ${run.out}`).toEqual(rows(oracle?.stdout ?? ''));
      expect.soft(run.exit, `${fixture.name}: ${run.out}`).toBe(oracle?.code);
    }
  } finally {
    await closeOwner(page);
  }
});

// ADR-0529 §3: uncounted work settles with no host task (deterministic, not by size).
test('uncounted Node-surface work settles with no host task', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-host-async-uncounted',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await writeOwnerFile(page, '/scratch/uncounted.cjs', uncountedHostTaskCase);
    const run = await runOwnerCommand(page, 'node uncounted.cjs', 60_000);
    expect(run.timedOut, run.out).toBe(false);
    expect(rows(run.out), run.out).toEqual([
      'HA|ticks:fs-promises=0',
      'HA|ticks:zlib-gzip=0',
      'HA|ticks:zlib-gzip-stream=0',
      'HA|ticks:response-string-body=0',
      'HA|ticks:response-bytes-body=0',
      'HA|ticks:request-string-body=0',
      'HA|ticks:request-string-formdata-body=0',
    ]);
    expect(run.exit, run.out).toBe(0);
  } finally {
    await closeOwner(page);
  }
});

test('an open global WebSocket holds the loop until it closes, as in Node', async ({ page }) => {
  const http = createServer();
  const server = new WebSocketServer({ server: http });
  server.on('connection', (socket) => {
    setTimeout(() => {
      socket.send('hello');
      setTimeout(() => socket.close(1000, 'bye'), 200);
    }, 300);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/`;
  try {
    const source = webSocketCase(url);
    const oracle = await runNodeOracle(source);
    expect(oracle.code, oracle.stderr).toBe(0);
    expect(rows(oracle.stdout), oracle.stdout).toEqual([
      'HA|top',
      'HA|open',
      'HA|close=undefined:undefined:open+message+close',
      'HA|message=hello',
      'HA|close=1000:bye:open+message+close',
    ]);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: 'bu-host-async-websocket',
      template: 'hidden-empty',
      persistence: 'ephemeral',
    });
    try {
      const install = await execLine(page, 'npm install');
      expect(install.exit, install.out).toBe(0);
      await writeOwnerFile(page, '/scratch/websocket.cjs', source);
      const run = await runOwnerCommand(page, 'node websocket.cjs', 20_000);
      expect(run.timedOut, run.out).toBe(false);
      expect(rows(run.out), run.out).toEqual(rows(oracle.stdout));
      expect(run.exit, run.out).toBe(oracle.code);
    } finally {
      await closeOwner(page);
    }
  } finally {
    for (const client of server.clients) client.terminate();
    server.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});

// Echo server: checks that the multipart body carries the boundary its content-type names.
test('fetch(request) sends a FormData-with-File body as one consistent multipart body, as in Node', async ({
  page,
}) => {
  const http = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      const boundary = /boundary=([^;]+)/u.exec(request.headers['content-type'] ?? '')?.[1];
      response.setHeader('access-control-allow-origin', '*');
      response.end(
        [
          boundary !== undefined && body.includes(`--${boundary}--`),
          body.includes('name="a"'),
          body.includes('hello file'),
        ].join(':'),
      );
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/upload`;
  try {
    const source = fetchFormDataCase(url);
    const oracle = await runNodeOracle(source);
    expect(oracle.code, oracle.stderr).toBe(0);
    expect(rows(oracle.stdout), oracle.stdout).toEqual(['HA|top', 'HA|fetch=true:true:true,true']);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: 'bu-host-async-fetch-form',
      template: 'hidden-empty',
      persistence: 'ephemeral',
    });
    try {
      const install = await execLine(page, 'npm install');
      expect(install.exit, install.out).toBe(0);
      await writeOwnerFile(page, '/scratch/fetch-form.cjs', source);
      const run = await runOwnerCommand(page, 'node fetch-form.cjs', 20_000);
      expect(run.timedOut, run.out).toBe(false);
      expect(rows(run.out), run.out).toEqual(rows(oracle.stdout));
      expect(run.exit, run.out).toBe(oracle.code);
    } finally {
      await closeOwner(page);
    }
  } finally {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
