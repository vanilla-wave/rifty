import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { listPorts } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { syncMirror } from '@riftydev/vfs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLI_REPORT_TEMPLATE } from '../templates/cli-report.ts';
import { HIDDEN_EMPTY_TEMPLATE } from '../templates/hidden-empty.ts';
import {
  type NodeServerProjectSpec,
  type ViteProjectSpec,
  resolveBootstrapConfig,
} from '../templates/project-spec.ts';
import { VITE_TEMPLATE } from '../templates/vite.ts';
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

interface ViteProbe {
  esbuildAtViteImport?: unknown;
  legacyBridgeAtViteImport?: boolean;
  config?: unknown;
}

interface TestGlobals {
  __rifty?: { esbuild?: unknown };
  __riftyEsbuildTransform?: unknown;
  __riftyTestCuratedViteProbe?: ViteProbe;
}

const g = globalThis as TestGlobals;
const PROBE_VITE_PACKAGE = [
  'const probe = globalThis.__riftyTestCuratedViteProbe;',
  'probe.esbuildAtViteImport = globalThis.__rifty?.esbuild;',
  "probe.legacyBridgeAtViteImport = Reflect.has(globalThis, '__riftyEsbuildTransform');",
  'export async function createServer(config) {',
  '  probe.config = config;',
  '  return {',
  '    async listen() {},',
  '    async close() {},',
  '    watcher: { on() {} },',
  '  };',
  '}',
].join('\n');

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

const CURATED_VITE_SPEC = {
  ...HIDDEN_EMPTY_TEMPLATE,
  id: 'bu-curated-vite',
  install: { vite: '7.3.6' },
} satisfies ViteProjectSpec;

function seedProbeVite(root: string, version: string): void {
  const fs = syncMirror();
  const packageRoot = `${root}/node_modules/vite`;
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    `${packageRoot}/package.json`,
    enc.encode(JSON.stringify({ name: 'vite', version, type: 'module', main: 'index.js' })),
  );
  fs.writeFileSync(`${packageRoot}/index.js`, enc.encode(PROBE_VITE_PACKAGE));
}

async function withRealEsbuildWasm<T>(run: () => Promise<T>): Promise<T> {
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const previousFetch = globalThis.fetch;
  const require = createRequire(import.meta.url);
  const wasm = new Uint8Array(readFileSync(require.resolve('esbuild-wasm/esbuild.wasm')));
  Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
  globalThis.fetch = async () => new Response(wasm, { status: 200 });
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
    else Reflect.deleteProperty(globalThis, 'self');
  }
}

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
  if (g.__rifty) Reflect.deleteProperty(g.__rifty, 'esbuild');
  Reflect.deleteProperty(g, '__riftyEsbuildTransform');
  Reflect.deleteProperty(g, '__riftyTestCuratedViteProbe');
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
    const cfg = resolveBootstrapConfig(CLI_REPORT_TEMPLATE, 0, root);
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
        spec: CLI_REPORT_TEMPLATE,
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
    const cfg = resolveBootstrapConfig(HIDDEN_EMPTY_TEMPLATE, 5175, root);
    const sinks = makeSinks();

    await expect(
      bootDevServer({
        cfg,
        port: 5175,
        root,
        spec: HIDDEN_EMPTY_TEMPLATE,
        slug: 'bu',
        fromScratch: true,
        publishSnapshot: sinks.publishSnapshot,
        log: sinks.log,
      }),
    ).rejects.toThrow(/vite\.config/);
  });

  it('vite deps are a PRECONDITION: no node_modules → loud resolve failure, never a silent install', async () => {
    const root = '/bu-devboot/vite-missing-deps';
    const cfg = resolveBootstrapConfig(HIDDEN_EMPTY_TEMPLATE, 5176, root);
    const sinks = makeSinks();

    await expect(
      bootDevServer({
        cfg,
        port: 5176,
        root,
        spec: HIDDEN_EMPTY_TEMPLATE,
        slug: 'bu',
        fromScratch: true,
        publishSnapshot: sinks.publishSnapshot,
        log: sinks.log,
      }),
    ).rejects.toThrow(/vite/);
  });

  it('never seeds template js over a user ts config', async () => {
    const root = '/bu-devboot/config-slot-user';
    const fs = syncMirror();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(`${root}/vite.config.ts`, enc.encode('export default {};\n'));
    const cfg = resolveBootstrapConfig(VITE_TEMPLATE, 5177, root);
    const sinks = makeSinks();

    await expect(
      bootDevServer({
        cfg,
        port: cfg.port,
        root,
        spec: VITE_TEMPLATE,
        slug: 'bu',
        fromScratch: false,
        publishSnapshot: sinks.publishSnapshot,
        log: sinks.log,
      }),
    ).rejects.toThrow(/vite\.config/);
    expect(fs.existsSync(`${root}/vite.config.js`)).toBe(false);
    expect(fs.existsSync(`${root}/.rifty/vite-config.seeded`)).toBe(false);
  });

  it('records a fresh seed and never resurrects its deletion', async () => {
    const root = '/bu-devboot/config-slot-delete';
    const fs = syncMirror();
    const cfg = resolveBootstrapConfig(VITE_TEMPLATE, 5178, root);
    const attempt = async (): Promise<void> => {
      const sinks = makeSinks();
      await bootDevServer({
        cfg,
        port: cfg.port,
        root,
        spec: VITE_TEMPLATE,
        slug: 'bu',
        fromScratch: false,
        publishSnapshot: sinks.publishSnapshot,
        log: sinks.log,
      });
    };

    await expect(attempt()).rejects.toThrow(/vite/);
    expect(fs.existsSync(`${root}/vite.config.js`)).toBe(true);
    expect(fs.existsSync(`${root}/.rifty/vite-config.seeded`)).toBe(true);
    fs.rmSync(`${root}/vite.config.js`, { force: true });
    await expect(attempt()).rejects.toThrow(/vite/);
    expect(fs.existsSync(`${root}/vite.config.js`)).toBe(false);
  });
});

