import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { brotliCompressSync, brotliDecompressSync, gunzipSync } from 'node:zlib';
import { chromium, expect, test } from '@playwright/test';
import { build } from 'esbuild';
import type { fetchVerifiedDepSnapshot } from '../../packages/workbench/src/glue/dep-snapshot.ts';
import type { produceDependencySnapshot } from '../../packages/workbench/src/index.ts';

declare global {
  interface Window {
    brotliProof: {
      produceDependencySnapshot: typeof produceDependencySnapshot;
      fetchVerifiedDepSnapshot: typeof fetchVerifiedDepSnapshot;
    };
  }
}

test('Chromium public producer → native Brotli oracle → HTTP decoding, identity and bounded failures', async () => {
  const bundle = await build({
    stdin: {
      contents: `import { produceDependencySnapshot } from './packages/workbench/src/index.ts';
import { fetchVerifiedDepSnapshot } from './packages/workbench/src/glue/dep-snapshot.ts';
globalThis.brotliProof = { produceDependencySnapshot, fetchVerifiedDepSnapshot };`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
  });
  const meta = JSON.parse(
    await readFile(
      new URL('../integration/fixtures/registry/ms-2.0.0.json', import.meta.url),
      'utf8',
    ),
  ) as { dist: { upstreamTarball: string; upstreamIntegrity: string } };
  const tgz = await readFile(
    new URL('../integration/fixtures/registry/ms-2.0.0.tgz', import.meta.url),
  );
  const representations = new Map<
    string,
    { bytes: Uint8Array; encoding?: string; length?: number; status?: number }
  >();
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(bundle.outputFiles[0]!.contents);
    } else if (request.url === '/ms/-/ms-2.0.0.tgz') {
      response.end(tgz);
    } else if (representations.has(request.url ?? '')) {
      const rep = representations.get(request.url ?? '')!;
      response.statusCode = rep.status ?? 200;
      response.setHeader('Content-Type', 'application/x-tar');
      response.setHeader('Vary', 'Accept-Encoding');
      if (rep.encoding) response.setHeader('Content-Encoding', rep.encoding);
      response.setHeader('Content-Length', rep.length ?? rep.bytes.length);
      response.end(rep.bytes);
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<script src="/bundle.js"></script>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP test port');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    const manifest = {
      name: 'browser-producer-ms',
      version: '1.0.0',
      dependencies: { ms: '2.0.0' },
    };
    const options = {
      registryUrl: origin,
      templateId: 'browser-ms',
      packageJsonText: JSON.stringify(manifest),
      packageLockText: JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': manifest,
          'node_modules/ms': {
            version: '2.0.0',
            resolved: meta.dist.upstreamTarball,
            integrity: meta.dist.upstreamIntegrity,
          },
        },
      }),
    };
    const produced = await page.evaluate(async (options) => {
      const gzip = await window.brotliProof.produceDependencySnapshot(options);
      const br = await window.brotliProof.produceDependencySnapshot({ ...options, encoding: 'br' });
      return {
        gzip: { ...gzip, archive: Array.from(gzip.archive) },
        br: { ...br, archive: Array.from(br.archive) },
      };
    }, options);
    expect(produced.br.contentEncoding).toBe('br');
    expect(produced.gzip.contentEncoding).toBe('gzip');
    const br = Uint8Array.from(produced.br.archive);
    const gzip = Uint8Array.from(produced.gzip.archive);
    const tar = gunzipSync(gzip);
    expect(brotliDecompressSync(br)).toEqual(tar);
    expect(produced.br.snapshotId).toBe(produced.gzip.snapshotId);
    expect(produced.br.installArtifactIdentity).toBe(produced.gzip.installArtifactIdentity);
    representations.set('/br', { bytes: br, encoding: 'br' });
    representations.set('/gzip', { bytes: gzip, encoding: 'gzip' });
    representations.set('/raw-br', { bytes: br });
    representations.set('/changed', {
      bytes: brotliCompressSync(Buffer.from('wrong snapshot')),
      encoding: 'br',
    });
    representations.set('/corrupt', { bytes: new Uint8Array([255, 255, 255]), encoding: 'br' });
    representations.set('/truncated', {
      bytes: br.slice(0, br.length / 2),
      encoding: 'br',
      length: br.length,
    });
    representations.set('/header-oversize', {
      bytes: br,
      encoding: 'br',
      length: 128 * 1024 * 1024 + 1,
    });
    representations.set('/decoded-oversize', {
      bytes: brotliCompressSync(Buffer.alloc(128 * 1024 * 1024 + 1), { params: { 1: 0 } }),
      encoding: 'br',
    });
    representations.set('/unavailable', { bytes: new Uint8Array(), status: 503 });
    const outcomes = await page.evaluate(async (snapshotId) => {
      const results: Record<string, string> = {};
      for (const path of [
        '/br',
        '/gzip',
        '/raw-br',
        '/changed',
        '/corrupt',
        '/truncated',
        '/header-oversize',
        '/decoded-oversize',
        '/unavailable',
      ]) {
        try {
          results[path] = (
            await window.brotliProof.fetchVerifiedDepSnapshot(path, snapshotId)
          ).status;
        } catch (error) {
          results[path] = `error: ${String(error)}`;
        }
      }
      return results;
    }, produced.br.snapshotId);
    expect(outcomes['/br']).toBe('matched');
    expect(outcomes['/gzip']).toBe('matched');
    expect(outcomes['/raw-br']).toBe('mismatch');
    expect(outcomes['/changed']).toBe('mismatch');
    for (const path of [
      '/corrupt',
      '/truncated',
      '/header-oversize',
      '/decoded-oversize',
      '/unavailable',
    ])
      expect(outcomes[path], path).toMatch(/^error:/);
    expect(outcomes['/header-oversize']).toMatch(/exceed/i);
    expect(outcomes['/decoded-oversize']).toMatch(/exceed/i);
    expect(outcomes['/unavailable']).toMatch(/503/);
    // Native platform failure, not a mocked Rifty sibling or codec.
    const broken = await browser.newPage();
    await broken.addInitScript(() => {
      WebAssembly.instantiate = async () => {
        throw new Error('WASM denied by host');
      };
    });
    await broken.goto(origin);
    const failure = await broken.evaluate(async (options) => {
      try {
        await window.brotliProof.produceDependencySnapshot({ ...options, encoding: 'br' });
        return 'emitted';
      } catch (error) {
        return String(error);
      }
    }, options);
    expect(failure).toContain('WASM denied by host');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
