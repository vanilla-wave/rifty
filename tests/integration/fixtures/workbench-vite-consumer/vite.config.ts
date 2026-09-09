import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type PreviewServer, type ViteDevServer, defineConfig } from 'vite';

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

const registryTarget = process.env.RIFTY_PACKED_CONSUMER_REGISTRY_TARGET;
const registryProxy =
  registryTarget === undefined
    ? undefined
    : {
        '/npm-registry': {
          target: registryTarget,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/npm-registry/u, ''),
        },
      };

function allowLegacyRootServiceWorker(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((request, response, next) => {
    if (request.url?.split('?')[0] === '/rifty/sw.js')
      response.setHeader('Service-Worker-Allowed', '/');
    next();
  });
}

export default defineConfig({
  plugins: [
    {
      name: 'explicit-legacy-root-service-worker-allowance',
      configureServer: allowLegacyRootServiceWorker,
      configurePreviewServer: allowLegacyRootServiceWorker,
    },
    {
      name: 'producer-http-decoding-proof',
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === '/required-missing-snapshot.tar.gz') {
            response.statusCode = 404;
            response.end('snapshot fixture is unavailable');
            return;
          }
          if (request.url !== '/producer-snapshot-decoded.tar') return next();
          response.setHeader('Content-Type', 'application/x-tar');
          response.setHeader('Content-Encoding', 'gzip');
          response.end(readFileSync(resolve('dist/producer-snapshot.tar.gz')));
        });
      },
    },
  ],
  server: {
    headers: crossOriginIsolationHeaders,
    proxy: registryProxy,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
    proxy: registryProxy,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { root: resolve('index.html'), sandbox: resolve('sandbox/index.html') },
    },
  },
});
