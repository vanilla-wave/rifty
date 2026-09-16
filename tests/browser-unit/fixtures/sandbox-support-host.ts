import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { transform } from 'esbuild';

/** Browser-boundary faults prepended to the probe Worker, keyed by URL variant. */
const workerFaults: Record<string, string> = {
  'storage-denied':
    'navigator.storage.getDirectory = () => Promise.reject(new DOMException("test denial", "NotAllowedError"));',
  quota:
    'FileSystemFileHandle.prototype.createWritable = () => Promise.reject(new DOMException("test quota", "QuotaExceededError"));',
  'wasm-denied':
    'WebAssembly.compile = () => Promise.reject(new WebAssembly.CompileError("test WASM denial"));',
  // Hold the OPFS sync access handle open past the caller's probe deadline.
  'storage-slow': `const open = FileSystemFileHandle.prototype.createSyncAccessHandle;
FileSystemFileHandle.prototype.createSyncAccessHandle = async function (...args) {
  const handle = await open.apply(this, args);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  return handle;
};`,
  // Uncaught Worker failure after the load was already observed; OPFS stays pending.
  'late-error': `FileSystemFileHandle.prototype.createSyncAccessHandle = () => new Promise(() => {});
addEventListener('message', (event) => {
  if (event.data?.kind === 'storage')
    setTimeout(() => {
      throw new Error('late probe worker failure');
    }, 0);
});`,
};

/**
 * Native HTTP CSP also applies to nested Workers and SW requests. `publishedAssets` serves the
 * `/published/` variant from assets the real publishing build emitted.
 */
export async function startSupportHost(upstream: string, publishedAssets: string) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', upstream);
      const path = url.pathname;
      const coi = !path.startsWith('/non-coi/');
      if (coi) {
        response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      }
      if (path.endsWith('/page')) {
        const policy = path.includes('/worker-denied/') ? "worker-src 'none'" : '';
        if (policy) response.setHeader('Content-Security-Policy', policy);
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Sandbox support</title>');
        return;
      }
      if (path.endsWith('/existing-sw.js')) {
        response.setHeader('Content-Type', 'text/javascript');
        response.setHeader('Service-Worker-Allowed', '/');
        response.end('');
        return;
      }
      const asset = /\/(support-(?:worker|child|module|service-worker))\.js$/.exec(path)?.[1];
      if (asset) {
        response.setHeader('Content-Type', 'text/javascript');
        if (path.includes('/published/')) {
          response.end(await readFile(resolve(publishedAssets, `${asset}.js`)));
          return;
        }
        if (path.includes('/sw-denied/') && asset === 'support-service-worker') {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }
        if (path.includes('/dead/') && asset === 'support-worker') {
          response.end('throw new Error("probe worker died")');
          return;
        }
        if (path.includes('/stalled/') && asset === 'support-worker') {
          response.end('setInterval(() => {}, 1000)');
          return;
        }
        if (path.includes('/import-denied/') && asset === 'support-module') {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }
        if (asset === 'support-worker') {
          const policy = path.includes('/nested-denied/')
            ? "script-src 'self' 'unsafe-eval'; worker-src 'none'"
            : path.includes('/wasm-only/')
              ? "script-src 'self' 'wasm-unsafe-eval'"
              : path.includes('/no-eval/')
                ? "script-src 'self'"
                : '';
          if (policy) response.setHeader('Content-Security-Policy', policy);
        }
        const source = await readFile(
          resolve(`packages/workbench/src/support/${asset}.ts`),
          'utf8',
        );
        const { code } = await transform(source, { loader: 'ts', target: 'es2022' });
        const fault =
          asset === 'support-worker'
            ? (Object.entries(workerFaults).find(([variant]) =>
                path.includes(`/${variant}/`),
              )?.[1] ?? '')
            : '';
        response.end(`${fault}\n${code}`);
        return;
      }
      const upstreamResponse = await fetch(url);
      response.statusCode = upstreamResponse.status;
      const contentType = upstreamResponse.headers.get('content-type');
      if (contentType) response.setHeader('Content-Type', contentType);
      response.end(new Uint8Array(await upstreamResponse.arrayBuffer()));
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing support host address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
