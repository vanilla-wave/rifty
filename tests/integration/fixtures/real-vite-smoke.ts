/**
 * Real Vite smoke — standalone (run via `tsx`), NOT a vitest test.
 *
 * Mirrors `apps/playground/src/workers/real-vite-bootstrap.ts` install steps
 * in-process: install real vite@8 from the live registry (the installer applies
 * the shadow-registry internals shims itself, ADR-0188), then (only in a
 * SAB/kernel-backed Worker realm) build the loader, `import('vite')`,
 * `createServer`, `listen`, and `transformRequest`.
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
 * Prints `RIFTY_VITE_SMOKE_OK` and exits 0 on success. Prints
 * `RIFTY_VITE_SMOKE_REQUIRES_KERNEL_WORKERS` and exits 0 when run from a plain
 * Node realm that cannot honestly run Rolldown's WASI pthread worker pool; the
 * Vitest driver treats that marker as a skip, not as serve/createServer proof.
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
import { createMemoryFs, setSyncMirror } from '../../../packages/vfs/src/internal/index.ts';

// biome-ignore lint/suspicious/noExplicitAny: smoke harness.
type Any = any;
const realExit = process.exit.bind(process);
const realEnv = { ...process.env };
const log = (m: string): void => {
  process.stdout.write(`[vite-smoke] ${m}\n`);
};
const ROOT = '/workspace';

async function withStepTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  const viteSpec = realEnv.RIFTY_VITE_SPEC ?? '8.0.16';

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
  log(`installed ${result.packages.length} packages (shadow shims applied at install time)`);

  if (!hasKernelBackedWorkerCapabilities()) {
    log(
      `RIFTY_VITE_SMOKE_REQUIRES_KERNEL_WORKERS — vite@${viteSpec} installed (install-time shims); import/createServer requires a SAB + kernel-backed Worker realm for Rolldown WASI pthreads`,
    );
    realExit(0);
    return;
  }

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

  const parseNs = (await loader.import('rolldown/parseAst', `${ROOT}/__entry__.mjs`)) as Any;
  const parsed = parseNs.parseAst('export const x = 1;\n');
  log(`ROLLDOWN PARSE OK — ast type ${parsed?.type ?? typeof parsed}`);

  const server = await withStepTimeout(
    'createServer',
    ns.createServer({
      root: ROOT,
      server: { port: 5174, strictPort: true, middlewareMode: false, hmr: false, host: true },
      appType: 'spa',
      clearScreen: false,
      // Vite 8 dropped `optimizeDeps.disabled` (warns + ignores it); the supported
      // off-switch is `noDiscovery` + empty `include` — match production boot.
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'silent',
    }),
  );
  await withStepTimeout('server.listen', server.listen());
  log('VITE LISTENING');
  const r = await withStepTimeout(
    'transformRequest(/src/main.js)',
    server.transformRequest('/src/main.js'),
  );
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

function hasKernelBackedWorkerCapabilities(): boolean {
  const g = globalThis as typeof globalThis & { crossOriginIsolated?: boolean };
  const atomicsWithWaitAsync = Atomics as unknown as { waitAsync?: unknown };
  return (
    g.crossOriginIsolated === true &&
    typeof SharedArrayBuffer === 'function' &&
    typeof atomicsWithWaitAsync.waitAsync === 'function' &&
    typeof realEnv.RIFTY_KERNEL_WORKER_URL === 'string' &&
    typeof realEnv.RIFTY_NODE_ENTRY_WORKER_URL === 'string'
  );
}

main().catch((e) => {
  log(`UNCAUGHT: ${(e as Error)?.stack ?? e}`);
  realExit(3);
});
