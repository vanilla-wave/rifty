import type { ParityCase } from '../../src/types.ts';

/**
 * `node:sqlite` opencode-boot-sequence parity (ADR-0065, the sql.js shim). This
 * runs opencode's EXACT database-boot sequence head-to-head: the Node side runs
 * the genuine `node:sqlite` `DatabaseSync` (Node ≥22), the rifty side runs the
 * sql.js-backed shim, and the two stdouts must agree byte-for-byte. It is the
 * parity twin of the conformance gate
 * `tests/conformance/builtins/sqlite-opencode-boot.test.ts` — conformance proves
 * "rifty boots opencode's database layer without throwing"; this proves "and the
 * observable results match real Node".
 *
 * Why it matters: opencode's `Server.listen` builds its Effect layer DAG eagerly,
 * and `Database.layer`'s acquire opens `:memory:`, runs the PRAGMAs, and applies
 * the migrations BEFORE any request is served (Spike C,
 * `docs/backlog/opencode/spike-c-createroutes-layer-build.md`).
 * If rifty's shim diverged from Node on any of these — a PRAGMA throwing, the
 * migration journal table not seeding as empty, the transaction not committing —
 * boot would fail or behave differently. This case pins that it does not.
 *
 * The sequence, verbatim from the vendored opencode source
 * (`tests/integration/fixtures/opencode/source`):
 *   - `nativeLayer` (`sqlite.node.ts:151-160`): open `:memory:` with
 *     `enableForeignKeyConstraints: true`, then `exec('PRAGMA journal_mode = WAL;')`.
 *   - `Database.layer` (`database.ts:26-31`): six PRAGMAs, each run the way the
 *     `@effect/sql-sqlite-node` session drives `db.run(...)` — through
 *     `prepare(pragma).all()` (the session has no dedicated PRAGMA API; every
 *     statement goes through `prepare().all()`).
 *   - `DatabaseMigration.apply` (`migration.ts:21-57`): create the `migration`
 *     journal, seed-detect (`SELECT id FROM migration` empty; no
 *     `__drizzle_migrations` legacy table), then a transaction —
 *     `begin deferred` → the first real migration's DDL
 *     (`20260127222353_familiar_lady_ursula`: eight `CREATE TABLE`s with forward
 *     FKs + six `CREATE INDEX`es) → `INSERT INTO migration` → `commit`. effect
 *     drives `begin deferred` / `commit` as plain SQL strings through the same
 *     `prepare().all()` path (`session.ts:114,145,157`), not a transaction API.
 *
 * Output discipline (same as the sibling sqlite cases): every assertion prints a
 * STRING argument (`'tag:' + JSON.stringify(...)`), so the rifty console-capture
 * (`formatArgs`) and Node's `console.log` emit the SAME bytes — the comparison is
 * on the serialised result, not on inspect formatting.
 *
 * SQL-literal note (same as the sibling cases): SINGLE-quoted string literals are
 * used for the `__drizzle_migrations` name and the migration id — Node's
 * `node:sqlite` build runs with double-quoted-string compatibility OFF, where a
 * double-quoted token parses as a column reference and throws. The migration DDL
 * uses backtick-quoted identifiers exactly as the vendored migration file does.
 */
