import { type ToolchainSandbox, createSandbox } from '../../../packages/rifty/src/index.ts';

let sandbox: ToolchainSandbox;
let output = '';
let held = false;
let application: Promise<string> | undefined;
let applicationState = 'idle';

export async function boot(workerUrl: string, namespace = 'sdk-snapshot') {
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = new Proxy(NativeWorker, {
    construct(target, args: ConstructorParameters<typeof Worker>) {
      const worker = Reflect.construct(target, args) as Worker;
      worker.addEventListener('message', (event) => {
        if (event.data.type === 'snapshot-native-held') held = true;
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
  const toolchain = sandbox.toolchain as ToolchainSandbox['toolchain'] & {
    applySnapshot(input: { cwd: string; snapshot: typeof snapshot; force: boolean }): Promise<void>;
  };
  await toolchain.applySnapshot({ cwd: '/project', snapshot, force });
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
  const toolchain = sandbox.toolchain as ToolchainSandbox['toolchain'] & {
    open(input: { cwd: string; registryUrl?: string }): Promise<void>;
  };
  await toolchain.open({ cwd: '/project', ...(registryUrl === undefined ? {} : { registryUrl }) });
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
