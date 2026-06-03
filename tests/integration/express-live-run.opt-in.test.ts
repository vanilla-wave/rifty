/**
 * Opt-in live "RUN real express" test — the real-package proof for Phase 1.
 *
 * Distinct from `express-live.opt-in.test.ts`, which only proves the *install*
 * pipeline. This one installs express@^4 from the live registry, then loads it
 * through the rifty module loader and serves real HTTP requests through the
 * `@riftydev/net` port registry — exercising express's actual codebase (router,
 * finalhandler, etag, send, body parsing) on top of rifty's builtins.
 *
 * **Skipped by default** — needs network. Run manually:
 *
 *     RIFTY_LIVE_REGISTRY=https://registry.npmjs.org pnpm vitest run express-live-run.opt-in
 *
 * (and, in a sandboxed environment, with the sandbox disabled so the install
 * can reach the network and `vitest` can read the temp tree).
 */
import '@riftydev/net/register-builtins';
import { dispatchToPort, listPorts, unregisterPort } from '@riftydev/net';
import { type InstallResult, RegistryClient, install } from '@riftydev/npm-client';
import { Buffer as RiftyBuffer } from '@riftydev/runtime-js/builtins/buffer';
import { installProcessGlobals, setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { createMemoryFs, setSyncMirror } from '@riftydev/vfs/internal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Worker-entry installs `globalThis.Buffer = rifty Buffer` (worker-entry.ts:30).
// Replicate that here: packages like `etag` read the GLOBAL Buffer for
// `Buffer.isBuffer`, and must see the same class express builds chunks with —
// otherwise (under Node/vitest) the global stays Node's Buffer and isBuffer is
// false for rifty buffers. Saved/restored around the suite.
const savedGlobalBuffer = (globalThis as { Buffer?: unknown }).Buffer;

const liveRegistryUrl = process.env.RIFTY_LIVE_REGISTRY;

// biome-ignore lint/suspicious/noExplicitAny: express has no rifty-side types.
type ExpressFactory = any;

describe.skipIf(!liveRegistryUrl)('integration (opt-in) — RUN real express', () => {
  let express: ExpressFactory;
  let installResult: InstallResult;
  const usedPorts: number[] = [];

  beforeAll(async () => {
    if (!liveRegistryUrl) throw new Error('unreachable — describe.skipIf gated');

    // Shared async + sync backing tree (ADR-0037): install writes via the
    // async view; the module loader reads via the sync view.
    const { vfs, fsSync } = createMemoryFs();
    const registry = new RegistryClient({ baseUrl: liveRegistryUrl, fetch: globalThis.fetch });
    installResult = await install(
      'rifty-express-run',
      '0.0.0',
      { express: '^4' },
      { vfs, cwd: '/app', registry },
    );

    // Wire the global sync mirror so express's internal `fs` (serve-static,
    // send) sees the same tree, and boot the Node globals express needs
    // (process, timers, and the global Buffer — see note at top of file).
    setSyncMirror(fsSync, { async: vfs });
    installProcessGlobals();
    installTimerGlobals();
    (globalThis as { Buffer: unknown }).Buffer = RiftyBuffer;
    setProcessCwd('/app');

    const loader = createModuleLoader(fsSync, { cwd: '/app' });
    express = loader.require('express', '/app/__entry.js') as ExpressFactory;
  }, 90_000);

  afterAll(() => {
    for (const p of usedPorts) unregisterPort(p);
    for (const p of listPorts()) unregisterPort(p);
    (globalThis as { Buffer: unknown }).Buffer = savedGlobalBuffer;
  });

  it('installed the expected express dependency graph', () => {
    expect(installResult.packages.length).toBeGreaterThan(20);
    expect(typeof express).toBe('function');
  });

  it('GET / — real express router + res.send returns the body', async () => {
    const port = 3210;
    usedPorts.push(port);
    const app = express();
    app.get('/', (_req: unknown, res: { send(b: string): void }) =>
      res.send('Hello from real Express'),
    );
    app.listen(port);

    const r = await dispatchToPort(port, new Request('http://x/'));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('Hello from real Express');
  });

  it('GET /api — res.json sets content-type and serialises', async () => {
    const port = 3211;
    usedPorts.push(port);
    const app = express();
    app.get('/api', (_req: unknown, res: { json(v: unknown): void }) =>
      res.json({ ok: true, n: 42 }),
    );
    app.listen(port);

    const r = await dispatchToPort(port, new Request('http://x/api'));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type') ?? '').toContain('application/json');
    expect(await r.json()).toEqual({ ok: true, n: 42 });
  });

  it('POST /echo — express.json() body parser round-trips JSON', async () => {
    const port = 3212;
    usedPorts.push(port);
    const app = express();
    app.use(express.json());
    app.post('/echo', (req: { body: unknown }, res: { json(v: unknown): void }) =>
      res.json({ got: req.body }),
    );
    app.listen(port);

    const payload = JSON.stringify({ a: 1 });
    const r = await dispatchToPort(
      port,
      new Request('http://x/echo', {
        method: 'POST',
        // A real browser POST sets content-length; body-parser's `typeis.hasBody`
        // needs it (or transfer-encoding) or it skips parsing and leaves req.body {}.
        headers: {
          'content-type': 'application/json',
          'content-length': String(new TextEncoder().encode(payload).length),
        },
        body: payload,
      }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ got: { a: 1 } });
  });

  it('GET /missing — express default 404 (finalhandler)', async () => {
    const port = 3213;
    usedPorts.push(port);
    const app = express();
    app.get('/', (_req: unknown, res: { send(b: string): void }) => res.send('root'));
    app.listen(port);

    const r = await dispatchToPort(port, new Request('http://x/missing'));
    expect(r.status).toBe(404);
  });
});
