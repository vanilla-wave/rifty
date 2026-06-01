/**
 * opencode DB-READ smoke (Phase 2) — standalone (run via `tsx`), NOT a vitest test.
 *
 * Takes the booted server (same realm as the BOOT gate — see
 * `opencode-vfs-harness.ts`) and issues ONE request that performs a REAL
 * drizzle/SQLite query, to prove the migrated schema is queryable end-to-end
 * (not merely that the migration DDL ran at boot).
 *
 * Probe: `GET /session` — the cheapest instance DB-read route. Its handler runs
 * `session.list()` → `db.select().from(SessionTable)…all()` (session.ts:1079),
 * returning `[]` on a fresh in-memory DB. The instance/workspace context is
 * resolved from `process.cwd()` (= the harness ROOT `/workspace`) by
 * `workspace-routing.ts` (`directory` query / `x-opencode-directory` header /
 * cwd fallback) — so no headers are required. Auth is a no-op
 * (`OPENCODE_SERVER_PASSWORD` unset).
 *
 * This drives the instance-context middleware + the lazy Session/Project/
 * Workspace layers for the first time on a request, which may surface a concrete
 * browser/native ceiling (spawn/git/file-watch) via a loud throw — that is the
 * Phase-2 wall to walk.
 *
 * Run directly (sandbox disabled — needs the 217MB deps):
 *   npx tsx tests/integration/fixtures/opencode-dbread-smoke.ts
 *
 * Prints exactly one terminal marker line and exits:
 *   RIFTY_OPENCODE_DBREAD_OK  (exit 0)  — booted + GET /session 200 JSON array
 *   RIFTY_OPENCODE_DBREAD_BLOCKED <one-line reason>  (exit 4) — real wall
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

const log = makeLog('opencode-dbread');
installSafetyTimeout(log);

const SESSION_PATH = '/session';

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
    throw new Error(`Server.listen unavailable (Server is ${typeof Server})`);
  }

  log('calling Server.listen({ port: 4096, hostname: 127.0.0.1, mdns: false }) ...');
  const listener = (await Server.listen({
    port: 4096,
    hostname: '127.0.0.1',
    mdns: false,
  })) as Listener;
  log(`BOOTED — listening at ${listener.url} (port ${listener.port})`);

  // The DB-read probe: drives the instance-context middleware + the lazy
  // Session/Project/Workspace layers for the first time, then a real drizzle
  // SELECT against SessionTable.
  log(`dispatching GET ${SESSION_PATH} (cwd-resolved instance) -> port ${listener.port} ...`);
  const res = await dispatchToPort(
    listener.port,
    new Request(`http://localhost${SESSION_PATH}`, { method: 'GET' }),
  );
  const body = await res.text();
  log(`route GET ${SESSION_PATH} -> ${res.status} (${body.length} bytes): ${body.slice(0, 300)}`);

  await listener.stop(true).catch((e) => log(`listener.stop failed (ignored): ${String(e)}`));

  if (res.status !== 200) {
    throw new Error(
      `booted but ${SESSION_PATH} returned ${res.status}, expected 200: ${body.slice(0, 300)}`,
    );
  }
  const parsed = JSON.parse(body) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${SESSION_PATH} 200 but body is not a JSON array: ${body.slice(0, 200)}`);
  }
  log(`GET ${SESSION_PATH} returned a JSON array of ${parsed.length} session(s) — drizzle read OK`);
  log('RIFTY_OPENCODE_DBREAD_OK');
  realExit(0);
}

main().catch((e) => reportBlocked(log, 'RIFTY_OPENCODE_DBREAD_BLOCKED', e));
