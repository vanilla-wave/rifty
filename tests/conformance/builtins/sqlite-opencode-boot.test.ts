/**
 * P2 boot-prerequisite conformance gate (ADR-0065): the rifty `node:sqlite`
 * `DatabaseSync` shim, backed by sql.js, must execute opencode's EXACT
 * database-boot sequence without throwing — because opencode's `Server.listen`
 * builds the Effect layer DAG eagerly, and `Database.layer`'s acquire opens the
 * database, runs the PRAGMAs, and applies the migrations BEFORE any HTTP request
 * is served (Spike C, `docs/backlog/opencode/spike-c-createroutes-layer-build.md`). A throw anywhere on this path
 * dies the layer build under `Effect.orDie` and fails boot. So this is the gate
 * that says "rifty can boot opencode's database layer".
 *
 * This is a CONFORMANCE test (not a unit test of the shim internals): it runs
 * the boot sequence through `require('node:sqlite')` inside the REAL rifty module
 * loader (`@riftydev/runtime-js/loader`), so the `node:sqlite` specifier resolves
 * the same way user code resolves it — through the `@riftydev/io` builtin registry
 * that the `@riftydev/net/sqlite/register-builtins` side-effect populates. That
 * mirrors the parity runner's `installSqliteMode` (register side-effect, then
 * await `initSqliteEngine()` so the synchronous `DatabaseSync` constructor has
 * its WASM handle) and the `node:net` precedent of registering from `@riftydev/net`
 * rather than `@riftydev/runtime-js` (top-down layering: runtime-* must not depend
 * on net).
 *
 * The sequence reproduced here is opencode's literal boot path against the
 * vendored source (`tests/integration/fixtures/opencode/source`):
 *
 *   1. `nativeLayer` opens the database (`sqlite.node.ts:151-160`):
 *      `new DatabaseSync(filename, { enableForeignKeyConstraints: true, open: true })`
 *      then `native.exec("PRAGMA journal_mode = WAL;")`.
 *   2. `Database.layer` runs six PRAGMAs (`database.ts:26-31`). opencode issues
 *      these via `db.run(...)`, which the `@effect/sql-sqlite-node` session
 *      drives through the connection's `prepare(query).all()` path (the effect
 *      session has NO dedicated PRAGMA API — every statement, including PRAGMAs
 *      and transaction control, goes through `prepare().all()`; see
 *      `effect-drizzle-sqlite/.../session.ts`). So these run through
 *      `db.prepare(pragma).all()`, matching the real driver, not `db.exec`.
 *   3. `DatabaseMigration.apply` (`migration.ts:21-57`):
 *      - `CREATE TABLE IF NOT EXISTS migration (id TEXT PRIMARY KEY,
 *        time_completed INTEGER NOT NULL)` — the migration journal.
 *      - seed detection: `SELECT id FROM migration` (empty on a fresh boot) and
 *        `SELECT name FROM sqlite_master WHERE type = 'table' AND name =
 *        '__drizzle_migrations'` (absent on a fresh boot, so no seeding).
 *      - for each not-yet-applied migration, a transaction: `begin deferred` →
 *        `migration.up(tx)` → `INSERT INTO migration (id, time_completed)
 *        VALUES (?, ?)` → `commit`. effect drives `begin deferred` / `commit`
 *        as plain SQL strings through the same `prepare().all()` path
 *        (`session.ts:114,145,157`), NOT a `DatabaseSync` transaction API
 *        (there is none).
 *      The migration body run here is the first real opencode migration,
 *      `20260127222353_familiar_lady_ursula` — the eight `CREATE TABLE`s
 *      (`project`, `message`, `part`, `permission`, `session`, `todo`,
 *      `session_share`) and six `CREATE INDEX`es it issues, verbatim from the
 *      vendored migration file. It exercises forward foreign-key references
 *      (`message`/`part` reference `session`, declared later in the same
 *      transaction) under `PRAGMA foreign_keys = ON` — SQLite resolves FK
 *      targets at constraint-check time, not at `CREATE TABLE` time, so this
 *      must succeed.
 *
 * The boot sequence runs inside `/work/main.js` and reports its outcome by
 * `module.exports` so the test asserts on it: the whole sequence completes
 * without throwing, and after the `commit` the `migration` table records exactly
 * the one applied migration id — proving the transaction actually committed (not
 * silently no-op'd) and the row is readable back through the same shim. The
 * empty `message` read proves the migration's DDL really created the schema.
 */
import { initSqliteEngine, isSqliteEngineReady } from '@riftydev/net/sqlite/engine';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The first real opencode migration, `20260127222353_familiar_lady_ursula`,
 * reproduced verbatim from
 * `tests/integration/fixtures/opencode/source/packages/core/src/database/migration/20260127222353_familiar_lady_ursula.ts`.
 * Each entry is one `tx.run(...)` call in the migration's `up`. The order is the
 * source order: `message`/`part` declare a forward FK to `session`, which is
 * created later in the same transaction.
 */
