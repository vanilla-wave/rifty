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

  it('round-trips a real ws client ping to a real ws server pong over the bridge', async () => {
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
        let timer;
        wss.on('connection', () => {});
        server.listen({ port: 4114 }, () => {
          client = new WebSocket('ws://localhost:4114/ws');
          client.on('open', () => {
            // Generous deadline: the round-trip is ~tens of ms; a tight timeout
            // false-fails under parallel test load. Only a genuinely dropped pong
            // should trip this.
            timer = setTimeout(() => rejectResult(new Error('pong timeout')), 2000);
            client.ping('probe');
          });
          client.on('pong', (data) => {
            clearTimeout(timer);
            resolveResult(Buffer.from(data).toString('utf8'));
          });
          client.on('error', rejectResult);
        });
        module.exports = {
          result,
          close() {
            clearTimeout(timer);
            if (client) client.terminate();
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

    await expect(guest.result).resolves.toBe('probe');

    guest.close();
    for (const port of listPorts()) unregisterPort(port);
  });

  it('concludes a graceful server close cleanly on the real ws client (no status -> 1005)', async () => {
    await import('@riftydev/net/register-builtins');
    const vfs = new MemoryFsSync();
    seedInstalledWsPackage(vfs);
    vfs.loadFixture({
      // A bodyless `socket.close()` (default ws path, no code) must round-trip as
      // a bodyless close frame, NOT a 2-byte 1005 body — real ws rejects an
      // on-wire 1005 with WS_ERR_INVALID_CLOSE_CODE. Asserts the client sees a
      // clean 1005 close, never an 'error'.
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
          socket.on('message', () => {
            socket.send('echo');
            socket.close();
          });
        });
        server.listen({ port: 4112 }, () => {
          client = new WebSocket('ws://localhost:4112/ws');
          client.on('open', () => client.send('hello'));
          client.on('error', (err) => rejectResult('error:' + (err && err.message)));
          client.on('close', (code, reason) => resolveResult({ code, reason: String(reason) }));
        });
        module.exports = {
          result,
          close() {
            if (client) client.terminate();
            wss.close();
            server.close();
          }
        };
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/workspace' });
    const guest = loader.require('./guest.js', '/workspace/__entry.js') as {
      result: Promise<{ code: number; reason: string }>;
      close(): void;
    };
    await Promise.resolve();
    await Promise.resolve();

    await expect(guest.result).resolves.toEqual({ code: 1005, reason: '' });

    guest.close();
    for (const port of listPorts()) unregisterPort(port);
  });

  it('server.ping() to a real ws client yields exactly one server pong and one client ping', async () => {
    await import('@riftydev/net/register-builtins');
    const vfs = new MemoryFsSync();
    seedInstalledWsPackage(vfs);
    vfs.loadFixture({
      // Point-to-point Node ws: one server-origin ping -> client fires 'ping'
      // once and auto-pongs once -> server's 'pong' fires exactly once. The bridge
      // must NOT also answer the ping in transit; a transport auto-pong on top of
      // the real client's pong would deliver the server two pongs for one ping.
      '/workspace/guest.js': `
        const http = require('node:http');
        const { WebSocketServer } = require('ws');
        const WebSocket = require('ws');
        let resolveResult;
        const result = new Promise((resolve) => { resolveResult = resolve; });
        const server = http.createServer((_req, res) => res.end('http-ok'));
        const wss = new WebSocketServer({ server, path: '/ws' });
        let client, timer;
        let serverPongs = 0;
        let clientPings = 0;
        wss.on('connection', (socket) => {
          socket.on('pong', () => { serverPongs++; });
          setTimeout(() => socket.ping('sp'), 5);
        });
        server.listen({ port: 4116 }, () => {
          client = new WebSocket('ws://localhost:4116/ws');
          client.on('ping', () => { clientPings++; });
          client.on('open', () => {
            timer = setTimeout(() => resolveResult({ serverPongs, clientPings }), 250);
          });
        });
        module.exports = {
          result,
          close() { clearTimeout(timer); if (client) client.terminate(); wss.close(); server.close(); }
        };
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/workspace' });
    const guest = loader.require('./guest.js', '/workspace/__entry.js') as {
      result: Promise<{ serverPongs: number; clientPings: number }>;
      close(): void;
    };
    await Promise.resolve();
    await Promise.resolve();

    await expect(guest.result).resolves.toEqual({ serverPongs: 1, clientPings: 1 });

    guest.close();
    for (const port of listPorts()) unregisterPort(port);
  });

  it('a browser-like bridge client silently pongs a server ping without surfacing it', async () => {
    await import('@riftydev/net/register-builtins');
    const vfs = new MemoryFsSync();
    seedInstalledWsPackage(vfs);
    vfs.loadFixture({
      // A browser WebSocket cannot expose ping/pong to app code, but it must still
      // answer a server ping at the protocol layer so keepalive works. The bridge
      // client pongs in transit; the server sees exactly one pong and the client
      // never surfaces the control frame as a 'message'.
      '/workspace/guest.js': `
        const http = require('node:http');
        const { WebSocketServer } = require('ws');
        let resolveResult;
        const result = new Promise((resolve) => { resolveResult = resolve; });
        const server = http.createServer((_req, res) => res.end('http-ok'));
        const wss = new WebSocketServer({ server, path: '/ws' });
        let timer;
        let serverPongs = 0;
        wss.on('connection', (socket) => {
          socket.on('pong', () => { serverPongs++; });
          setTimeout(() => socket.ping('sp'), 5);
          timer = setTimeout(() => resolveResult(serverPongs), 250);
        });
        server.listen({ port: 4117 });
        module.exports = {
          result,
          close() { clearTimeout(timer); wss.close(); server.close(); }
        };
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/workspace' });
    const guest = loader.require('./guest.js', '/workspace/__entry.js') as {
      result: Promise<number>;
      close(): void;
    };
    await Promise.resolve();
    await Promise.resolve();

    const ws = new BridgedWebSocket('ws://localhost:4117/ws', 'pong-probe');
    const surfaced: unknown[] = [];
    ws.addEventListener('message', (event) => surfaced.push((event as MessageEvent).data));
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('bridge open failed')), { once: true });
    });

    await expect(guest.result).resolves.toBe(1);
    expect(surfaced).toEqual([]);

    ws.close();
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
