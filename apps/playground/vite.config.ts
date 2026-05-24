import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { rifySwPlugin } from './build/sw-plugin.ts';

/**
 * COOP/COEP headers are mandatory for rifty: cross-origin isolation enables
 * `SharedArrayBuffer` and `Atomics.wait`, which we need in M6 for sync IPC.
 * See D-001.
 */
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export default defineConfig({
  plugins: [solid(), rifySwPlugin()],
  server: {
    port: 5273,
    strictPort: true,
    headers: crossOriginIsolationHeaders,
    // Dev proxy for npm registry (D-004) — keeps M9 wiring testable from day 1.
    proxy: {
      '/npm-registry': {
        target: 'https://registry.npmjs.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/npm-registry/, ''),
      },
    },
  },
  preview: {
    port: 5273,
    strictPort: true,
    headers: crossOriginIsolationHeaders,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['monaco-editor'],
  },
});