const c: ParityCase = {
  kind: 'sqlite',
  code: `
    const { DatabaseSync } = require('node:sqlite');

    // (1) nativeLayer: open :memory: with FK constraints on; post-open WAL PRAGMA.
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, open: true });
    db.exec('PRAGMA journal_mode = WAL;');

    // (2) Database.layer's six PRAGMAs, via prepare(pragma).all() — a control
    // statement yields no rows, so each returns [].
    const PRAGMAS = [
      'PRAGMA journal_mode = WAL',
      'PRAGMA synchronous = NORMAL',
      'PRAGMA busy_timeout = 5000',
      'PRAGMA cache_size = -64000',
      'PRAGMA foreign_keys = ON',
      'PRAGMA wal_checkpoint(PASSIVE)',
    ];
    for (const p of PRAGMAS) db.prepare(p).all();

    // (3) DatabaseMigration.apply — the migration journal.
    db.prepare('CREATE TABLE IF NOT EXISTS \`migration\` (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)').all();

    // seed detection: fresh boot -> empty journal, no legacy drizzle table.
    console.log('completedBefore:' + JSON.stringify(db.prepare('SELECT id FROM \`migration\`').all()));
    console.log('legacy:' + JSON.stringify(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").all()));

    // The per-migration transaction: begin deferred -> up() DDL -> record -> commit.
    db.prepare('begin deferred').all();
    const MIGRATION = [
      'CREATE TABLE \`project\` (\`id\` text PRIMARY KEY, \`worktree\` text NOT NULL, \`vcs\` text, \`name\` text, \`icon_url\` text, \`icon_color\` text, \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`time_initialized\` integer, \`sandboxes\` text NOT NULL);',
      'CREATE TABLE \`message\` (\`id\` text PRIMARY KEY, \`session_id\` text NOT NULL, \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`data\` text NOT NULL, CONSTRAINT \`fk_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE);',
      'CREATE TABLE \`part\` (\`id\` text PRIMARY KEY, \`message_id\` text NOT NULL, \`session_id\` text NOT NULL, \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`data\` text NOT NULL, CONSTRAINT \`fk_part_message_id_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`message\`(\`id\`) ON DELETE CASCADE);',
      'CREATE TABLE \`permission\` (\`project_id\` text PRIMARY KEY, \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`data\` text NOT NULL, CONSTRAINT \`fk_permission_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE);',
      'CREATE TABLE \`session\` (\`id\` text PRIMARY KEY, \`project_id\` text NOT NULL, \`parent_id\` text, \`slug\` text NOT NULL, \`directory\` text NOT NULL, \`title\` text NOT NULL, \`version\` text NOT NULL, \`share_url\` text, \`summary_additions\` integer, \`summary_deletions\` integer, \`summary_files\` integer, \`summary_diffs\` text, \`revert\` text, \`permission\` text, \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, \`time_compacting\` integer, \`time_archived\` integer, CONSTRAINT \`fk_session_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE);',
      'CREATE TABLE \`todo\` (\`session_id\` text NOT NULL, \`content\` text NOT NULL, \`status\` text NOT NULL, \`priority\` text NOT NULL, \`position\` integer NOT NULL, \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, CONSTRAINT \`todo_pk\` PRIMARY KEY(\`session_id\`, \`position\`), CONSTRAINT \`fk_todo_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE);',
      'CREATE TABLE \`session_share\` (\`session_id\` text PRIMARY KEY, \`id\` text NOT NULL, \`secret\` text NOT NULL, \`url\` text NOT NULL, \`time_created\` integer NOT NULL, \`time_updated\` integer NOT NULL, CONSTRAINT \`fk_session_share_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE);',
      'CREATE INDEX \`message_session_idx\` ON \`message\` (\`session_id\`);',
      'CREATE INDEX \`part_message_idx\` ON \`part\` (\`message_id\`);',
      'CREATE INDEX \`part_session_idx\` ON \`part\` (\`session_id\`);',
      'CREATE INDEX \`session_project_idx\` ON \`session\` (\`project_id\`);',
      'CREATE INDEX \`session_parent_idx\` ON \`session\` (\`parent_id\`);',
      'CREATE INDEX \`todo_session_idx\` ON \`todo\` (\`session_id\`);',
    ];
    for (const s of MIGRATION) db.prepare(s).run();
    // Fixed time_completed so the recorded row is identical across both runtimes.
    db.prepare('INSERT INTO \`migration\` (id, time_completed) VALUES (?, ?)').run(
      '20260127222353_familiar_lady_ursula', 1737000000000);
    db.prepare('commit').all();

    // The transaction committed: exactly the one applied migration id is recorded.
    console.log('completedAfter:' + JSON.stringify(db.prepare('SELECT id FROM \`migration\`').all()));

    // The migration's DDL created the schema: the forward-FK \`message\` table
    // exists and reads back empty.
    console.log('messages:' + JSON.stringify(db.prepare('SELECT id FROM \`message\`').all()));

    db.close();
  `,
};

export default c;
