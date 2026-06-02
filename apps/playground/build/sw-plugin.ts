/**
 * Vite plugin: bundles the Service Worker source from
 * `packages/service-worker/src/sw.ts` into `apps/playground/public/sw.js`.
 *
 * Source of truth: ADR 0016. The handwritten `sw.js` used to drift from the
 * TypeScript module on every protocol change; this plugin makes the TS module
 * the only place SW logic lives and regenerates the served `sw.js` on every
 * build and dev-server start.
 *
 * Dev mode: re-bundles whenever a file under `packages/service-worker/src/`
 * changes. Vite already watches workspace packages, so we attach to its
 * file-watcher and trigger a rebuild + full reload.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';

// Vite always ships esbuild as a transitive dependency, but pnpm's strict
// hoisting hides it from the playground's own resolution. Resolve esbuild
// through `vite`'s package directory so we don't have to add a duplicate
// devDependency entry just to declare what's already installed. Typing is
// kept minimal here (no `import type from 'esbuild'`) because the playground's
// `tsconfig.json` does not have esbuild on its typeRoots — and we only need a
// surface that covers what we call.
interface EsbuildOutputFile {
  readonly text: string;
}
interface EsbuildBuildResult {
  readonly outputFiles?: readonly EsbuildOutputFile[];
}
interface EsbuildBuildOptions {
  entryPoints: string[];
  bundle: boolean;
  format: 'esm' | 'iife';
  platform: 'browser';
  target: string;
  minify: boolean;
  write: boolean;
  sourcemap: boolean;
  logLevel: 'silent';
}
interface EsbuildModule {
  build: (options: EsbuildBuildOptions) => Promise<EsbuildBuildResult>;
}

const requireFromVite = createRequire(
  createRequire(import.meta.url).resolve('vite/package.json'),
);
const esbuild = requireFromVite('esbuild') as EsbuildModule;
const { build } = esbuild;

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/playground/build → repo root is three levels up.
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const SW_ENTRY = resolve(REPO_ROOT, 'packages/service-worker/src/sw.ts');
const SW_OUTPUT = resolve(REPO_ROOT, 'apps/playground/public/sw.js');
const SW_WATCH_DIR = resolve(REPO_ROOT, 'packages/service-worker/src');

const HEADER =
  '// Generated from packages/service-worker/src/sw.ts — do not edit. Source of truth: ADR 0016.\n';

interface SwPluginOptions {
  /**
   * Output format. The playground registers the SW with the default
   * `type: 'module'` (see `packages/service-worker/src/register.ts`), so
   * `'esm'` is the matching format. Override only if registration changes.
   */
  format?: 'esm' | 'iife';
}

async function bundleServiceWorker(format: 'esm' | 'iife'): Promise<void> {
  const options: EsbuildBuildOptions = {
    entryPoints: [SW_ENTRY],
    bundle: true,
    format,
    platform: 'browser',
    target: 'es2022',
    minify: false,
    write: false,
    sourcemap: false,
    logLevel: 'silent',
  };
  const result = await build(options);
  const output = result.outputFiles?.[0];
  if (!output) {
    throw new Error('sw-plugin: esbuild produced no output for sw.ts');
  }
  await mkdir(dirname(SW_OUTPUT), { recursive: true });
  const existing = await readFile(SW_OUTPUT, 'utf8').catch(() => '');
  const next = HEADER + output.text;
  if (existing === next) return;
  await writeFile(SW_OUTPUT, next, 'utf8');
}

export function rifySwPlugin(options: SwPluginOptions = {}): Plugin {
  const format = options.format ?? 'esm';
  let server: ViteDevServer | undefined;

  return {
    name: 'rifty:sw-bundle',
    async buildStart() {
      await bundleServiceWorker(format);
    },
    configureServer(devServer) {
      server = devServer;
      // Watch the SW source so dev-mode edits propagate. Vite's watcher
      // already covers workspace packages for HMR; we hook into it instead of
      // spinning up our own chokidar instance.
      devServer.watcher.add(SW_WATCH_DIR);
      const handler = async (file: string): Promise<void> => {
        if (!file.startsWith(SW_WATCH_DIR)) return;
        try {
          await bundleServiceWorker(format);
          server?.ws.send({ type: 'full-reload' });
        } catch (err) {
          devServer.config.logger.error(
            `[rifty:sw-bundle] rebundle failed: ${(err as Error).message}`,
          );
        }
      };
      devServer.watcher.on('change', handler);
      devServer.watcher.on('add', handler);
    },
  };
}
