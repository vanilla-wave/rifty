import assert from 'node:assert/strict';
import '../../../packages/net/src/register-builtins.ts';
import '../../../packages/net/src/sqlite/register-builtins.ts';
import { EXPRESS_SQLITE_TEMPLATE } from '../../../apps/playground/src/templates/express-sqlite.ts';
import { resolveBootstrapConfig } from '../../../apps/playground/src/templates/project-spec.ts';
import { dispatchToPort, listPorts, unregisterPort } from '../../../packages/net/src/index.ts';
import { initSqliteEngine } from '../../../packages/net/src/sqlite/engine.ts';
import { RegistryClient, install } from '../../../packages/npm-client/src/index.ts';
import { Buffer as RiftyBuffer } from '../../../packages/runtime-js/src/builtins/buffer.ts';
import {
  installProcessGlobals,
  setProcessCwd,
} from '../../../packages/runtime-js/src/builtins/process.ts';
import { installTimerGlobals } from '../../../packages/runtime-js/src/builtins/timers.ts';
import { createModuleLoader } from '../../../packages/runtime-js/src/module-loader/index.ts';
import { createMemoryFs, setSyncMirror } from '../../../packages/vfs/src/internal/index.ts';

const hostProcess = process;
const hostStdout = hostProcess.stdout;
const hostStderr = hostProcess.stderr;
const hostExit = hostProcess.exit.bind(hostProcess);
const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
const hostBuffer = (globalThis as { Buffer?: unknown }).Buffer;
const hostEnv = { ...hostProcess.env };
const ROOT = '/workspace';
const PORT = EXPRESS_SQLITE_TEMPLATE.defaultPort;
const MARKER = 'RIFTY_FULLSTACK_DEMO_SMOKE_OK';

interface TodoRow {
  readonly id: number;
  readonly title: string;
  readonly done: number;
}

function hostDelay(ms: number): Promise<void> {
  return new Promise((resolve) => hostSetTimeout(resolve, ms));
}

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!listPorts().includes(port)) {
    if (Date.now() >= deadline)
      throw new Error(`Fullstack template did not listen on port ${port}`);
    await hostDelay(10);
  }
}

async function cleanup(): Promise<void> {
  for (const port of listPorts()) unregisterPort(port);
  await hostDelay(100);
  (globalThis as { Buffer?: unknown }).Buffer = hostBuffer;
  assert.deepEqual(listPorts(), [], 'registered fullstack ports survived child cleanup');
}

