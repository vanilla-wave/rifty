/**
 * Opt-in live RUN of the playground's Express + SQLite fullstack template — the
 * real-package proof for the node-server template runtime (see the node-server
 * template ADR; sibling of `express-live-run.opt-in.test.ts`).
 *
 * Drives the EXACT bytes the playground seeds (template entry + public assets
 * via `resolveBootstrapConfig`) through the real stack: live express@^4 install,
 * `node:sqlite` (sql.js WASM `DatabaseSync`, ADR-0065), module-loader ESM entry
 * import, and `@riftydev/net` port-registry dispatch for the REST round-trip
 * (GET static, GET/POST/PATCH/DELETE JSON API).
 *
 * **Skipped by default** — needs network. Run manually:
 *
 *     RIFTY_LIVE_REGISTRY=https://registry.npmjs.org pnpm vitest run fullstack-demo-live-run.opt-in
 *
 * (and, in a sandboxed environment, with the sandbox disabled so the install
 * can reach the network and `vitest` can read the temp tree.)
 *
 * Known harness noise: after all tests pass, vitest's own worker IPC may log
 * "Unable to deserialize cloned data" unhandled rejections — an interplay of
 * `installProcessGlobals()` with vitest's channel. The live Vite install smoke
 * demonstrates spawned-child isolation mechanics but intentionally stops
 * before runtime-global installation. Converting this suite to that pattern is
 * the known fix if the noise ever gates anything.
 */
