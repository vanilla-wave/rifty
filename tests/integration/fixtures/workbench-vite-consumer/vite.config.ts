import { defineConfig } from 'vite';

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Service-Worker-Allowed': '/',
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

export default defineConfig({
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
  },
  worker: {
    format: 'es',
  },
});
