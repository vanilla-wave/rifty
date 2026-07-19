import { Worker as NodeWorker } from 'node:worker_threads';
import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  runDefaultProjectOnce,
  writeOwnerFile,
} from './fixtures.ts';

const MISSING_RUNTIME_CONFIG_ERROR = 'node-entry worker bootstrap config is not configured';
const MUST_NOT_LOAD_BOOTSTRAP_PATH = '/__recursive-node-bootstrap-must-not-load__.js';

interface WorkerContextOracle {
  readonly env: string;
  readonly envKeys: readonly string[];
  readonly parentAbsent: boolean;
  readonly cwdInherited: boolean;
  readonly data: number;
}

function nativeWorkerContextOracle(): Promise<WorkerContextOracle> {
  return new Promise((resolve, reject) => {
    const worker = new NodeWorker(
      `const { parentPort, workerData } = require('node:worker_threads');
parentPort.postMessage({
  env: process.env.CONTEXT_SENTINEL,
  envKeys: Object.keys(process.env).sort(),
  parentAbsent: process.env.PARENT_ONLY === undefined,
  cwdInherited: process.cwd() === workerData.parentCwd,
  data: workerData.answer,
});`,
      {
        eval: true,
        env: { CONTEXT_SENTINEL: 'worker-exact' },
        workerData: { answer: 42, parentCwd: process.cwd() },
      },
    );
    worker.once('message', (message: WorkerContextOracle) => resolve(message));
    worker.once('error', reject);
  });
}

