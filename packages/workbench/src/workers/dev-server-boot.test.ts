import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listPorts } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { syncMirror } from '@riftydev/vfs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type NodeServerProjectSpec, resolveBootstrapConfig } from '../project-spec.ts';
import { TEST_CLI_TEMPLATE, TEST_HIDDEN_TEMPLATE } from '../test-project.ts';
import { bootDevServer } from './dev-server-boot.ts';

/**
 * Behavioral node tests for the co-resident dev-server boot core. The module is
 * realm-portable by construction (no top-level side effects; builtins register
 * in ENTRY modules) — this file IS the entry realm: it registers the net
 * builtins and drives `bootDevServer` against the in-memory `syncMirror()`.
 *
 * Contracts that need the REAL vite binary/dev server stay e2e:
 *   - relative `base: './'`, synthetic HMR invalidation, watcher no-feedback,
 *     stock server.ws over the generic bridge, child-owned cross-realm preview
 *     route → m7-preview-sw.spec.ts (preview GET + editor-edit→iframe-update)
 *     and generic-dev-server-lifecycle.spec.ts;
 *   - install-time shims (ADR-0188, no boot-time overlay) → vite preset boots
 *     (m7/vite-command-honesty) + manual-vite-install.spec.ts (opt-in);
 *   - lazy node:sqlite at first require → fullstack-demo.spec.ts;
 *   - no bespoke preview WS bridge (ADR-0189) → preview-websocket-bridge.spec.ts.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

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
  // Entry-realm contract: dev-server-boot deliberately carries no registrar
  // side effects; the spawning entry registers the net builtins. This test file
  // plays that role for the in-process loader.
  registerNetBuiltins();
});

afterEach(() => {
  // bootNodeServer routes the global console into the run log (Node parity:
  // console.log IS stdout) — restore the test runner's console + PORT.
  globalThis.console = realConsole;
  // Reflect (not `delete`, noDelete; not `= undefined` — env coerces it to 'undefined').
  if (realPortEnv === undefined) Reflect.deleteProperty(process.env, 'PORT');
  else process.env.PORT = realPortEnv;
  vi.useRealTimers();
});

describe('node-server runtime branch (behavioral)', () => {
  it('runs the entry as the server program: console routed to the run log, listen gate passes', async () => {
    const root = '/bu-devboot/server';
    const cfg = resolveBootstrapConfig(NODE_SERVER_SPEC, NODE_SERVER_SPEC.defaultPort, root);
    const sinks = makeSinks();

    const handle = await bootDevServer({
      cfg,
      port: cfg.port,
      root,
      spec: NODE_SERVER_SPEC,
      slug: 'bu',
      fromScratch: true,
      publishSnapshot: sinks.publishSnapshot,
      log: sinks.log,
    });
    try {
      const logText = sinks.logs.join('');
      // Entry ran as the program and its console.log landed in the run log.
      expect(logText).toContain('bu-entry-console-routed');
      // The listen gate observed the routed port (never a silent non-listening boot).
      expect(logText).toContain(`server is listening on internal port ${cfg.port}`);
      expect(listPorts()).toContain(cfg.port);
      // Cross-realm preview route registered by THIS realm (the child owns it).
      expect(logText).toContain('preview bridge ready');
      expect(handle.port).toBe(cfg.port);
      expect(sinks.publishes()).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.stop();
    }
  });

  it('fails loudly when the entry never starts listening on the routed port', async () => {
    const root = '/bu-devboot/silent';
    const cfg = resolveBootstrapConfig(NEVER_LISTENS_SPEC, NEVER_LISTENS_SPEC.defaultPort, root);
    const sinks = makeSinks();

    vi.useFakeTimers();
    const boot = bootDevServer({
      cfg,
      port: cfg.port,
      root,
      spec: NEVER_LISTENS_SPEC,
      slug: 'bu',
      fromScratch: true,
      publishSnapshot: sinks.publishSnapshot,
      log: sinks.log,
    });
    boot.catch(() => {}); // rejection asserted below; avoid an unhandled warning
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(boot).rejects.toThrow(/never started listening/);
  });
});

describe('runtime dispatch + seeding (behavioral)', () => {
  it('node-cli rejects loudly (owner node executor owns that lifecycle) AFTER seeding if-absent', async () => {
    const root = '/bu-devboot/cli';
    const cfg = resolveBootstrapConfig(TEST_CLI_TEMPLATE, 0, root);
    const fs = syncMirror();
    fs.mkdirSync(root, { recursive: true });
    // A user-owned package.json must survive the seed (seed-if-absent, never overwrite).
    const userPackageJson = '{ "name": "user-kept", "version": "9.9.9" }\n';
    fs.writeFileSync(`${root}/package.json`, enc.encode(userPackageJson));
    const sinks = makeSinks();

    await expect(
      bootDevServer({
        cfg,
        port: 0,
        root,
        spec: TEST_CLI_TEMPLATE,
        slug: 'bu',
        fromScratch: true,
        publishSnapshot: sinks.publishSnapshot,
        log: sinks.log,
      }),
    ).rejects.toThrow(/node-cli templates run through the owner node executor/);

    // Seeding happened before the dispatch throw and honored the user file.
    expect(dec.decode(fs.readFileBytesSync(`${root}/package.json`))).toBe(userPackageJson);
    expect(fs.existsSync(`${root}/src/cli.js`)).toBe(true);
    expect(fs.existsSync(`${root}/data/packages.yml`)).toBe(true);
  });

  it('loud-rejects a user vite.config before curated dev boot could ignore it', async () => {
    const root = '/bu-devboot/vite-config';
    const fs = syncMirror();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(`${root}/vite.config.ts`, enc.encode('export default {};\n'));
    const cfg = resolveBootstrapConfig(TEST_HIDDEN_TEMPLATE, 5175, root);
    const sinks = makeSinks();

    await expect(
      bootDevServer({
        cfg,
        port: 5175,
        root,
        spec: TEST_HIDDEN_TEMPLATE,
        slug: 'bu',
        fromScratch: true,
        publishSnapshot: sinks.publishSnapshot,
        log: sinks.log,
      }),
    ).rejects.toThrow(/vite\.config/);
  });

  it('vite deps are a PRECONDITION: no node_modules → loud resolve failure, never a silent install', async () => {
    const root = '/bu-devboot/vite-missing-deps';
    const cfg = resolveBootstrapConfig(TEST_HIDDEN_TEMPLATE, 5176, root);
    const sinks = makeSinks();

    await expect(
      bootDevServer({
        cfg,
        port: 5176,
        root,
        spec: TEST_HIDDEN_TEMPLATE,
        slug: 'bu',
        fromScratch: true,
        publishSnapshot: sinks.publishSnapshot,
        log: sinks.log,
      }),
    ).rejects.toThrow(/vite/);
  });
});

describe('residual source pins', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./dev-server-boot.ts', import.meta.url)),
    'utf8',
  );

  it('pins the ADR-0161 hmr-off knob for templates pinned off (Vite 8)', () => {
    // residual source pin: `hmr: false` matters only for the opt-in vite8
    // template — no default-on e2e boots Vite 8 (upstream-broken build path),
    // and the node harness cannot boot the real vite dev server to observe it.
    expect(source).toContain('hmr: cfg.hmrEnabled ? undefined : false');
  });
});
