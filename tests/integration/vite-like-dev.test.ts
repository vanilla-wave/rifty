/**
 * Integration test for the M10 mini dev-server in `examples/vite-like-dev`.
 *
 * Demonstrates the M10 acceptance vision end-to-end *inside* one JS realm:
 *   1. Spin up the dev server on a port via `startDevServer`.
 *   2. Hit `/` through the port registry — get the rewritten index.html.
 *   3. Connect a WebSocket client to the HMR endpoint.
 *   4. Edit a watched file via the sync mirror.
 *   5. Within ~100 ms an HMR `update` message lands on the client.
 *   6. The newly-served `/src/main.js` reflects the new contents.
 *
 * Vite (or its equivalent) being "running" is verified through these contracts
 * — the playground wires the same primitives into a real iframe + editor.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { startDevServer } from '../../examples/vite-like-dev/src/index.ts';
import { dispatchToPort } from '../../packages/net/src/registry.ts';
import { WebSocket } from '../../packages/net/src/ws.ts';
import {
  resetSyncMirror,
  syncMirror,
} from '../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';

afterEach(() => {
  resetSyncMirror();
});

const enc = new TextEncoder();

function writeFile(path: string, text: string): void {
  const fs = syncMirror();
  // mkdir up the chain
  const parts = path.split('/').slice(1, -1);
  let acc = '';
  for (const p of parts) {
    acc += `/${p}`;
    fs.mkdirSync(acc, { recursive: true });
  }
  fs.writeFileSync(path, enc.encode(text));
}

function nextTick(ms = 30): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function dispatchText(port: number, path: string): Promise<{ status: number; body: string }> {
  const resp = await dispatchToPort(port, new Request(`http://x${path}`));
  return { status: resp.status, body: await resp.text() };
}

describe('examples/vite-like-dev', () => {
  it('serves index.html with the HMR client injected', async () => {
    writeFile('/workspace/index.html', '<html><body><div id=app></div></body></html>');
    writeFile('/workspace/src/main.js', 'document.getElementById("app").textContent="v1"');
    const server = await startDevServer({ root: '/workspace', port: 3010, watchInterval: 5 });
    try {
      const r = await dispatchText(3010, '/');
      expect(r.status).toBe(200);
      expect(r.body).toContain('<div id=app></div>');
      // The dev server injects a minimal HMR client at the end of <body>.
      expect(r.body).toMatch(/rifty:hmr/);
    } finally {
      await server.close();
    }
  });

  it('serves /src/main.js as text/javascript from VFS', async () => {
    writeFile('/workspace/index.html', '<!doctype html><body></body>');
    writeFile('/workspace/src/main.js', 'console.log("hello v1")');
    const server = await startDevServer({ root: '/workspace', port: 3011, watchInterval: 5 });
    try {
      const resp = await dispatchToPort(3011, new Request('http://x/src/main.js'));
      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-type')).toMatch(/javascript/);
      expect(await resp.text()).toContain('hello v1');
    } finally {
      await server.close();
    }
  });

  it('emits an HMR update over WebSocket when a watched file changes', async () => {
    writeFile('/workspace/index.html', '<!doctype html><body></body>');
    writeFile('/workspace/src/main.js', 'console.log("v1")');
    const server = await startDevServer({ root: '/workspace', port: 3012, watchInterval: 5 });

    const ws = new WebSocket('ws://localhost:3012/__hmr');
    await new Promise<void>((r) => ws.addEventListener('open', () => r(), { once: true }));
    const messages: Array<{ type: string; path?: string }> = [];
    ws.addEventListener('message', (e) => {
      messages.push(JSON.parse(String((e as MessageEvent).data)));
    });

    await nextTick();
    writeFile('/workspace/src/main.js', 'console.log("v2")');
    // wait for watcher tick + ws hop
    await nextTick(80);

    expect(messages.some((m) => m.type === 'update' && m.path === '/src/main.js')).toBe(true);

    // newly served content reflects the change
    const r = await dispatchText(3012, '/src/main.js');
    expect(r.body).toContain('v2');

    ws.close();
    await server.close();
  });
});