test('execSync child inherits exact context and initializes node:sqlite before entry', async ({
  page,
}) => {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-recursive-node-sqlite',
    hiddenEmptyBoot: true,
  });

  try {
    await writeOwnerFile(
      page,
      '/scratch/sqlite-child.mjs',
      `import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE values_table (value TEXT); INSERT INTO values_table VALUES ('sqlite-ready');");
const row = db.prepare('SELECT value FROM values_table').get();
process.stdout.write(
  'NESTED_SQLITE|' + row.value + '|cwd=' + process.cwd() + '|env=' + process.env.CONTEXT_SENTINEL + '\\n',
);
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/sqlite-parent.mjs',
      `import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
if (!existsSync('/sqlite-child.mjs')) {
  throw new Error('parent guest fs cannot see /sqlite-child.mjs');
}
const stdout = execSync('node sqlite-child.mjs', {
  cwd: '/',
  env: { CONTEXT_SENTINEL: 'exact-child' },
});
process.stdout.write(stdout);
`,
    );

    expect(await runDefaultProjectOnce(page)).toEqual({ code: 0, signal: null });

    const result = await execLine(page, 'node sqlite-parent.mjs');
    expect(result.exit, result.out).toBe(0);
    expect(result.out).toContain('NESTED_SQLITE|sqlite-ready|cwd=/|env=exact-child');
  } finally {
    await closeOwner(page);
  }
});

// Fault class: false-fallback — a recursive Vite child must not inherit the parent's endpoint.
test('recursive Vite 7 fails at the missing shadow capability before import or fallback', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-recursive-vite-shadow-capability',
    template: 'vite',
    setup: 'instant',
    starter: 'recursive-vite-shadow-capability',
    hiddenEmptyBoot: false,
  });

  let observeRecursiveNetwork = false;
  const recursiveAssetRequests: string[] = [];
  page.on('request', (request) => {
    if (!observeRecursiveNetwork) return;
    const path = new URL(request.url()).pathname;
    if (path.includes('esbuild') || path.includes('wasi-preview1')) {
      recursiveAssetRequests.push(path);
    }
  });

  try {
    const admitted = await execLine(page, 'vite --version');
    expect(admitted.exit, admitted.out).toBe(0);
    expect(admitted.out).toContain('vite/7.3.6');

    await writeOwnerFile(
      page,
      '/scratch/recursive-vite-settlement.mjs',
      `process.stdout.write('RECURSIVE_SETTLED');\n`,
    );
    await writeOwnerFile(
      page,
      '/scratch/recursive-vite-parent.mjs',
      `import { execSync } from 'node:child_process';
try {
  execSync('node node_modules/.bin/vite --version', { cwd: '/', env: { CHILD_ONLY: 'exact' } });
  process.stdout.write('RECURSIVE_VITE_UNEXPECTED_SUCCESS\\n');
} catch (error) {
  process.stdout.write('RECURSIVE_VITE_FAILURE|' + error.message.replaceAll('\\n', ' ') + '\\n');
}
process.stdout.write(execSync('node recursive-vite-settlement.mjs', { cwd: '/', env: {} }));
`,
    );

    observeRecursiveNetwork = true;
    const result = await execLine(page, 'node recursive-vite-parent.mjs');
    observeRecursiveNetwork = false;

    expect(result.exit, result.out).toBe(0);
    expect(result.out).toContain('RECURSIVE_VITE_FAILURE|');
    expect(result.out).toContain('NotImplementedError');
    expect(result.out).toContain('vite.esbuild.shadowAssets');
    expect(result.out).not.toContain('esbuild runtime slot is not initialized');
    expect(result.out).toContain('RECURSIVE_SETTLED');
    expect(recursiveAssetRequests).toEqual([]);
  } finally {
    await closeOwner(page);
  }
});

test('kernel Worker matches Node context and relays owner FS, execSync, and sqlite', async ({
  page,
}) => {
  const oracle = await nativeWorkerContextOracle();
  expect(oracle).toEqual({
    env: 'worker-exact',
    envKeys: ['CONTEXT_SENTINEL'],
    parentAbsent: true,
    cwdInherited: true,
    data: 42,
  });

  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-recursive-worker-runtime',
    hiddenEmptyBoot: true,
  });

  try {
    await writeOwnerFile(page, '/scratch/worker-data.txt', 'owner-file\n');
    await writeOwnerFile(
      page,
      '/scratch/worker-grandchild.mjs',
      `import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE values_table (value TEXT); INSERT INTO values_table VALUES ('grandchild-sqlite');");
const row = db.prepare('SELECT value FROM values_table').get();
process.stdout.write(row.value + ':' + process.env.GRAND_SENTINEL);
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/worker-child.mjs',
      `import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';

const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE values_table (value TEXT); INSERT INTO values_table VALUES ('worker-sqlite');");
const row = db.prepare('SELECT value FROM values_table').get();
const nested = execSync('node worker-grandchild.mjs', {
  cwd: process.cwd(),
  env: { GRAND_SENTINEL: 'grand-exact' },
}).toString();
parentPort.postMessage({
  env: process.env.CONTEXT_SENTINEL,
  envKeys: Object.keys(process.env).sort(),
  parentAbsent: process.env.PARENT_ONLY === undefined,
  cwd: process.cwd(),
  data: workerData.answer,
  file: readFileSync('worker-data.txt', 'utf8').trim(),
  sqlite: row.value,
  nested,
});
`,
    );
    await writeOwnerFile(
      page,
      '/scratch/worker-parent.mjs',
      `import { Worker } from 'node:worker_threads';

process.env.PARENT_ONLY = 'parent';
const parentCwd = process.cwd();
const worker = new Worker(new URL('./worker-child.mjs', import.meta.url), {
  env: { CONTEXT_SENTINEL: 'worker-exact' },
  workerData: { answer: 42 },
});
const message = await new Promise((resolve, reject) => {
  let received = false;
  worker.once('message', (value) => {
    received = true;
    resolve(value);
  });
  worker.once('error', reject);
  worker.once('exit', (code) => {
    if (!received) reject(new Error('worker exited before message: ' + code));
  });
});
process.stdout.write(
  'WORKER_RELAY' +
    '|env=' + message.env +
    '|envKeys=' + message.envKeys.join(',') +
    '|parentAbsent=' + message.parentAbsent +
    '|cwdInherited=' + (message.cwd === parentCwd) +
    '|cwd=' + message.cwd +
    '|data=' + message.data +
    '|file=' + message.file +
    '|sqlite=' + message.sqlite +
    '|nested=' + message.nested + '\\n',
);
await worker.terminate();
`,
    );

    expect(await runDefaultProjectOnce(page)).toEqual({ code: 0, signal: null });

    const result = await execLine(page, 'node worker-parent.mjs');
    expect(result.exit, result.out).toBe(0);
    expect(result.out).toContain(
      `WORKER_RELAY|env=${oracle.env}|envKeys=${oracle.envKeys.join(',')}|parentAbsent=${oracle.parentAbsent}|cwdInherited=${oracle.cwdInherited}|cwd=/|data=${oracle.data}|file=owner-file|sqlite=worker-sqlite|nested=grandchild-sqlite:grand-exact`,
    );
  } finally {
    await closeOwner(page);
  }
});

// Fault class: frozen-assumption — unit/fake-spawn cannot close the real SAB boundary.
test('real-COI execSync fails loud before recursive spawn when bootstrap config is URL-only', async ({
  page,
}) => {
  const bootstrapRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === MUST_NOT_LOAD_BOOTSTRAP_PATH) {
      bootstrapRequests.push(request.url());
    }
  });

  await gotoHarness(page);
  await page.evaluate(
    async ({ bootstrapPath }) => {
      const { runExecSyncHarness } = await import('/src/execsync-harness.ts');
      await runExecSyncHarness({
        fault: 'missing-node-entry-runtime-config',
        nodeEntryUrl: new URL(bootstrapPath, location.origin).href,
      });
    },
    { bootstrapPath: MUST_NOT_LOAD_BOOTSTRAP_PATH },
  );

  const harness = page.locator('[data-testid="execsync-harness"]');
  expect(bootstrapRequests, 'recursive node bootstrap must not be requested').toEqual([]);
  await expect(harness).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-testid="execsync-config-error"]')).toHaveText(
    `config-error: ${MISSING_RUNTIME_CONFIG_ERROR}`,
  );
});
