import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Plugin, defineConfig } from 'vite';
import { buildSupportAssets, supportAssets } from '../../tools/publishing/build-support-assets.mjs';
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

/** Same emitted prerequisite probes as the published SDK; no product substitution. */
function browserSupportProbes(): Plugin {
  return {
    name: 'rifty:browser-support-probes',
    async configureServer(server) {
      const directory = resolve('node_modules/.browser-support-probes');
      await buildSupportAssets(directory);
      server.middlewares.use('/browser-support-probes', (request, response, next) => {
        const name = request.url?.split('?')[0]?.slice(1);
        if (!supportAssets.some((entry: string) => `${entry}.js` === name)) return next();
        readFile(resolve(directory, name!)).then((bytes) => {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(bytes);
        }, next);
      });
    },
  };
}

/** Dedicated headerless host. Never import the Playground COI config. */
export default defineConfig({
  cacheDir: `node_modules/.vite-no-coi-${port}`,
  plugins: [rifySwPlugin(), stalledRegistryPlugin(), browserSupportProbes()],
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
      '@riftydev/agent > @earendil-works/pi-agent-core',
      '@riftydev/agent > @earendil-works/pi-ai',
      '@riftydev/agent > @earendil-works/pi-ai/api/openai-completions',
      '@riftydev/runtime-js > @jitl/quickjs-wasmfile-release-sync',
      '@riftydev/runtime-js > acorn',
      '@riftydev/runtime-js > cjs-module-lexer',
      '@riftydev/runtime-js > quickjs-emscripten-core',
      '@riftydev/git > isomorphic-git',
      '@riftydev/workbench > semver/functions/valid.js',
      '@riftydev/workbench > semver/ranges/valid.js',
      '@riftydev/workbench > semver/ranges/subset.js',
      '@riftydev/workbench > semver/ranges/intersects.js',
      'sql.js',
      'typescript',
    ],
  },
});
