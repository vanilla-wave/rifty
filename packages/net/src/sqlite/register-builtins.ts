/**
 * Side-effect module: registers the `node:sqlite` builtin shape with the shared
 * `@rifty/io` builtin registry (ADR-0035 / ADR-0065 D3). Import this from a
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
 * The factory exposes only the `DatabaseSync` class. The engine must be brought
 * up (`initSqliteEngine()` awaited) before a `DatabaseSync` is constructed — the
 * synchronous constructor depends on the resolved engine handle (ADR-0065 D1).
 * Registration itself is synchronous and does not touch the engine.
 */
// TODO(ADR): Q-2026-05-31-302 — exact node:sqlite builtin registration module path
import { registerBuiltin } from '@rifty/io';
import { DatabaseSync } from './database-sync.ts';

registerBuiltin('sqlite', () => ({ DatabaseSync }));
