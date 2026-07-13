/// <reference lib="webworker" />
/**
 * Node-server boot core (ADR-0148 / ADR-0150 P6b). The supervised child runs
 * the template entry against the owner's remote VFS, waits for listen(), then
 * serves the cross-realm preview route. Vite runs through its installed `.bin`
 * in node-entry-bootstrap; it has no curated path here.
 *
 * IMPORTANT: NO top-level side effects. Builtin registrars stay in the entry.
 */
import { dispatchToPort, listPorts, onRegistryChange, serveCrossRealmPreview } from '@riftydev/net';
import { Console } from '@riftydev/runtime-js/builtins/console';
import { __setCreateRequireImpl } from '@riftydev/runtime-js/builtins/module';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import type { NodeServerBootstrapConfig } from '../templates/project-spec.ts';
import type { DevServerHandle } from './dev-server-controller.ts';

const enc = new TextEncoder();

type Loader = ReturnType<typeof createModuleLoader>;

async function waitForListeningPort(port: number, timeoutMs: number): Promise<void> {
  if (listPorts().includes(port)) return;
  let unsubscribe: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      unsubscribe = onRegistryChange((changed, action) => {
        if (action === 'register' && changed === port) resolve();
      });
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `[real-vite/worker] entry never started listening on port ${port} — a node-server template entry must call listen(process.env.PORT)`,
            ),
          ),
        timeoutMs,
      );
      if (listPorts().includes(port)) resolve();
    });
  } finally {
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function bootNodeServer(
  cfg: NodeServerBootstrapConfig,
  loader: Loader,
  log: (chunk: string) => void,
): Promise<void> {
  const termWriter = {
    write(chunk: string): boolean {
      log(chunk);
      return true;
    },
  };
  (globalThis as { console: unknown }).console = new Console(termWriter, termWriter);

  log(`[real-vite/worker] starting server ${cfg.entryPath} on port ${cfg.port}…\n`);
  await loader.import(cfg.entryPath, `${cfg.root}/__entry__.mjs`);
  await waitForListeningPort(cfg.port, 10_000);
  log(`[real-vite/worker] server is listening on internal port ${cfg.port}\n`);
}

export async function bootDevServer(opts: {
  readonly cfg: NodeServerBootstrapConfig;
  readonly previewScope?: string;
  readonly publishSnapshot: () => void;
  readonly log: (chunk: string) => void;
}): Promise<DevServerHandle> {
  const { cfg, publishSnapshot, log } = opts;
  const { root, port } = cfg;
  const seedFs = syncMirror();

  seedFs.mkdirSync(root, { recursive: true });
  if (!seedFs.existsSync(`${root}/package.json`)) {
    seedFs.writeFileSync(`${root}/package.json`, enc.encode(cfg.packageJson));
  }
  for (const [seedPath, content] of Object.entries(cfg.seedFiles)) {
    const np = normalizePath(seedPath);
    if (np === `${root}/package.json`) continue;
    seedFs.mkdirSync(dirname(np), { recursive: true });
    if (!seedFs.existsSync(np)) seedFs.writeFileSync(np, enc.encode(content));
  }
  publishSnapshot();

  const loader = createModuleLoader(seedFs, { cwd: root });
  __setCreateRequireImpl((from: string) => {
    const fromPath = from.startsWith('file://')
      ? decodeURIComponent(from.slice('file://'.length))
      : from;
    const req = ((id: string) => loader.require(id, fromPath)) as ((id: string) => unknown) & {
      resolve: (id: string) => string;
      cache: Record<string, unknown>;
      extensions: Record<string, unknown>;
      main: undefined;
    };
    req.resolve = (id: string) =>
      loader.resolver.resolve(id, { fromFile: fromPath, esm: false }).id;
    req.cache = {};
    req.extensions = {};
    req.main = undefined;
    return req;
  });

  globalThis.process.env.PORT = String(port);
  await bootNodeServer(cfg, loader, log);
  publishSnapshot();

  const tearPreviewBridge = serveCrossRealmPreview(
    port,
    async (request) => dispatchToPort(port, request),
    opts.previewScope === undefined ? {} : { scope: opts.previewScope },
  );
  log('[real-vite/worker] preview bridge ready\n');

  return {
    port,
    async stop() {
      tearPreviewBridge();
    },
  };
}
