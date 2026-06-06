import { createLogger, defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { rifySwPlugin } from './build/sw-plugin.ts';

/**
 * monaco-editor 0.52 ships `marked.umd.js` with a dangling
 * `//# sourceMappingURL=marked.umd.js.map`, but never publishes the `.map`.
 * With monaco served as source (optimizeDeps.exclude below) Vite tries to read
 * it on every transform and logs a noisy `Failed to load source map …
 * marked.umd.js.map` warning. It is harmless (dev-only, no runtime effect), so
 * filter just that message instead of letting it drown the dev console.
 */
const quietLogger = createLogger();
const origWarn = quietLogger.warn.bind(quietLogger);
quietLogger.warn = (msg, opts) => {
  if (typeof msg === 'string' && /marked\.umd\.js\.map|Failed to load source map/.test(msg)) return;
  origWarn(msg, opts);
};

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
  customLogger: quietLogger,
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
