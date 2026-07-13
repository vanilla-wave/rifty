import { listPorts } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type NodeServerProjectSpec, resolveBootstrapConfig } from '../templates/project-spec.ts';
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

const NODE_SERVER_SPEC: NodeServerProjectSpec = {
  id: 'bu-node-server',
  displayName: 'browser-unit node server',
  runtime: 'node-server',
  install: {},
  entry: {
    relativePath: '/src/server.js',
    content: [
      "import { createServer } from 'node:http';",
      "console.log('bu-entry-console-routed');",
      "const server = createServer((req, res) => { res.end('ok'); });",
      'server.listen(Number(process.env.PORT));',
      '',
    ].join('\n'),
  },
  defaultPort: 4471,
  estimatedBootSeconds: 0,
  extraFiles: {},
};

const NEVER_LISTENS_SPEC: NodeServerProjectSpec = {
  ...NODE_SERVER_SPEC,
  id: 'bu-node-server-silent',
  entry: { relativePath: '/src/server.js', content: 'export const neverListens = true;\n' },
  defaultPort: 4472,
};

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
    const cfg = resolveBootstrapConfig(NODE_SERVER_SPEC, NODE_SERVER_SPEC.defaultPort, root);
    if (cfg.runtime !== 'node-server') throw new Error('expected node-server config');
    const sinks = makeSinks();

    const handle = await bootDevServer({
      cfg,
      publishSnapshot: sinks.publishSnapshot,
      log: sinks.log,
    });
    try {
      const logText = sinks.logs.join('');
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

  it('fails loudly when the entry never starts listening on the routed port', async () => {
    const root = '/bu-devboot/silent';
    const cfg = resolveBootstrapConfig(NEVER_LISTENS_SPEC, NEVER_LISTENS_SPEC.defaultPort, root);
    if (cfg.runtime !== 'node-server') throw new Error('expected node-server config');
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
