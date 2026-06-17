import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { dispatchToPort, listPorts, unregisterPort } from '../../../packages/net/src/registry.ts';
import { BridgedWebSocket } from '../../../packages/net/src/ws/bridge.ts';

const textEncoder = new TextEncoder();

describe('real ws package under the rifty module loader', () => {
  it('runs WebSocketServer({ server }) against node:http over the bridge', async () => {
    await import('@riftydev/net/register-builtins');
    const vfs = new MemoryFsSync();
    seedInstalledWsPackage(vfs);
    vfs.loadFixture({
      '/workspace/guest.js': `
        const http = require('node:http');
        const { WebSocketServer } = require('ws');
        const server = http.createServer((_req, res) => res.end('http-ok'));
        const wss = new WebSocketServer({ server, path: '/ws' });
        wss.on('connection', (socket) => {
          socket.on('message', (data) => socket.send('echo:' + String(data)));
        });
        server.listen({ port: 4104 });
        module.exports = {
          close() {
            wss.close();
            server.close();
          }
        };
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/workspace' });
    const guest = loader.require('./guest.js', '/workspace/__entry.js') as { close(): void };
    await Promise.resolve();
    await Promise.resolve();

    const httpResponse = await dispatchToPort(4104, new Request('http://preview.local:4104/'));
    expect(await httpResponse.text()).toBe('http-ok');

    const ws = new BridgedWebSocket('ws://localhost:4104/ws', 'loader-probe');
    const seen: string[] = [];
    ws.addEventListener('message', (event) => seen.push(String((event as MessageEvent).data)));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('loader ws bridge failed to open')), {
        once: true,
      });
    });
    ws.send('hello');
    await waitFor(
      () => seen.length > 0,
      () => `seen=${JSON.stringify(seen)}`,
    );
    expect(seen).toContain('echo:hello');

    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    guest.close();
    for (const port of listPorts()) unregisterPort(port);
  });

  it('runs the real ws client against a real ws server on node:http', async () => {
    await import('@riftydev/net/register-builtins');
    const vfs = new MemoryFsSync();
    seedInstalledWsPackage(vfs);
    vfs.loadFixture({
      '/workspace/guest.js': `
        const http = require('node:http');
        const WebSocket = require('ws');
        const { WebSocketServer } = WebSocket;
        let resolveResult;
        let rejectResult;
        const result = new Promise((resolve, reject) => {
          resolveResult = resolve;
          rejectResult = reject;
        });
        const server = http.createServer((_req, res) => res.end('http-ok'));
        const wss = new WebSocketServer({ server, path: '/ws' });
        let client;
        wss.on('connection', (socket) => {
          socket.on('message', (data) => socket.send('echo:' + String(data)));
        });
        server.listen({ port: 4108 }, () => {
          client = new WebSocket('ws://localhost:4108/ws', 'guest-probe');
          client.on('open', () => client.send('hello'));
          client.on('message', (data) => resolveResult(String(data)));
          client.on('error', rejectResult);
        });
        module.exports = {
          result,
          close() {
            if (client) client.close();
            wss.close();
            server.close();
          }
        };
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/workspace' });
    const guest = loader.require('./guest.js', '/workspace/__entry.js') as {
      result: Promise<string>;
      close(): void;
    };
    await Promise.resolve();
    await Promise.resolve();

    await expect(guest.result).resolves.toBe('echo:hello');

    guest.close();
    for (const port of listPorts()) unregisterPort(port);
  });
});

function seedInstalledWsPackage(vfs: MemoryFsSync): void {
  const root = 'node_modules/ws';
  for (const file of walkFiles(root)) {
    const rel = relative(root, file);
    const target = `/workspace/node_modules/ws/${rel}`;
    vfs.mkdirSync(dirname(target), { recursive: true });
    vfs.writeFileSync(target, readFileSync(file));
  }
  vfs.mkdirSync('/workspace', { recursive: true });
  vfs.writeFileSync(
    '/workspace/package.json',
    textEncoder.encode(JSON.stringify({ type: 'commonjs', dependencies: { ws: '8.18.3' } })),
  );
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walkFiles(full));
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

async function waitFor(predicate: () => boolean, describeState: () => string): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for condition: ${describeState()}`);
}