import '@riftydev/net/register-builtins';
import '@riftydev/net/sqlite/register-builtins';
import { dispatchToPort, listPorts, unregisterPort } from '@riftydev/net';
import { initSqliteEngine } from '@riftydev/net/sqlite/engine';
import { RegistryClient, install } from '@riftydev/npm-client';
import { Buffer as RiftyBuffer } from '@riftydev/runtime-js/builtins/buffer';
import { installProcessGlobals, setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { installTimerGlobals } from '@riftydev/runtime-js/builtins/timers';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { createMemoryFs, setSyncMirror } from '@riftydev/vfs/internal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPRESS_SQLITE_TEMPLATE } from '../../apps/playground/src/templates/express-sqlite.ts';
import { resolveBootstrapConfig } from '../../apps/playground/src/templates/project-spec.ts';

// See express-live-run.opt-in.test.ts: packages like `etag` read the GLOBAL
// Buffer for `Buffer.isBuffer`; it must be the class express builds chunks with.
const savedGlobalBuffer = (globalThis as { Buffer?: unknown }).Buffer;

const liveRegistryUrl = process.env.RIFTY_LIVE_REGISTRY;

const ROOT = '/workspace';
const PORT = EXPRESS_SQLITE_TEMPLATE.defaultPort;

interface TodoRow {
  readonly id: number;
  readonly title: string;
  readonly done: number;
}

describe.skipIf(!liveRegistryUrl)('integration (opt-in) — RUN the fullstack demo template', () => {
  const enc = new TextEncoder();

  beforeAll(async () => {
    if (!liveRegistryUrl) throw new Error('unreachable — describe.skipIf gated');

    const cfg = resolveBootstrapConfig(EXPRESS_SQLITE_TEMPLATE, PORT, ROOT);
    const { vfs, fsSync } = createMemoryFs();
    const registry = new RegistryClient({ baseUrl: liveRegistryUrl, fetch: globalThis.fetch });
    await install(cfg.packageName, cfg.packageVersion, cfg.installDeps, {
      vfs,
      cwd: ROOT,
      registry,
    });

    setSyncMirror(fsSync, { async: vfs });
    installProcessGlobals();
    installTimerGlobals();
    (globalThis as { Buffer: unknown }).Buffer = RiftyBuffer;

    // Seed the exact files the worker bootstrap would seed.
    for (const [path, content] of Object.entries(cfg.seedFiles)) {
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir) fsSync.mkdirSync(dir, { recursive: true });
      fsSync.writeFileSync(path, enc.encode(content));
    }

    // express.static('public') resolves from cwd; entry reads process.env.PORT.
    setProcessCwd(ROOT);
    globalThis.process.env.PORT = String(PORT);

    await initSqliteEngine();
    const loader = createModuleLoader(fsSync, { cwd: ROOT });
    await loader.import(cfg.entryPath, `${ROOT}/__entry__.mjs`);
  }, 120_000);

  afterAll(async () => {
    for (const p of listPorts()) unregisterPort(p);
    // Let in-flight send/serve-static stream teardown settle BEFORE the global
    // Buffer swap-back — express's `instanceof Buffer` on a torn-down global
    // otherwise throws as post-suite noise.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    (globalThis as { Buffer: unknown }).Buffer = savedGlobalBuffer;
  });

  it('the entry started listening on the template default port', () => {
    expect(listPorts()).toContain(PORT);
  });

  it('GET / serves the static client through express.static from the VFS', async () => {
    const r = await dispatchToPort(PORT, new Request('http://x/'));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type') ?? '').toContain('text/html');
    const body = await r.text();
    expect(body).toContain('todos');
    expect(body).toContain('client.js');
  });

  it('GET /styles.css serves the stylesheet with a CSS content type', async () => {
    const r = await dispatchToPort(PORT, new Request('http://x/styles.css'));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type') ?? '').toContain('text/css');
  });

  it('GET /api/todos returns the seeded SQLite rows', async () => {
    const r = await dispatchToPort(PORT, new Request('http://x/api/todos'));
    expect(r.status).toBe(200);
    const rows = (await r.json()) as TodoRow[];
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ id: 1, done: 1 });
    expect(rows.map((row) => typeof row.title)).toEqual(['string', 'string', 'string']);
  });

  it('POST /api/todos inserts a row and returns it with its rowid', async () => {
    const payload = JSON.stringify({ title: 'added from the integration test' });
    const r = await dispatchToPort(
      PORT,
      new Request('http://x/api/todos', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(enc.encode(payload).length),
        },
        body: payload,
      }),
    );
    expect(r.status).toBe(201);
    const created = (await r.json()) as TodoRow;
    expect(created).toMatchObject({ title: 'added from the integration test', done: 0 });
    expect(created.id).toBeGreaterThan(3);

    const all = (await (
      await dispatchToPort(PORT, new Request('http://x/api/todos'))
    ).json()) as TodoRow[];
    expect(all.length).toBe(4);
  });

  it('POST /api/todos without a title is a 400', async () => {
    const payload = JSON.stringify({ title: '   ' });
    const r = await dispatchToPort(
      PORT,
      new Request('http://x/api/todos', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(enc.encode(payload).length),
        },
        body: payload,
      }),
    );
    expect(r.status).toBe(400);
  });

  it('PATCH /api/todos/:id toggles done and 404s for unknown ids', async () => {
    const payload = JSON.stringify({ done: true });
    const ok = await dispatchToPort(
      PORT,
      new Request('http://x/api/todos/3', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'content-length': String(enc.encode(payload).length),
        },
        body: payload,
      }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()) as TodoRow).toMatchObject({ id: 3, done: 1 });

    const missing = await dispatchToPort(
      PORT,
      new Request('http://x/api/todos/9999', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'content-length': String(enc.encode(payload).length),
        },
        body: payload,
      }),
    );
    expect(missing.status).toBe(404);
  });

  it('DELETE /api/todos/:id removes the row', async () => {
    const r = await dispatchToPort(PORT, new Request('http://x/api/todos/2', { method: 'DELETE' }));
    expect(r.status).toBe(204);

    const all = (await (
      await dispatchToPort(PORT, new Request('http://x/api/todos'))
    ).json()) as TodoRow[];
    expect(all.some((row) => row.id === 2)).toBe(false);
  });
});
