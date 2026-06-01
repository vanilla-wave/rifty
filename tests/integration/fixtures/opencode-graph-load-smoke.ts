/**
 * opencode GRAPH-LOAD smoke — standalone (run via `tsx`), NOT a vitest test.
 *
 * Drives the P0/P2 GRAPH-LOAD GATE: build the opencode realm (shared with the
 * BOOT smoke — see `opencode-vfs-harness.ts`) and `loader.import` the
 * PROGRAMMATIC entry `packages/opencode/src/server/server.ts` (NOT `src/node.ts`,
 * whose top-level `bun:sqlite` crashes outside Bun — see Spike C / the fixture
 * README).
 *
 * GATE: the module graph RESOLVES + EVALUATES and exposes `Server` with a
 * `Server.listen` function, with no unresolved-import error and no native
 * crash. `node:sqlite` must resolve to the shim; `#pty` is lazy and must not be
 * pulled on the static path. (The BOOT smoke takes it from here and actually
 * calls `Server.listen`.)
 *
 * Run directly (sandbox disabled — needs the 217MB deps; network only for the
 * one-time `npm ci` materialization if `node_modules` is absent):
 *   npx tsx tests/integration/fixtures/opencode-graph-load-smoke.ts
 *
 * Prints exactly one terminal marker line and exits:
 *   RIFTY_OPENCODE_GRAPH_LOAD_OK  (exit 0)  — Server.listen resolved + evaluated
 *   RIFTY_OPENCODE_GRAPH_LOAD_BLOCKED <one-line reason>  (exit 4) — real wall
 */
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

const log = makeLog('opencode-graph-load');
installSafetyTimeout(log);

async function main(): Promise<void> {
  const loader = await buildOpencodeLoader(log);

  log(`importing programmatic entry: ${ENTRY} ...`);
  const ns = (await loader.import(ENTRY, `${ROOT}/__entry__.mjs`)) as Any;

  // Server is re-exported as a namespace: `export * as Server from "./server"`.
  const Server = ns.Server;
  if (!Server || typeof Server !== 'object') {
    throw new Error(
      `graph evaluated but did not expose a Server namespace (got ${typeof Server}); exports: ${Object.keys(ns).join(',')}`,
    );
  }
  if (typeof Server.listen !== 'function') {
    throw new Error(
      `Server exposed but Server.listen is ${typeof Server.listen} (expected function); Server keys: ${Object.keys(Server).join(',')}`,
    );
  }
  log(`GRAPH LOADED — Server.listen is ${typeof Server.listen}`);
  log('RIFTY_OPENCODE_GRAPH_LOAD_OK');
  realExit(0);
}

main().catch((e) => reportBlocked(log, 'RIFTY_OPENCODE_GRAPH_LOAD_BLOCKED', e));
