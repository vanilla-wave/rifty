import { type Plugin, defineConfig } from 'vite';
import { rifySwPlugin } from './build/sw-plugin.ts';

const port = Number(process.env.RIFTY_NO_COI_PORT ?? 5411);

/** External-network fault boundary: admit the request, then stay silent. */
function stalledRegistryPlugin(): Plugin {
  return {
    name: 'rifty:no-coi-stalled-registry',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__no-coi-stall-registry', (_request, response) => {
        response.on('close', () => response.end());
      });
    },
  };
}

/** Dedicated headerless host. Never import the Playground COI config. */
export default defineConfig({
  cacheDir: `node_modules/.vite-no-coi-${port}`,
  plugins: [rifySwPlugin(), stalledRegistryPlugin()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    proxy: {
      '/npm-registry': {
        target: 'https://registry.npmjs.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/npm-registry/, ''),
      },
    },
  },
  worker: { format: 'es' },
  resolve: {
    alias: {
      os: '@riftydev/runtime-js/builtins/os',
      path: '@riftydev/runtime-js/builtins/path',
      perf_hooks: '@riftydev/runtime-js/builtins/perf_hooks',
      fs: '@riftydev/runtime-js/builtins/fs',
    },
  },
  define: {
    __filename: '"/typescript.js"',
    __dirname: '"/"',
  },
  optimizeDeps: {
    // A measured host must never reload because Vite discovers a late Worker
    // dependency. Explicit includes below are the only prebundled graph.
    noDiscovery: true,
    include: [
      '@riftydev/runtime-js > @jitl/quickjs-wasmfile-release-sync',
      '@riftydev/runtime-js > acorn',
      '@riftydev/runtime-js > cjs-module-lexer',
      '@riftydev/runtime-js > quickjs-emscripten-core',
      '@riftydev/git > isomorphic-git',
      'sql.js',
      'typescript',
    ],
  },
});
