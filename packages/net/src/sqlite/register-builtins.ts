/**
 * Side-effect module: registers the `node:sqlite` builtin shape with the shared
 * `@riftydev/io` builtin registry (ADR-0035 / ADR-0065 D3). Import this from a
 * higher layer (the opencode harness, or the parity runner's `kind: 'sqlite'`
 * mode) to enable `require('node:sqlite')` inside the runtime.
 *
 * Like `net/register-builtins.ts`, registration lives here rather than in
 * runtime-js so the top-down layering rule holds (runtime-* must not depend on
 * net), and the heavy sql.js WASM engine is NOT pulled into every load — only
 * loads that opt in by importing this module. This is the
 * harness-local-registration choice ratified provisionally in Q-2026-05-31-302
 * (Option A), mirroring the `net`/`https` registration precedent.
 *
 * The factory exposes only the `DatabaseSync` class. Engine bring-up is LAZY:
 * on first `require('node:sqlite')` the factory self-initializes via the
 * host-installed `setSqliteEngineSyncProvider` seam (sync wasm bring-up, paid
 * once at first require — no preset flag, no ahead-of-time await). No provider
 * + not ready → require still succeeds and the first `DatabaseSync`
 * construction throws the loud "engine not initialized" error naming the seam
 * (ADR-0065 D4). Registration itself stays synchronous and engine-free.
 *
 * Registry caching caveat: the namespace is cached after the first successful
 * factory run, so a provider installed AFTER a no-provider require will not
 * retrigger the factory — hosts install the provider at boot. A THROWING
 * factory (provider/bytes failure) is not cached; the next require retries.
 */
// TODO(backlog: net/sqlite-registration-path) — exact node:sqlite builtin registration module path
import { registerBuiltin } from '@riftydev/io';
import { DatabaseSync } from './database-sync.ts';
import { ensureSqliteEngineFromProvider } from './engine.ts';

let sqliteBuiltinRegistered = false;

export function registerSqliteBuiltin(): void {
  if (sqliteBuiltinRegistered) return;
  sqliteBuiltinRegistered = true;

  registerBuiltin('sqlite', () => {
    ensureSqliteEngineFromProvider();
    return { DatabaseSync };
  });
}

registerSqliteBuiltin();
