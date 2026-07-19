import { shadowAssetPlanFromLockfileBytes } from '@riftydev/npm-client';
import { openPlaygroundWorkbench } from '../../../apps/playground/src/browser-unit/workbench-playground-entry.ts';
import { workbenchViteHostAssets } from '../../../apps/playground/src/browser-unit/workbench-vite-host-assets.ts';

const PREVIEW_PORT = 43_146;
const PROJECTION_PREFIX = 'RIFTY_GUEST_PROCESS_PROJECTION:';

export interface GuestProcessProjection {
  readonly env: Readonly<Record<string, string>>;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly processOwnKeys: readonly string[];
  readonly processSpecKeys: readonly string[];
  readonly processSpecStdioKeys: readonly string[];
  readonly ambientCapabilityGlobalPresent: boolean;
  readonly ambientCapabilityKeys: readonly string[];
  readonly stdioSurfaceKeys: Readonly<{
    stdin: readonly string[];
    stdout: readonly string[];
    stderr: readonly string[];
  }>;
  readonly forkIpc: Readonly<{
    sendType: string;
    connected: boolean | null;
    messages: readonly string[];
  }>;
}

const GUEST_SOURCE = [
  "import http from 'node:http';",
  `const port = ${String(PREVIEW_PORT)};`,
  `const prefix = ${JSON.stringify(PROJECTION_PREFIX)};`,
  'const ownKeys = (value) =>',
  "  value !== null && (typeof value === 'object' || typeof value === 'function')",
  '    ? Reflect.ownKeys(value).map(String).sort()',
  '    : [];',
  "const processSpec = globalThis['__riftyProcessSpec__'];",
  "if (processSpec === null || typeof processSpec !== 'object') {",
  "  throw new Error('guest process spec was not published');",
  '}',
  "const capabilityGlobalKey = ['__riftyKernel', 'EntryCapability', 'Ports__'].join('');",
  'const ambientCapabilities = globalThis[capabilityGlobalKey];',
  'const forkIpcMessages = [];',
  "process.on('message', (message) => {",
  '  try {',
  '    forkIpcMessages.push(JSON.stringify(message));',
  '  } catch {',
  '    forkIpcMessages.push(String(message));',
  '  }',
  '});',
  'const projection = () => ({',
  '  env: Object.fromEntries(Object.entries(process.env).sort(([left], [right]) =>',
  '    left < right ? -1 : left > right ? 1 : 0,',
  '  )),',
  '  argv: process.argv.slice(),',
  '  cwd: process.cwd(),',
  '  processOwnKeys: ownKeys(process),',
  '  processSpecKeys: ownKeys(processSpec),',
  '  processSpecStdioKeys: ownKeys(processSpec.stdio),',
  '  ambientCapabilityGlobalPresent:',
  '    Object.getOwnPropertyNames(globalThis).includes(capabilityGlobalKey),',
  '  ambientCapabilityKeys: ownKeys(ambientCapabilities),',
  '  stdioSurfaceKeys: {',
  '    stdin: ownKeys(process.stdin),',
  '    stdout: ownKeys(process.stdout),',
  '    stderr: ownKeys(process.stderr),',
  '  },',
  '  forkIpc: {',
  '    sendType: typeof process.send,',
  "    connected: typeof process.connected === 'boolean' ? process.connected : null,",
  '    messages: forkIpcMessages.slice(),',
  '  },',
  '});',
  'console.log(prefix + JSON.stringify(projection()));',
  'const server = http.createServer((_request, response) => {',
  "  response.setHeader('content-type', 'application/json');",
  '  response.end(JSON.stringify(projection()));',
  '});',
  'server.listen(port);',
  '',
].join('\n');

