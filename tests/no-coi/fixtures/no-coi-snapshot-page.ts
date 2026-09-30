import * as sdk from '../../../packages/rifty/src/index.ts';
import { type ToolchainSandbox, createSandbox } from '../../../packages/rifty/src/index.ts';

let sandbox: ToolchainSandbox;
let output = '';
const progress: unknown[] = [];
const nativeFlushes: unknown[] = [];
let observedWorker: Worker;
let releasedProgress = 0;
let held = false;
let application: Promise<string> | undefined;
let applicationState = 'idle';

export async function boot(workerUrl: string, namespace = 'sdk-snapshot') {
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = new Proxy(NativeWorker, {
    construct(target, args: ConstructorParameters<typeof Worker>) {
      const worker = Reflect.construct(target, args) as Worker;
      observedWorker = worker;
      worker.addEventListener('message', (event) => {
        if (event.data.type === 'snapshot-native-held') held = true;
        if (event.data.type === 'native-flush-receipt') nativeFlushes.push(event.data);
        if (event.data.type === 'fixture-late-progress-released')
          releasedProgress = event.data.count;
      });
      return worker;
    },
  });
  try {
    sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      storage: { namespace, persistence: 'required' },
      startupTimeoutMs: 30_000,
      toolchain: { workerUrl },
    });
  } finally {
    globalThis.Worker = NativeWorker;
  }
  sandbox.runtime.on((event) => {
    if (event.type === ('progress' as string)) progress.push(event);
    if (event.type === 'stdout' || event.type === 'stderr') output += event.chunk;
  });
  return {
    coi: crossOriginIsolated,
    applyType: typeof Reflect.get(sandbox.toolchain, 'applySnapshot'),
  };
}

export async function apply(
  snapshot: { assetUrl: string; snapshotId: string; templateId: string },
  force = false,
) {
  await sandbox.toolchain.applySnapshot({ cwd: '/project', snapshot, force });
}
export function beginApply(snapshot: { assetUrl: string; snapshotId: string; templateId: string }) {
  applicationState = 'pending';
  application = apply(snapshot).then(
    () => {
      applicationState = 'succeeded';
      return applicationState;
    },
    (error) => {
      applicationState = `failed:${error.message}`;
      return applicationState;
    },
  );
}
export function state() {
  return { held, applicationState };
}
export async function applied() {
  return application;
}
export async function open(registryUrl?: string) {
  await sandbox.toolchain.open({
    cwd: '/project',
    ...(registryUrl === undefined ? {} : { registryUrl }),
  });
}
export function write(path: string, value: string) {
  return sandbox.fs.writeFile(path, value);
}
export function read(path: string) {
  return sandbox.fs.readFile(path, 'utf8');
}
export async function evaluate(source: string) {
  output = '';
  const result = await sandbox.runtime.eval(source);
  return { result, output };
}
export function dispose() {
  sandbox.dispose();
}

export async function startLocalServer() {
  const binPath = '/project/node_modules/.bin/local-server';
  await sandbox.fs.writeFile(
    '/project/node_modules/local-server/package.json',
    '{"name":"local-server","type":"commonjs"}',
  );
  await sandbox.fs.writeFile(
    '/project/node_modules/local-server/cli.js',
    "require('node:http').createServer((req,res)=>res.end('ready')).listen(5188);",
  );
  await sandbox.fs.writeFile(binPath, "#!/usr/bin/env node\nimport('../local-server/cli.js');\n");
  return sandbox.toolchain.startBin({ cwd: '/project', binPath, args: [], port: 5188 });
}

export function takeProgress() {
  return progress.splice(0);
}
export async function applyOutcome(snapshot: Parameters<typeof apply>[0], force = false) {
  return apply(snapshot, force).then(
    () => ({ kind: 'success' }),
    (error: Error) => ({
      kind: Reflect.get(sdk, 'sandboxErrorKind')?.(error),
      name: error.name,
      message: error.message,
    }),
  );
}
export async function nativePayloadEntries() {
  const { nativeReplicaEntries } = await import(
    '../../browser-unit/fixtures/native-replica-observer.ts'
  );
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('sdk-snapshot');
  return [...(await nativeReplicaEntries(root)).values()]
    .filter((entry) => entry.path.startsWith('/project/'))
    .map((entry) => entry.path);
}

export function takeNativeFlushes() {
  return nativeFlushes.splice(0);
}
export function restart() {
  return sandbox.restart({ preview: { src: '' } });
}

export function releaseLateProgress() {
  observedWorker.postMessage({ type: 'fixture-release-late-progress' });
}
export function releasedProgressCount() {
  return releasedProgress;
}