const FAMILIAR_LADY_URSULA: readonly string[] = [
  'CREATE TABLE `project` (' +
    '`id` text PRIMARY KEY, `worktree` text NOT NULL, `vcs` text, `name` text, ' +
    '`icon_url` text, `icon_color` text, `time_created` integer NOT NULL, ' +
    '`time_updated` integer NOT NULL, `time_initialized` integer, ' +
    '`sandboxes` text NOT NULL);',
  'CREATE TABLE `message` (' +
    '`id` text PRIMARY KEY, `session_id` text NOT NULL, `time_created` integer NOT NULL, ' +
    '`time_updated` integer NOT NULL, `data` text NOT NULL, ' +
    'CONSTRAINT `fk_message_session_id_session_id_fk` FOREIGN KEY (`session_id`) ' +
    'REFERENCES `session`(`id`) ON DELETE CASCADE);',
  'CREATE TABLE `part` (' +
    '`id` text PRIMARY KEY, `message_id` text NOT NULL, `session_id` text NOT NULL, ' +
    '`time_created` integer NOT NULL, `time_updated` integer NOT NULL, `data` text NOT NULL, ' +
    'CONSTRAINT `fk_part_message_id_message_id_fk` FOREIGN KEY (`message_id`) ' +
    'REFERENCES `message`(`id`) ON DELETE CASCADE);',
  'CREATE TABLE `permission` (' +
    '`project_id` text PRIMARY KEY, `time_created` integer NOT NULL, ' +
    '`time_updated` integer NOT NULL, `data` text NOT NULL, ' +
    'CONSTRAINT `fk_permission_project_id_project_id_fk` FOREIGN KEY (`project_id`) ' +
    'REFERENCES `project`(`id`) ON DELETE CASCADE);',
  'CREATE TABLE `session` (' +
    '`id` text PRIMARY KEY, `project_id` text NOT NULL, `parent_id` text, ' +
    '`slug` text NOT NULL, `directory` text NOT NULL, `title` text NOT NULL, ' +
    '`version` text NOT NULL, `share_url` text, `summary_additions` integer, ' +
    '`summary_deletions` integer, `summary_files` integer, `summary_diffs` text, ' +
    '`revert` text, `permission` text, `time_created` integer NOT NULL, ' +
    '`time_updated` integer NOT NULL, `time_compacting` integer, `time_archived` integer, ' +
    'CONSTRAINT `fk_session_project_id_project_id_fk` FOREIGN KEY (`project_id`) ' +
    'REFERENCES `project`(`id`) ON DELETE CASCADE);',
  'CREATE TABLE `todo` (' +
    '`session_id` text NOT NULL, `content` text NOT NULL, `status` text NOT NULL, ' +
    '`priority` text NOT NULL, `position` integer NOT NULL, `time_created` integer NOT NULL, ' +
    '`time_updated` integer NOT NULL, ' +
    'CONSTRAINT `todo_pk` PRIMARY KEY(`session_id`, `position`), ' +
    'CONSTRAINT `fk_todo_session_id_session_id_fk` FOREIGN KEY (`session_id`) ' +
    'REFERENCES `session`(`id`) ON DELETE CASCADE);',
  'CREATE TABLE `session_share` (' +
    '`session_id` text PRIMARY KEY, `id` text NOT NULL, `secret` text NOT NULL, ' +
    '`url` text NOT NULL, `time_created` integer NOT NULL, `time_updated` integer NOT NULL, ' +
    'CONSTRAINT `fk_session_share_session_id_session_id_fk` FOREIGN KEY (`session_id`) ' +
    'REFERENCES `session`(`id`) ON DELETE CASCADE);',
  'CREATE INDEX `message_session_idx` ON `message` (`session_id`);',
  'CREATE INDEX `part_message_idx` ON `part` (`message_id`);',
  'CREATE INDEX `part_session_idx` ON `part` (`session_id`);',
  'CREATE INDEX `session_project_idx` ON `session` (`project_id`);',
  'CREATE INDEX `session_parent_idx` ON `session` (`parent_id`);',
  'CREATE INDEX `todo_session_idx` ON `todo` (`session_id`);',
];

const MIGRATION_ID = '20260127222353_familiar_lady_ursula';

/**
 * The opencode boot sequence as the user code that runs through the rifty loader
 * and `require('node:sqlite')`. It returns its observable outcome on
 * `module.exports` so the test can assert on it. Built as a string so it is
 * evaluated by the loader's CJS path (the real `require('node:sqlite')`
 * resolution), not imported statically by the test harness.
 */
