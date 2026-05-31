/**
 * Focused wiring proof for the `node:sqlite` builtin reaching the module loader
 * (WIRE task item 1). It is intentionally minimal and SEPARATE from the
 * `sqlite-opencode-boot` conformance gate: that test reproduces opencode's full
 * PRAGMA + 24-migration boot path; THIS one pins only the load-bearing seam — a
 * plain guest module that does `require('node:sqlite')` through the real module
 * loader, opens an in-memory database, INSERTs a row, and SELECTs it back.
 *
 * The failure mode it guards: the `node:sqlite` specifier must resolve to the
 * sql.js-backed `DatabaseSync` shim the SAME way `node:http` does — through the
 * `@rifty/io` builtin registry that `@rifty/net/sqlite/register-builtins`
 * populates (ADR-0035 forward-import seam, NOT a reverse import from the loader
 * into `@rifty/net`). If that registration regressed, or the loader stopped
 * routing `node:`-prefixed specifiers through the registry, this `require`
 * would throw `MODULE_NOT_FOUND` instead of round-tripping the row.
 *
 * Wiring mirrors the runtime / parity-runner `installSqliteMode`: import the
 * side-effecting registration, then bring up the WASM engine so the synchronous
 * `DatabaseSync` constructor has its handle ready (the one async step the
 * otherwise-synchronous surface depends on, ADR-0065 D1).
 */
import { initSqliteEngine } from '@rifty/net/sqlite/engine';
import { createModuleLoader } from '@rifty/runtime-js/loader';
import { MemoryFsSync } from '@rifty/vfs/internal';
import { beforeAll, describe, expect, it } from 'vitest';

describe('node:sqlite — module-loader wiring round-trip (WIRE item 1)', () => {
  beforeAll(async () => {
    await import('@rifty/net/sqlite/register-builtins');
    await initSqliteEngine();
  });

  it('a guest module importing node:sqlite opens :memory: and round-trips a row', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/guest.js': `
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.exec('CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER NOT NULL)');
        db.prepare('INSERT INTO kv (k, v) VALUES (?, ?)').run('answer', 42);
        const row = db.prepare('SELECT v FROM kv WHERE k = ?').get('answer');
        db.close();
        module.exports = row;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    // The whole open -> insert -> select -> close path runs inside the require()'d
    // guest; a broken loader->registry->shim seam would throw here rather than
    // hand back the row.
    const row = loader.require('./guest.js', '/work/__entry.js');
    expect(row).toEqual({ v: 42 });
  });
});
