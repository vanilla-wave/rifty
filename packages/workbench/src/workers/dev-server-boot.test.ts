import { listPorts } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NodeServerPackageConfig } from '../workbench/internal/project-package-config.ts';
import { bootDevServer } from './dev-server-boot.ts';

interface BootAttempt {
  readonly logs: string[];
  readonly log: (chunk: string) => void;
  readonly publishSnapshot: () => void;
  readonly publishes: () => number;
}

function makeSinks(): BootAttempt {
  const logs: string[] = [];
  let published = 0;
  return {
    logs,
    log: (chunk) => logs.push(chunk),
    publishSnapshot: () => {
      published += 1;
    },
    publishes: () => published,
  };
}

const NODE_SERVER_ENTRY = [
  "import { createServer } from 'node:http';",
  "console.log('bu-entry-console-routed');",
  "const server = createServer((req, res) => { res.end('ok'); });",
  'server.listen(Number(process.env.PORT));',
  '',
].join('\n');

function nodeServerConfig(root: string, port: number, entry: string): NodeServerPackageConfig {
  const entryPath = `${root}/src/server.js`;
  return {
    runtime: 'node-server',
    root,
    port,
    entryPath,
    packageName: 'bu-node-server',
    packageVersion: '0.0.0',
    installDeps: {},
    packageJson: '{"name":"bu-node-server","version":"0.0.0","type":"module"}\n',
    seedFiles: { [entryPath]: entry },
  };
}

const realConsole = globalThis.console;
const realPortEnv = process.env.PORT;

beforeAll(() => {
  registerNetBuiltins();
});

afterEach(() => {
  globalThis.console = realConsole;
  if (realPortEnv === undefined) Reflect.deleteProperty(process.env, 'PORT');
  else process.env.PORT = realPortEnv;
  vi.useRealTimers();
});

describe('node-server boot', () => {
  it('runs the entry, routes console, waits for listen, and serves preview', async () => {
    const root = '/bu-devboot/server';
    const cfg = nodeServerConfig(root, 4471, NODE_SERVER_ENTRY);
    const sinks = makeSinks();

    const handle = await bootDevServer({
      cfg,
      publishSnapshot: sinks.publishSnapshot,
      log: sinks.log,
    });
    try {
      const logText = sinks.logs.join('');
      expect(logText).toContain(
        `[real-vite/worker] starting server /src/server.js on port ${String(cfg.port)}`,
      );
      expect(logText).not.toContain(root);
      expect(logText).toContain('bu-entry-console-routed');
      expect(logText).toContain(`server is listening on internal port ${cfg.port}`);
      expect(logText).toContain('preview bridge ready');
      expect(listPorts()).toContain(cfg.port);
      expect(handle.port).toBe(cfg.port);
      expect(sinks.publishes()).toBeGreaterThanOrEqual(2);
    } finally {
      await handle.stop();
    }
  });

  it('keeps the public absolute entry path when the child project root is /', async () => {
    // Fault class: sibling-drift. Owner-rooted and projected-root configs must
    // render the same public diagnostic instead of dropping `/` at root.
    const cfg: NodeServerPackageConfig = {
      runtime: 'node-server',
      root: '/',
      port: 4473,
      entryPath: '/__bu-public-root/server.js',
      packageName: 'bu-public-root',
      packageVersion: '0.0.0',
      installDeps: {},
      packageJson: '{"name":"bu-public-root","version":"0.0.0","type":"module"}\n',
      seedFiles: {
        '/__bu-public-root/server.js': [
          "import { createServer } from 'node:http';",
          "createServer((_req, res) => res.end('ok')).listen(Number(process.env.PORT));",
          '',
        ].join('\n'),
      },
    };
    const sinks = makeSinks();

    const handle = await bootDevServer({
      cfg,
      publishSnapshot: sinks.publishSnapshot,
      log: sinks.log,
    });
    try {
      expect(sinks.logs.join('')).toContain(
        '[real-vite/worker] starting server /__bu-public-root/server.js on port 4473',
      );
    } finally {
      await handle.stop();
    }
  });

  it('fails loudly when the entry never starts listening on the routed port', async () => {
    const root = '/bu-devboot/silent';
    const cfg = nodeServerConfig(root, 4472, 'export const neverListens = true;\n');
    const sinks = makeSinks();

    vi.useFakeTimers();
    const boot = bootDevServer({
      cfg,
      publishSnapshot: sinks.publishSnapshot,
      log: sinks.log,
    });
    boot.catch(() => {});
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(boot).rejects.toThrow(/never started listening/);
  });
});