async function runSmoke(): Promise<void> {
  const registryUrl = hostEnv.RIFTY_LIVE_REGISTRY;
  assert.ok(registryUrl, 'RIFTY_LIVE_REGISTRY is required');

  const cfg = resolveBootstrapConfig(EXPRESS_SQLITE_TEMPLATE, PORT, ROOT);
  const { vfs, fsSync } = createMemoryFs();
  const registry = new RegistryClient({ baseUrl: registryUrl, fetch: globalThis.fetch });
  await install(cfg.packageName, cfg.packageVersion, cfg.installDeps, {
    vfs,
    cwd: ROOT,
    registry,
  });

  setSyncMirror(fsSync, { async: vfs });
  installProcessGlobals();
  installTimerGlobals();
  (globalThis as { Buffer: unknown }).Buffer = RiftyBuffer;

  const encoder = new TextEncoder();
  for (const [path, content] of Object.entries(cfg.seedFiles)) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir) fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(path, encoder.encode(content));
  }

  setProcessCwd(ROOT);
  globalThis.process.env.PORT = String(PORT);
  await initSqliteEngine();
  const loader = createModuleLoader(fsSync, { cwd: ROOT });
  await loader.import(cfg.entryPath, `${ROOT}/__entry__.mjs`);
  await waitForPort(PORT);

  assert.ok(listPorts().includes(PORT), 'template did not bind its default port');

  const index = await dispatchToPort(PORT, new Request('http://x/'));
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') ?? '', /text\/html/u);
  const indexBody = await index.text();
  assert.match(indexBody, /todos/u);
  assert.match(indexBody, /client\.js/u);

  const stylesheet = await dispatchToPort(PORT, new Request('http://x/styles.css'));
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/u);

  const seeded = await dispatchToPort(PORT, new Request('http://x/api/todos'));
  assert.equal(seeded.status, 200);
  const seededRows = (await seeded.json()) as TodoRow[];
  assert.equal(seededRows.length, 3);
  assert.equal(seededRows[0]?.id, 1);
  assert.equal(seededRows[0]?.done, 1);
  assert.deepEqual(
    seededRows.map((row) => typeof row.title),
    ['string', 'string', 'string'],
  );

  const createPayload = JSON.stringify({ title: 'added from the integration test' });
  const create = await dispatchToPort(
    PORT,
    new Request('http://x/api/todos', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(encoder.encode(createPayload).length),
      },
      body: createPayload,
    }),
  );
  assert.equal(create.status, 201);
  const created = (await create.json()) as TodoRow;
  assert.equal(created.title, 'added from the integration test');
  assert.equal(created.done, 0);
  assert.ok(created.id > 3);
  const afterCreate = (await (
    await dispatchToPort(PORT, new Request('http://x/api/todos'))
  ).json()) as TodoRow[];
  assert.equal(afterCreate.length, 4);

  const invalidPayload = JSON.stringify({ title: '   ' });
  const invalid = await dispatchToPort(
    PORT,
    new Request('http://x/api/todos', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(encoder.encode(invalidPayload).length),
      },
      body: invalidPayload,
    }),
  );
  assert.equal(invalid.status, 400);

  const patchPayload = JSON.stringify({ done: true });
  const patched = await dispatchToPort(
    PORT,
    new Request('http://x/api/todos/3', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'content-length': String(encoder.encode(patchPayload).length),
      },
      body: patchPayload,
    }),
  );
  assert.equal(patched.status, 200);
  const patchedRow = (await patched.json()) as TodoRow;
  assert.equal(patchedRow.id, 3);
  assert.equal(patchedRow.done, 1);
  const patchMissing = await dispatchToPort(
    PORT,
    new Request('http://x/api/todos/9999', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'content-length': String(encoder.encode(patchPayload).length),
      },
      body: patchPayload,
    }),
  );
  assert.equal(patchMissing.status, 404);

  const removed = await dispatchToPort(
    PORT,
    new Request('http://x/api/todos/2', { method: 'DELETE' }),
  );
  assert.equal(removed.status, 204);
  const afterDelete = (await (
    await dispatchToPort(PORT, new Request('http://x/api/todos'))
  ).json()) as TodoRow[];
  assert.equal(
    afterDelete.some((row) => row.id === 2),
    false,
  );
}

async function main(): Promise<void> {
  let primaryFailure: unknown;
  try {
    await runSmoke();
  } catch (error) {
    primaryFailure = error;
  }
  try {
    await cleanup();
  } catch (cleanupFailure) {
    if (primaryFailure !== undefined) {
      throw new AggregateError(
        [primaryFailure, cleanupFailure],
        'Fullstack smoke and cleanup failed',
      );
    }
    throw cleanupFailure;
  }
  if (primaryFailure !== undefined) throw primaryFailure;
}

const watchdog = hostSetTimeout(() => {
  hostStderr.write('Fullstack demo smoke timed out after 175000ms\n');
  hostExit(2);
}, 175_000);
watchdog.unref?.();

main().then(
  () => {
    hostClearTimeout(watchdog);
    hostStdout.write(`${MARKER}\n`, () => hostExit(0));
  },
  (error: unknown) => {
    hostClearTimeout(watchdog);
    hostStderr.write(`${error instanceof Error ? error.stack : String(error)}\n`, () =>
      hostExit(1),
    );
  },
);
