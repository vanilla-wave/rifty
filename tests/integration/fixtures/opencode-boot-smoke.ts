/**
 * opencode BOOT smoke — standalone (run via `tsx`), NOT a vitest test.
 *
 * Drives the BOOT GATE (`Server.listen` first light): take the realm the
 * GRAPH-LOAD gate proved loadable (`opencode-vfs-harness.ts`) and actually call
 * `Server.listen(opts)` headless. This EAGERLY builds the ~40-layer Effect DAG
 * (`Layer.buildWithMemoMap` in `server.ts`) → `fenceLayer` pulls
 * `Database.Service` → the real `@effect/sql-sqlite-node` + `drizzle-orm/node-sqlite`
 * run the boot PRAGMAs (`journal_mode=WAL`, …) + ~24 migrations against the
 * `node:sqlite` sql.js shim (ADR-0065), then `NodeHttpServer.layer` binds the
 * rifty `node:http` server into the port registry. This is the eager-`Database`
 * construction Spike C predicted.
 *
 * GATE: the server boots (a `Listener` with a `TcpAddress`) AND two routes
 * dispatched through the port registry return HTTP 200:
 *   - `GET /global/health` — a TYPED Effect `HttpApi` handler (runs per-request:
 *     route tree → no-op auth middleware → handler → schema-encode), asserts
 *     `{ healthy: true }`. This is the meaningful first-light probe.
 *   - `GET /doc` — the cached OpenAPI spec (proves the full route tree built).
 * The drizzle/sql.js layer is exercised by the BOOT itself: the eager DAG build
 * runs the real PRAGMAs + ~24 migrations under `Effect.orDie` (a failure dies
 * the layer and rejects `Server.listen`). A DB-read VIA a request needs the
 * instance/workspace context (Phase 2) and is intentionally not gated here.
 *
 * Headless config (via the harness `process.env`): `OPENCODE_DB=:memory:`,
 * `OPENCODE_DISABLE_MDNS=1`, `NODE_ENV=production`; `Server.listen` is called
 * with `mdns: false` + a loopback hostname so `setupMdns` never publishes.
 *
 * Run directly (sandbox disabled — needs the 217MB deps):
 *   npx tsx tests/integration/fixtures/opencode-boot-smoke.ts
 *
 * Prints exactly one terminal marker line and exits:
 *   RIFTY_OPENCODE_BOOT_OK  (exit 0)  — booted + trivial route 200
 *   RIFTY_OPENCODE_BOOT_BLOCKED <one-line reason>  (exit 4) — real wall
 */
import { dispatchToPort } from '../../../packages/net/src/registry.ts';
import {
  ENTRY,
  ROOT,
  buildOpencodeLoader,
  installSafetyTimeout,
  makeLog,
  realExit,
  reportBlocked,
} from './opencode-vfs-harness.ts';

// biome-ignore lint/suspicious/noExplicitAny: smoke harness.
type Any = any;

const log = makeLog('opencode-boot');
installSafetyTimeout(log);

// Routes asserted once the server boots. Auth is a no-op here: ServerAuth only
// `required()`s when OPENCODE_SERVER_PASSWORD is set (it isn't), so the
// authorization middleware short-circuits and these need no token.
//   /global/health — RootHttpApi, mounted WITHOUT instance/workspace context;
//                    a real typed Effect handler returning { healthy: true }.
//   /doc           — the cached OpenApi.fromApi(PublicApi) spec.
const HEALTH_PATH = '/global/health';
const DOC_PATH = '/doc';

interface Listener {
  hostname: string;
  port: number;
  url: URL;
  stop: (close?: boolean) => Promise<void>;
}

/** Dispatch a GET through the port registry and return status + body text. */
async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  const res = await dispatchToPort(port, new Request(`http://localhost${path}`, { method: 'GET' }));
  return { status: res.status, body: await res.text() };
}

async function main(): Promise<void> {
  const loader = await buildOpencodeLoader(log);

  log(`importing programmatic entry: ${ENTRY} ...`);
  const ns = (await loader.import(ENTRY, `${ROOT}/__entry__.mjs`)) as Any;
  const Server = ns.Server;
  if (!Server || typeof Server.listen !== 'function') {
    throw new Error(
      `Server.listen unavailable (Server is ${typeof Server}); cannot boot — run the GRAPH-LOAD gate first`,
    );
  }

  log('calling Server.listen({ port: 4096, hostname: 127.0.0.1, mdns: false }) ...');
  const listener = (await Server.listen({
    port: 4096,
    hostname: '127.0.0.1',
    mdns: false,
  })) as Listener;
  log(`BOOTED — listening at ${listener.url} (port ${listener.port})`);

  // Route checks: dispatch through the same port registry the rifty node:http
  // server registered into (singleton module — guest server and this harness
  // share it).
  log(`dispatching GET ${HEALTH_PATH} -> port ${listener.port} ...`);
  const health = await get(listener.port, HEALTH_PATH);
  log(`route GET ${HEALTH_PATH} -> ${health.status}: ${health.body.slice(0, 200)}`);

  const doc = await get(listener.port, DOC_PATH);
  log(
    `route GET ${DOC_PATH} -> ${doc.status} (${doc.body.length} bytes): ${doc.body.slice(0, 120).replace(/\n/g, ' ')}`,
  );

  await listener.stop(true).catch((e) => log(`listener.stop failed (ignored): ${String(e)}`));

  if (health.status !== 200) {
    throw new Error(
      `booted but ${HEALTH_PATH} returned ${health.status}, expected 200: ${health.body.slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(health.body) as { healthy?: unknown };
  if (parsed.healthy !== true) {
    throw new Error(`${HEALTH_PATH} 200 but body.healthy !== true: ${health.body.slice(0, 200)}`);
  }
  if (doc.status !== 200) {
    throw new Error(`booted but ${DOC_PATH} returned ${doc.status}, expected 200`);
  }
  log('RIFTY_OPENCODE_BOOT_OK');
  realExit(0);
}

main().catch((e) => reportBlocked(log, 'RIFTY_OPENCODE_BOOT_BLOCKED', e));
