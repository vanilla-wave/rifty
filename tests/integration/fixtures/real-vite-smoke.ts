/**
 * Real Vite smoke — standalone (run via `tsx`), NOT a vitest test.
 *
 * Mirrors `apps/playground/src/workers/real-vite-bootstrap.ts` steps 1-6
 * in-process: install real Vite from the live registry, overlay the
 * esbuild/rollup shims, build the loader, `import('vite')`, `createServer`,
 * `listen`, `transformRequest`. The Worker/HMR/preview bridges are browser-only
 * and omitted; HMR is disabled in this smoke only because it never opens a
 * browser WebSocket client. Native HMR is covered by
 * `tests/integration/vite-hmr-channel.test.ts`.
 *
 * It replaces `globalThis.process` with rifty's shim (matching the worker
 * realm), which is incompatible with vitest's child-process IPC — hence a
 * standalone script driven by `tests/integration/vite-live-run.opt-in.test.ts`
 * (which spawns it) rather than an in-process vitest test.
 *
 * Run directly:
 *   RIFTY_LIVE_REGISTRY=https://registry.npmjs.org npx tsx \
 *     tests/integration/fixtures/real-vite-smoke.ts
 *
 * Prints `RIFTY_VITE_SMOKE_OK` and exits 0 on success.
 */
import '../../../packages/net/src/register-builtins.ts';
import { RegistryClient, install } from '../../../packages/npm-client/src/index.ts';
import { Buffer as RiftyBuffer } from '../../../packages/runtime-js/src/builtins/buffer.ts';
import { __setCreateRequireImpl } from '../../../packages/runtime-js/src/builtins/module.ts';
import {
  installProcessGlobals,
  setProcessCwd,
} from '../../../packages/runtime-js/src/builtins/process.ts';
import { installTimerGlobals } from '../../../packages/runtime-js/src/builtins/timers.ts';
import { createModuleLoader } from '../../../packages/runtime-js/src/module-loader/index.ts';
import { dirname, normalizePath } from '../../../packages/vfs/src/index.ts';
import { createMemoryFs, setSyncMirror } from '../../../packages/vfs/src/internal/index.ts';
import { esbuildShimFiles, rollupShimFiles } from '../../../tools/shadow-registry/src/index.ts';

// biome-ignore lint/suspicious/noExplicitAny: smoke harness.
type Any = any;
const realExit = process.exit.bind(process);
const realEnv = { ...process.env };
const log = (m: string): void => {
  process.stdout.write(`[vite-smoke] ${m}\n`);
};
const ROOT = '/workspace';

setTimeout(() => {
  log('TIMEOUT (240s) — forcing exit');
  realExit(99);
}, 240_000).unref?.();

async function main(): Promise<void> {
  if (!realEnv.RIFTY_LIVE_REGISTRY) {
    log('RIFTY_LIVE_REGISTRY not set — skipping');
    realExit(0);
    return;
  }
  const viteSpec = realEnv.RIFTY_VITE_SPEC ?? 'latest';

  const { vfs, fsSync } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
  installProcessGlobals();
  installTimerGlobals();
  (globalThis as Any).Buffer = RiftyBuffer;
  (globalThis as Any).process.env = { ...realEnv, NODE_ENV: 'development' };
  setProcessCwd(ROOT);

  const enc = new TextEncoder();
  fsSync.mkdirSync(`${ROOT}/src`, { recursive: true });
  fsSync.writeFileSync(
    `${ROOT}/index.html`,
    enc.encode(
      '<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>',
    ),
  );
  fsSync.writeFileSync(
    `${ROOT}/src/main.js`,
    enc.encode("document.body.textContent='hi from vite'\n"),
  );
  fsSync.writeFileSync(
    `${ROOT}/package.json`,
    enc.encode(
      JSON.stringify({
        name: 'app',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: { vite: viteSpec },
      }),
    ),
  );

  log(`installing vite@${viteSpec} ...`);
  const registry = new RegistryClient({
    baseUrl: realEnv.RIFTY_LIVE_REGISTRY,
    fetch: globalThis.fetch,
  });
  const result = await install('app', '0.0.0', { vite: viteSpec }, { vfs, cwd: ROOT, registry });
  log(`installed ${result.packages.length} packages`);

  for (const [path, content] of [
    ...Object.entries(esbuildShimFiles),
    ...Object.entries(rollupShimFiles),
  ]) {
    const np = normalizePath(path);
    fsSync.mkdirSync(dirname(np), { recursive: true });
    fsSync.writeFileSync(np, enc.encode(content as string));
  }
  log('esbuild + rollup shims overlaid');

  const loader = createModuleLoader(fsSync, { cwd: ROOT });
  __setCreateRequireImpl((from: string) => {
    const fromPath = from.startsWith('file://') ? decodeURIComponent(from.slice(7)) : from;
    const req = ((id: string) => loader.require(id, fromPath)) as Any;
    req.resolve = (id: string) =>
      loader.resolver.resolve(id, { fromFile: fromPath, esm: false }).id;
    req.cache = {};
    req.extensions = {};
    req.main = undefined;
    return req;
  });

  log('importing vite ...');
  const ns = (await loader.import('vite', `${ROOT}/__entry__.mjs`)) as Any;
  log(`VITE LOADED — createServer is ${typeof ns.createServer}`);

  const server = await ns.createServer({
    root: ROOT,
    server: {
      port: 5174,
      strictPort: true,
      middlewareMode: false,
      hmr: false,
      host: true,
    },
    appType: 'spa',
    clearScreen: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'silent',
  });
  await server.listen();
  log('VITE LISTENING');
  const r = await server.transformRequest('/src/main.js');
  log(`transformRequest('/src/main.js') -> ${r ? `${(r.code ?? '').length} bytes` : 'null'}`);
  await server.close();
  log('CLOSED');
  if (!r || !r.code) {
    log('FAIL: transformRequest returned no code');
    realExit(2);
    return;
  }
  log('RIFTY_VITE_SMOKE_OK');
  realExit(0);
}

main().catch((e) => {
  log(`UNCAUGHT: ${(e as Error)?.stack ?? e}`);
  realExit(3);
});