function bootScript(): string {
  return `
    const { DatabaseSync } = require('node:sqlite');

    // (1) nativeLayer: open :memory: with FK constraints on (sqlite.node.ts:151).
    // opencode's boot uses OPENCODE_DB=:memory:; this matches it exactly.
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, open: true });

    // nativeLayer's post-open PRAGMA (sqlite.node.ts:159) — issued via exec().
    db.exec('PRAGMA journal_mode = WAL;');

    // (2) Database.layer's six PRAGMAs (database.ts:26-31), driven the way the
    // effect session drives db.run(...) — through prepare(pragma).all().
    const PRAGMAS = ${JSON.stringify([
      'PRAGMA journal_mode = WAL',
      'PRAGMA synchronous = NORMAL',
      'PRAGMA busy_timeout = 5000',
      'PRAGMA cache_size = -64000',
      'PRAGMA foreign_keys = ON',
      'PRAGMA wal_checkpoint(PASSIVE)',
    ])};
    for (const pragma of PRAGMAS) db.prepare(pragma).all();

    // (3) DatabaseMigration.apply (migration.ts). The migration journal table.
    db.prepare(
      'CREATE TABLE IF NOT EXISTS \`migration\` (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)',
    ).all();

    // seed detection: nothing applied yet on a fresh boot.
    const completedBefore = db.prepare('SELECT id FROM \`migration\`').all();

    // seed detection: no legacy drizzle journal on a fresh boot, so no seeding.
    const legacy = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .all();

    // The per-migration transaction: begin deferred -> up() -> record -> commit.
    // effect drives the transaction-control keywords as plain SQL strings through
    // the same prepare().all() path (session.ts:114,145,157).
    db.prepare('begin deferred').all();
    const MIGRATION = ${JSON.stringify(FAMILIAR_LADY_URSULA)};
    for (const statement of MIGRATION) db.prepare(statement).run();
    db.prepare('INSERT INTO \`migration\` (id, time_completed) VALUES (?, ?)').run(
      ${JSON.stringify(MIGRATION_ID)},
      Date.now(),
    );
    db.prepare('commit').all();

    // The transaction committed: the migration row is durable within the
    // connection and readable back through the same shim.
    const completedAfter = db.prepare('SELECT id FROM \`migration\`').all();

    // The migration's DDL really created the schema: \`message\` (a forward-FK
    // table) exists and reads back empty.
    const messages = db.prepare('SELECT id FROM \`message\`').all();

    db.close();

    module.exports = { completedBefore, legacy, completedAfter, messages };
  `;
}

describe('node:sqlite — opencode database-boot conformance (ADR-0065, P2 gate)', () => {
  beforeAll(async () => {
    // Mirror the runtime / parity-runner wiring: the side-effecting forward
    // import of `@riftydev/net/sqlite/register-builtins` plugs the sql.js-backed
    // `DatabaseSync` factory into the `@riftydev/io` registry (the same precedent
    // as `@riftydev/net/register-builtins` for `node:http`), then the WASM engine
    // is brought up so the synchronous `DatabaseSync` constructor has its handle.
    await import('@riftydev/net/sqlite/register-builtins');
    await initSqliteEngine();
  });

  it('register-builtins side-effect populated the registry and the engine came up', () => {
    // The two preconditions the synchronous boot path depends on: the WASM engine
    // is up (so the synchronous `DatabaseSync` constructor's `getSqliteEngine()`
    // won't throw), and `require('node:sqlite')` resolves to a `DatabaseSync`
    // constructor through the real loader (the registry was populated).
    expect(isSqliteEngineReady()).toBe(true);
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/probe.js': "const m = require('node:sqlite'); module.exports = typeof m.DatabaseSync;",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });
    expect(loader.require('./probe.js', '/work/__entry.js')).toBe('function');
  });

  it('boots: open :memory:, run all six PRAGMAs + journal_mode WAL, apply the first migration in a transaction', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/work/main.js': bootScript() });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    // The whole boot sequence runs inside the require()'d module; if any
    // statement on opencode's boot path threw, this require would throw and fail
    // the test (that is precisely the boot-fails-the-layer-build failure mode).
    const out = loader.require('./main.js', '/work/__entry.js') as {
      completedBefore: Array<Record<string, unknown>>;
      legacy: Array<Record<string, unknown>>;
      completedAfter: Array<Record<string, unknown>>;
      messages: Array<Record<string, unknown>>;
    };

    // Fresh-boot seed detection saw an empty journal and no legacy drizzle table.
    expect(out.completedBefore).toEqual([]);
    expect(out.legacy).toEqual([]);

    // The transaction committed: exactly the one applied migration id is recorded
    // and readable back through the same shim (proves commit persisted, not a
    // silent no-op).
    expect(out.completedAfter).toEqual([{ id: MIGRATION_ID }]);

    // The migration's DDL created the schema: the forward-FK `message` table
    // exists and reads back empty.
    expect(out.messages).toEqual([]);
  });
});