describe('curated Vite esbuild runtime ownership', () => {
  it('publishes the exact Vite 7 runtime before importing Vite; legacy bridge stays absent', async () => {
    const root = '/bu-devboot/curated-vite7';
    const cfg = resolveBootstrapConfig(CURATED_VITE_SPEC, 5180, root);
    const sinks = makeSinks();
    const probe: ViteProbe = {};
    g.__riftyTestCuratedViteProbe = probe;
    seedProbeVite(root, '7.3.6');

    const handle = await withRealEsbuildWasm(() =>
      bootDevServer({
        cfg,
        port: cfg.port,
        root,
        spec: CURATED_VITE_SPEC,
        slug: 'bu',
        fromScratch: true,
        publishSnapshot: sinks.publishSnapshot,
        log: sinks.log,
      }),
    );
    try {
      expect(probe.esbuildAtViteImport).toBe(g.__rifty?.esbuild);
      expect(probe.esbuildAtViteImport).toMatchObject({ version: '0.28.0' });
      expect(probe.legacyBridgeAtViteImport).toBe(false);
      expect(probe.config).toMatchObject({ root, base: './' });
    } finally {
      await handle.stop();
    }
  });

  it('skips generated esbuild startup for Vite 8 Rolldown', async () => {
    const root = '/bu-devboot/curated-vite8';
    const spec = {
      ...CURATED_VITE_SPEC,
      id: 'bu-curated-vite8',
      install: { vite: '8.0.16' },
    } satisfies ViteProjectSpec;
    const cfg = resolveBootstrapConfig(spec, 5181, root);
    const sinks = makeSinks();
    const probe: ViteProbe = {};
    g.__riftyTestCuratedViteProbe = probe;
    seedProbeVite(root, '8.0.16');
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('Vite 8 must not fetch esbuild wasm'));
    };

    let handle: Awaited<ReturnType<typeof bootDevServer>> | undefined;
    try {
      handle = await bootDevServer({
        cfg,
        port: cfg.port,
        root,
        spec,
        slug: 'bu',
        fromScratch: true,
        publishSnapshot: sinks.publishSnapshot,
        log: sinks.log,
      });
      expect(fetchCalls).toBe(0);
      expect(probe.esbuildAtViteImport).toBeUndefined();
      expect(probe.legacyBridgeAtViteImport).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      await handle?.stop();
    }
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
