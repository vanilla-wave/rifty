/**
 * Node-server lifecycle behind one seam: route console output, choose direct
 * entry vs the installed nodemon CLI, and prove the resulting app is listening.
 */
import { httpGet, listPorts, onRegistryChange } from '@riftydev/net';
import { Console } from '@riftydev/runtime-js/builtins/console';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { syncMirror } from '@riftydev/vfs';
import type {
  NodeServerBootstrapConfig,
  NodeServerProjectSpec,
} from '../templates/project-spec.ts';
import { nodemonDevArguments } from '../templates/project-spec.ts';

interface NodeBinRunOptions {
  readonly entryPath: string;
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

interface CrossRealmHttpRequest {
  on(event: 'error', listener: () => void): unknown;
  destroy(): unknown;
}

type CrossRealmHttpGet = (
  url: string,
  onResponse: (response: { resume(): unknown }) => void,
) => CrossRealmHttpRequest;

interface NodeServerRunnerDeps {
  readonly importEntry: (entryPath: string, fromPath: string) => Promise<unknown>;
  readonly runNodeBin?: (opts: NodeBinRunOptions) => Promise<void>;
  readonly waitForLocalPort?: (port: number, timeoutMs: number) => Promise<void>;
  readonly waitForCrossRealmPort?: (port: number, timeoutMs: number) => Promise<void>;
  /** Request boundary for bounded-probe fault tests; production uses real node:http. */
  readonly httpGet?: CrossRealmHttpGet;
}

interface NodeServerRun {
  readonly appChildOwnsPreviewBridge: boolean;
}

type NodeServerRunner = (opts: {
  readonly cfg: NodeServerBootstrapConfig;
  readonly spec: NodeServerProjectSpec;
  readonly log: (chunk: string) => void;
}) => Promise<NodeServerRun>;

/** Build a runner around one module loader; tests replace only the realm adapters. */
export function createNodeServerRunner(deps: NodeServerRunnerDeps): NodeServerRunner {
  const runNodeBin = deps.runNodeBin ?? runRealNodeBin;
  const waitForLocalPort = deps.waitForLocalPort ?? waitForListeningPort;
  const crossRealmHttpGet: CrossRealmHttpGet =
    deps.httpGet ?? ((url, onResponse) => httpGet(url, onResponse));
  const waitForCrossRealmPort =
    deps.waitForCrossRealmPort ??
    ((port, timeoutMs) => waitForCrossRealmListeningPort(port, timeoutMs, crossRealmHttpGet));

  return async ({ cfg, spec, log }) => {
    routeConsoleTo(log);

    if (spec.devRunner === 'nodemon') {
      const binPath = `${cfg.root}/node_modules/.bin/nodemon`;
      const entry = spec.entry.relativePath.replace(/^\/+/, '');
      log(`[real-vite/worker] starting nodemon for ${cfg.entryPath} on port ${cfg.port}…\n`);
      await runNodeBin({
        entryPath: binPath,
        cwd: cfg.root,
        argv: ['rifty', binPath, ...nodemonDevArguments(entry)],
        env: { RIFTY_NODE_SERVE: '1' },
      });
      await waitForCrossRealmPort(cfg.port, 10_000);
      log(`[real-vite/worker] nodemon app is serving internal port ${cfg.port}\n`);
      return { appChildOwnsPreviewBridge: true };
    }

    log(`[real-vite/worker] starting server ${cfg.entryPath} on port ${cfg.port}…\n`);
    await deps.importEntry(cfg.entryPath, `${cfg.root}/__entry__.mjs`);
    await waitForLocalPort(cfg.port, 10_000);
    log(`[real-vite/worker] server is listening on internal port ${cfg.port}\n`);
    return { appChildOwnsPreviewBridge: false };
  };
}

function routeConsoleTo(log: (chunk: string) => void): void {
  const termWriter = {
    write(chunk: string): boolean {
      log(chunk);
      return true;
    },
  };
  (globalThis as { console: unknown }).console = new Console(termWriter, termWriter);
}

async function runRealNodeBin({ entryPath, cwd, argv, env }: NodeBinRunOptions): Promise<void> {
  globalThis.process.argv = [...argv];
  Object.assign(globalThis.process.env, env);
  await runNodeEntry({ vfs: syncMirror(), entryPath, cwd, bin: true });
}

/** Wait for a direct entry's listen() in this realm's net registry. */
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

const CROSS_REALM_PROBE_TIMEOUT_MS = 1_000;

async function probeCrossRealmPort(
  port: number,
  timeoutMs: number,
  get: CrossRealmHttpGet,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (value: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(value);
    };
    try {
      const req = get(`http://localhost:${port}/`, (response) => {
        response.resume();
        settle(true);
      });
      req.on('error', () => settle(false));
      if (!settled) {
        timer = setTimeout(() => {
          try {
            req.destroy();
          } finally {
            settle(false);
          }
        }, timeoutMs);
      }
    } catch {
      settle(false);
    }
  });
}

async function waitForCrossRealmListeningPort(
  port: number,
  timeoutMs: number,
  get: CrossRealmHttpGet,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    if (await probeCrossRealmPort(port, Math.min(CROSS_REALM_PROBE_TIMEOUT_MS, remainingMs), get))
      return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `[real-vite/worker] nodemon app never served internal port ${port} within ${timeoutMs}ms`,
  );
}