function withTimeout<T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)),
      timeoutMs,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function projectionFromOutput(output: string): GuestProcessProjection {
  const start = output.indexOf(PROJECTION_PREFIX);
  if (start < 0) throw new Error(`guest projection is absent from stdout:\n${output}`);
  const jsonStart = start + PROJECTION_PREFIX.length;
  const lineEnd = output.indexOf('\n', jsonStart);
  const json = output.slice(jsonStart, lineEnd < 0 ? undefined : lineEnd).trim();
  return JSON.parse(json) as GuestProcessProjection;
}

/** One non-empty capability carried beside, never through, ordinary guest process channels. */
export async function runRuntimeAssetCapabilityNonProjection() {
  const ownerWorkerUrl = new URL(workbenchViteHostAssets.workers.owner, location.href);
  const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
  const baseElement = document.createElement('base');
  baseElement.dataset.runtimeAssetNonProjection = 'true';
  baseElement.href = ownerWorkerBaseUrl.href;
  document.head.prepend(baseElement);

  let workbench: Awaited<ReturnType<typeof openPlaygroundWorkbench>> | null = null;
  try {
    workbench = await withTimeout(
      openPlaygroundWorkbench({
        deployment: {
          workers: {
            ...workbenchViteHostAssets.workers,
            owner: ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length),
          },
          serviceWorker: { url: '/sw.js', scope: '/' },
          wasm: workbenchViteHostAssets.wasm,
          previewProbeTimeoutMs: 30_000,
        },
        packageAcquisition: { registryUrl: '/npm-registry' },
        storage: { persistence: 'ephemeral' },
      }),
      'non-projection Workbench open',
      120_000,
    );
    const definition = workbench.playground.define({
      kind: 'node-server',
      id: 'scratch',
      starterId: 'runtime-asset-capability-non-projection',
      templateId: 'runtime-asset-capability-non-projection-v1',
      files: {
        '/package.json':
          '{"name":"runtime-asset-capability-non-projection","private":true,"type":"module"}\n',
        '/server.mjs': GUEST_SOURCE,
      },
      dependencies: { esbuild: '0.28.0' },
      firstMaterialization: { kind: 'install' },
      entryPath: '/server.mjs',
      port: PREVIEW_PORT,
    });
    await withTimeout(
      workbench.playground.catalog.createScratch({ definition }),
      'non-projection Scratch creation',
      30_000,
    );
    const session = await withTimeout(
      workbench.openProject(definition),
      'non-projection project open',
      120_000,
    );

    try {
      const run = session.run();
      let output = '';
      const detach = run.terminal.attach((chunk) => {
        output += chunk;
      });
      try {
        const preview = await withTimeout(run.ready, 'non-projection preview ready', 240_000);
        const previewResponse = await withTimeout(
          fetch(preview.url, { cache: 'no-store' }),
          'non-projection preview response',
          30_000,
        );
        const previewBody = await withTimeout(
          previewResponse.text(),
          'non-projection preview body',
          30_000,
        );
        const previewProjection = JSON.parse(previewBody) as GuestProcessProjection;
        const stdoutProjection = projectionFromOutput(output);
        const lockfile = await withTimeout(
          session.files.readFile('/package-lock.json'),
          'non-projection lockfile read',
          30_000,
        );
        const requiredSetDigest = shadowAssetPlanFromLockfileBytes(
          lockfile.bytes,
        ).requiredSetDigest;
        const filesSnapshot = session.files.snapshot();
        const runtimeAssets = await workbench.runtimeAssets.inspect();
        const closeExit = await withTimeout(run.close(), 'non-projection run close', 60_000);
        const archive = await withTimeout(
          workbench.playground.forSession(session).archive.export(),
          'non-projection archive export',
          120_000,
        );

        return {
          stdoutProjection,
          previewProjection,
          output,
          previewStatus: previewResponse.status,
          previewBody,
          filesSnapshot,
          archive,
          requiredSetDigest,
          runtimeAssets,
          closeExit,
        };
      } finally {
        detach();
        await run.close().catch(() => {});
      }
    } finally {
      await session.close().catch(() => {});
    }
  } finally {
    await workbench?.close().catch(() => {});
    baseElement.remove();
  }
}
