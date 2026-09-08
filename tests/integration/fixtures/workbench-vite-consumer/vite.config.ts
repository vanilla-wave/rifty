import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const consumerRoot = dirname(fileURLToPath(import.meta.url));

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

function copyWorkbenchRuntime(): void {
  const from = resolve(consumerRoot, 'node_modules/@riftydev/workbench/dist/runtime');
  if (!existsSync(from)) {
    throw new Error(
      'copyable Workbench runtime assets are missing under @riftydev/workbench/dist/runtime',
    );
  }
  const to = resolve(consumerRoot, 'public/runtime');
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

copyWorkbenchRuntime();

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
});
