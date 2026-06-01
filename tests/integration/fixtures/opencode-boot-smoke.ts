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
 * GATE: the server boots (a `Listener` with a `TcpAddress`) AND a trivial route
 * dispatched through the port registry returns HTTP 200 — exercising the REAL
 * session/drizzle layer, not hand-written SQL.
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

// The trivial route to assert against once the server boots. `/doc` is the
// OpenAPI spec (`HttpServerResponse.jsonUnsafe(OpenApi.fromApi(PublicApi))`) —
// a pure JSON GET that does not require a session token. Refined as the boot
// walls are walked if auth/route reality differs.
const PROBE_PATH = '/doc';

interface Listener {
  hostname: string;
  port: number;
  url: URL;
  stop: (close?: boolean) => Promise<void>;
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

  // The trivial route check: dispatch through the same port registry the
  // rifty node:http server registered into (singleton module — guest server
  // and this harness share it).
  log(`dispatching GET ${PROBE_PATH} -> port ${listener.port} ...`);
  const res = await dispatchToPort(
    listener.port,
    new Request(`http://localhost${PROBE_PATH}`, { method: 'GET' }),
  );
  const bodyText = await res.text();
  const snippet = bodyText.slice(0, 200).replace(/\n/g, ' ');
  log(`route GET ${PROBE_PATH} -> ${res.status} (${bodyText.length} bytes): ${snippet}`);

  await listener.stop(true).catch((e) => log(`listener.stop failed (ignored): ${String(e)}`));

  if (res.status !== 200) {
    throw new Error(`booted but ${PROBE_PATH} returned ${res.status}, expected 200: ${snippet}`);
  }
  log('RIFTY_OPENCODE_BOOT_OK');
  realExit(0);
}

main().catch((e) => reportBlocked(log, 'RIFTY_OPENCODE_BOOT_BLOCKED', e));
