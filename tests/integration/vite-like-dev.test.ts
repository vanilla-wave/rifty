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

import { transform as transformWithHostEsbuild } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { type TransformModule, startDevServer } from '../../examples/vite-like-dev/src/index.ts';
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
const hostTransformModule: TransformModule = async ({ source, loader }) =>
  (
    await transformWithHostEsbuild(source, {
      loader,
      format: 'esm',
      jsx: loader === 'tsx' || loader === 'jsx' ? 'automatic' : undefined,
      supported: { decorators: false },
    })
  ).code;

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

  it('transforms TypeScript modules through an explicit executable boundary', async () => {
    writeFile('/workspace/index.html', '<!doctype html><body></body>');
    writeFile(
      '/workspace/src/main.ts',
      'const n: number = 2 satisfies number;\nexport const v = n;\n',
    );
    const server = await startDevServer({
      root: '/workspace',
      port: 3013,
      watchInterval: 5,
      transformModule: hostTransformModule,
    });
    try {
      const resp = await dispatchToPort(3013, new Request('http://x/src/main.ts'));
      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toContain('const n = 2;');
      expect(body).not.toContain(': number');
      expect(body).not.toContain('satisfies');
    } finally {
      await server.close();
    }
  });

  it('fails loudly when a TypeScript request has no transform capability', async () => {
    writeFile('/workspace/index.html', '<!doctype html><body></body>');
    writeFile('/workspace/src/main.ts', 'export const value: number = 42;\n');
    const server = await startDevServer({ root: '/workspace', port: 3019, watchInterval: 5 });
    try {
      const response = await dispatchText(3019, '/src/main.ts');
      expect(response.status).toBe(500);
      expect(response.body).toContain('Not implemented: vite-like-dev.transformModule');
    } finally {
      await server.close();
    }
  });

  it('rewrites bare ESM specifiers to served node_modules URLs', async () => {
    writeFile('/workspace/index.html', '<!doctype html><body></body>');
    writeFile(
      '/workspace/src/main.js',
      "import { answer } from 'pkg';\nexport const v = answer;\n",
    );
    writeFile('/workspace/node_modules/pkg/package.json', '{"name":"pkg","exports":"./index.js"}');
    writeFile('/workspace/node_modules/pkg/index.js', 'export const answer = 42;\n');
    const server = await startDevServer({ root: '/workspace', port: 3014, watchInterval: 5 });
    try {
      const r = await dispatchText(3014, '/src/main.js');
      expect(r.status).toBe(200);
      expect(r.body).toContain('from "/node_modules/pkg/index.js"');
    } finally {
      await server.close();
    }
  });

  it('rewrites extensionless relative TS imports to served resolved URLs', async () => {
    writeFile('/workspace/index.html', '<!doctype html><body></body>');
    writeFile(
      '/workspace/src/main.ts',
      "import { value } from './dep';\nexport const v = value;\n",
    );
    writeFile('/workspace/src/dep.ts', 'export const value: number = 42;\n');
    const server = await startDevServer({
      root: '/workspace',
      port: 3015,
      watchInterval: 5,
      transformModule: hostTransformModule,
    });
    try {
      const r = await dispatchText(3015, '/src/main.ts');
      expect(r.status).toBe(200);
      expect(r.body).toContain('from "/src/dep.ts"');

      const dep = await dispatchText(3015, '/src/dep.ts');
      expect(dep.status).toBe(200);
      expect(dep.body).toContain('const value = 42;');
    } finally {
      await server.close();
    }
  });

  it('preserves query and hash suffixes when rewriting extensionless TS imports', async () => {
    writeFile('/workspace/index.html', '<!doctype html><body></body>');
    writeFile(
      '/workspace/src/main.ts',
      "import { value } from './dep?raw#named';\nexport const v = value;\n",
    );
    writeFile('/workspace/src/dep.ts', 'export const value: number = 42;\n');
    const server = await startDevServer({
      root: '/workspace',
      port: 3016,
      watchInterval: 5,
      transformModule: hostTransformModule,
    });
    try {
      const r = await dispatchText(3016, '/src/main.ts');
      expect(r.status).toBe(200);
      expect(r.body).toContain('from "/src/dep.ts?raw#named"');
    } finally {
      await server.close();
    }
  });

  it('rewrites tsconfig path aliases and baseUrl imports through the dev-server loader', async () => {
    writeFile('/workspace/index.html', '<!doctype html><body></body>');
    writeFile(
      '/workspace/tsconfig.json',
      '{ "compilerOptions": { "baseUrl": "src", "paths": { "@/*": ["aliases/*"] } } }',
    );
    writeFile(
      '/workspace/src/main.ts',
      "import { aliasValue } from '@/value';\nimport { baseValue } from 'base';\nexport const v = aliasValue + baseValue;\n",
    );
    writeFile('/workspace/src/aliases/value.ts', 'export const aliasValue: number = 40;\n');
    writeFile('/workspace/src/base.ts', 'export const baseValue: number = 2;\n');
    const server = await startDevServer({
      root: '/workspace',
      port: 3017,
      watchInterval: 5,
      transformModule: hostTransformModule,
    });
    try {
      const r = await dispatchText(3017, '/src/main.ts');
      expect(r.status).toBe(200);
      expect(r.body).toContain('from "/src/aliases/value.ts"');
      expect(r.body).toContain('from "/src/base.ts"');
    } finally {
      await server.close();
    }
  });

  it('refuses to serve declaration files as runnable modules', async () => {
    writeFile('/workspace/index.html', '<!doctype html><body></body>');
    writeFile('/workspace/src/types.d.ts', 'export interface Api { value: string }\n');
    const server = await startDevServer({ root: '/workspace', port: 3018, watchInterval: 5 });
    try {
      const r = await dispatchText(3018, '/src/types.d.ts');
      expect(r.status).toBe(500);
      expect(r.body).toContain('Declaration files are not runnable modules');
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
