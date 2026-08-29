import { readFile } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Plugin, createLogger, defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { rifySwPlugin } from './build/sw-plugin.ts';

/**
 * Dev-only static route for e2e fixtures (`tests/e2e/fixtures/` →
 * `/__e2e-fixtures/*`): specs seed multi-KB project files (npm-authored
 * lockfiles) into the browser shell via in-realm `fetch`, which a terminal
 * one-liner cannot carry. Never part of the production build.
 */
function e2eFixturesPlugin(): Plugin {
  const fixturesDir = resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '../../tests/e2e/fixtures',
  );
  return {
    name: 'rifty-e2e-fixtures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__e2e-fixtures', (req, res, next) => {
        void (async () => {
          const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'));
          const target = join(fixturesDir, rel);
          if (!target.startsWith(fixturesDir)) {
            res.statusCode = 403;
            res.end('forbidden');
            return;
          }
          try {
            const bytes = await readFile(target);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.end(bytes);
          } catch {
            next();
          }
        })();
      });
    },
  };
}

/**
 * Dev-only snapshot fault seam for restore-visibility e2e
 * (`tests/e2e/restore-progress-visibility.spec.ts`): the baked-snapshot fetch is
 * SW-mediated, so playwright route() never sees it and network throttling would
 * drag the whole module graph — the only faithful slow/fail injection point is
 * the dev server itself. Cookie `rifty-e2e-snapshot-fault` = `delay:<ms>`
 * (stall delivery) or `status:<code>` (fail the fetch). Never part of the
 * production build.
 */
function snapshotFaultPlugin(): Plugin {
  return {
    name: 'rifty-snapshot-fault',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.includes('node-modules.json.gz')) return next();
        const fault = /(?:^|;\s*)rifty-e2e-snapshot-fault=([^;]+)/.exec(
          req.headers.cookie ?? '',
        )?.[1];
        if (fault === undefined) return next();
        const [kind, value] = decodeURIComponent(fault).split(':');
        if (kind === 'delay') return void setTimeout(next, Number(value));
        if (kind === 'status') {
          res.statusCode = Number(value);
          return void res.end();
        }
        next();
      });
    },
  };
}

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

// Overridable so parallel checkouts (git worktrees) can run dev/e2e side by
// side; playwright.config.ts reads the same env. Default stays 5273.
const port = Number(process.env.RIFTY_PLAYGROUND_PORT ?? 5273);

export default defineConfig({
  customLogger: quietLogger,
  plugins: [solid(), rifySwPlugin(), e2eFixturesPlugin(), snapshotFaultPlugin()],
  server: {
    port,
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
    port,
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
  resolve: {
    // The ts-language-service worker bundles the `typescript` engine, which does
    // node-builtin work at module-eval (`os.platform()` for case-sensitivity
    // detection, `perf_hooks.performance` for its timer). Vite otherwise
    // externalizes these bare specifiers to an EMPTY browser stub → e.g. `_os.
    // platform is not a function` crashes the LS worker (ADR-0166 P1.9). Resolve
    // them to rifty's REAL Node shims (ADR-0026 — the same modules backing the
    // `require('os')` registry). Scoped in practice to bundled deps: NO first-party
    // source imports these bare specifiers (it uses `node:*` + the module registry).
    alias: {
      os: '@riftydev/runtime-js/builtins/os',
      path: '@riftydev/runtime-js/builtins/path',
      perf_hooks: '@riftydev/runtime-js/builtins/perf_hooks',
      fs: '@riftydev/runtime-js/builtins/fs',
    },
  },
  define: {
    // The `typescript` UMD references CJS module globals (`__filename`/`__dirname`)
    // at eval; Vite's ESM worker output leaves them undefined → `ReferenceError:
    // __filename is not defined` crashes the LS worker. Define harmless POSIX
    // placeholders (TS only uses them for diagnostic path strings, never real fs
    // — the VFS host serves files). Textual replacement, so scoped to where the
    // identifiers actually appear (the bundled compiler).
    __filename: '"/typescript.js"',
    __dirname: '"/"',
  },
  optimizeDeps: {
    exclude: ['monaco-editor'],
    // Pre-bundle deps first seen from Worker/child graphs. Late discovery makes
    // dev Vite re-optimize and FULL-RELOAD the page mid-session (drops owner state).
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
