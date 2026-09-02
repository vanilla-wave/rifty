import assert from 'node:assert/strict';
import '../../../packages/net/src/register-builtins.ts';
import { dispatchToPort, listPorts, unregisterPort } from '../../../packages/net/src/index.ts';
import {
  type InstallResult,
  RegistryClient,
  install,
} from '../../../packages/npm-client/src/index.ts';
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
const MARKER = 'RIFTY_EXPRESS_LIVE_SMOKE_OK';

interface ExpressResponse {
  json(value: unknown): void;
  send(body: string): void;
}

interface ExpressApplication {
  get(path: string, handler: (request: unknown, response: ExpressResponse) => void): void;
  post(
    path: string,
    handler: (request: { body: unknown }, response: ExpressResponse) => void,
  ): void;
  use(middleware: unknown): void;
  listen(port: number): { close(callback?: () => void): void };
}

interface ExpressFactory {
  (): ExpressApplication;
  json(): unknown;
}

const servers: Array<{ close(callback?: () => void): void }> = [];

function hostDelay(ms: number): Promise<void> {
  return new Promise((resolve) => hostSetTimeout(resolve, ms));
}

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!listPorts().includes(port)) {
    if (Date.now() >= deadline) throw new Error(`Express did not listen on port ${port}`);
    await hostDelay(10);
  }
}

async function listen(app: ExpressApplication, port: number): Promise<void> {
  servers.push(app.listen(port));
  await waitForPort(port);
}

async function closeServers(): Promise<void> {
  const failures: unknown[] = [];
  for (const server of [...servers].reverse()) {
    try {
      await new Promise<void>((resolve, reject) => {
        try {
          server.close(resolve);
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Express server cleanup failed');
}

async function cleanup(): Promise<void> {
  let closeFailure: unknown;
  try {
    await closeServers();
  } catch (error) {
    closeFailure = error;
  }
  for (const port of listPorts()) unregisterPort(port);
  await hostDelay(100);
  (globalThis as { Buffer?: unknown }).Buffer = hostBuffer;
  assert.deepEqual(listPorts(), [], 'registered Express ports survived child cleanup');
  if (closeFailure !== undefined) throw closeFailure;
}

async function runSmoke(): Promise<void> {
  const registryUrl = hostEnv.RIFTY_LIVE_REGISTRY;
  assert.ok(registryUrl, 'RIFTY_LIVE_REGISTRY is required');

  const { vfs, fsSync } = createMemoryFs();
  const registry = new RegistryClient({ baseUrl: registryUrl, fetch: globalThis.fetch });
  const installResult: InstallResult = await install(
    'rifty-express-run',
    '0.0.0',
    { express: '^4' },
    { vfs, cwd: '/app', registry },
  );

  setSyncMirror(fsSync, { async: vfs });
  installProcessGlobals();
  installTimerGlobals();
  (globalThis as { Buffer: unknown }).Buffer = RiftyBuffer;
  setProcessCwd('/app');

  const loader = createModuleLoader(fsSync, { cwd: '/app' });
  const express = loader.require('express', '/app/__entry.js') as ExpressFactory;

  assert.ok(installResult.packages.length > 20, 'Express dependency graph was unexpectedly small');
  assert.equal(typeof express, 'function');

  const rootPort = 3210;
  const rootApp = express();
  rootApp.get('/', (_request, response) => response.send('Hello from real Express'));
  await listen(rootApp, rootPort);
  const root = await dispatchToPort(rootPort, new Request('http://x/'));
  assert.equal(root.status, 200);
  assert.equal(await root.text(), 'Hello from real Express');

  const apiPort = 3211;
  const apiApp = express();
  apiApp.get('/api', (_request, response) => response.json({ ok: true, n: 42 }));
  await listen(apiApp, apiPort);
  const api = await dispatchToPort(apiPort, new Request('http://x/api'));
  assert.equal(api.status, 200);
  assert.match(api.headers.get('content-type') ?? '', /application\/json/u);
  assert.deepEqual(await api.json(), { ok: true, n: 42 });

  const echoPort = 3212;
  const echoApp = express();
  echoApp.use(express.json());
  echoApp.post('/echo', (request, response) => response.json({ got: request.body }));
  await listen(echoApp, echoPort);
  const payload = JSON.stringify({ a: 1 });
  const echo = await dispatchToPort(
    echoPort,
    new Request('http://x/echo', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(new TextEncoder().encode(payload).length),
      },
      body: payload,
    }),
  );
  assert.equal(echo.status, 200);
  assert.deepEqual(await echo.json(), { got: { a: 1 } });

  const missingPort = 3213;
  const missingApp = express();
  missingApp.get('/', (_request, response) => response.send('root'));
  await listen(missingApp, missingPort);
  const missing = await dispatchToPort(missingPort, new Request('http://x/missing'));
  assert.equal(missing.status, 404);
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
        'Express smoke and cleanup failed',
      );
    }
    throw cleanupFailure;
  }
  if (primaryFailure !== undefined) throw primaryFailure;
}

const watchdog = hostSetTimeout(() => {
  hostStderr.write('Express live smoke timed out after 175000ms\n');
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
