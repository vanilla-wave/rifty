import { type ToolchainSandbox, createSandbox } from '../../../packages/rifty/src/index.ts';

let sandbox: ToolchainSandbox;
let worker: Worker;
let installRequests = 0;
let output = '';

export async function boot(workerUrl: string): Promise<{ openType: string; coi: boolean }> {
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = new Proxy(NativeWorker, {
    construct(target, args: ConstructorParameters<typeof Worker>) {
      worker = Reflect.construct(target, args) as Worker;
      const nativePost = worker.postMessage.bind(worker);
      worker.postMessage = (...posted: Parameters<Worker['postMessage']>) => {
        const message = posted[0] as { request?: { op?: string } };
        if (message.request?.op === 'install') installRequests++;
        return Reflect.apply(nativePost, worker, posted);
      };
      return worker;
    },
  });
  try {
    sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      toolchain: { workerUrl },
    });
  } finally {
    globalThis.Worker = NativeWorker;
  }
  while (!sandbox.runtime.isReady()) await new Promise((resolve) => setTimeout(resolve, 10));
  sandbox.runtime.on((event) => {
    if ((event.type === 'stdout' || event.type === 'stderr') && event.chunk) output += event.chunk;
  });
  return { openType: typeof Reflect.get(sandbox.toolchain, 'open'), coi: crossOriginIsolated };
}

export function write(path: string, text: string): Promise<void> {
  return sandbox.fs.writeFile(path, text);
}
export async function read(path: string): Promise<string | null> {
  try {
    return await sandbox.fs.readFile(path, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw error;
  }
}
export function install(cwd: string): Promise<void> {
  return sandbox.toolchain.install({ cwd, registryUrl: '/npm-registry' });
}
export async function open(cwd: string, registryUrl = '/npm-registry'): Promise<void> {
  const toolchain = sandbox.toolchain as ToolchainSandbox['toolchain'] & {
    open(input: { cwd: string; registryUrl: string }): Promise<void>;
  };
  await toolchain.open({ cwd, registryUrl });
}
export async function evaluate(source: string): Promise<string> {
  output = '';
  const result = await sandbox.runtime.eval(source);
  if (!result.ok) throw new Error(`warm-open eval rejected: ${JSON.stringify(result)}`);
  return output;
}
export async function build(cwd: string): Promise<{ exitCode: number; output: string }> {
  output = '';
  const result = await sandbox.toolchain.runBin({
    cwd,
    binPath: `${cwd}/node_modules/.bin/vite`,
    args: ['build'],
  });
  return { ...result, output };
}
export function counts(fault?: string): Promise<{
  writable: number;
  mkdir: number;
  remove: number;
  failures: number;
  installRequests: number;
}> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data.type !== 'warm-open-counts') return;
      worker.removeEventListener('message', listener);
      resolve({ ...event.data.counts, installRequests });
    };
    worker.addEventListener('message', listener);
    worker.postMessage({ type: 'warm-open-probe', ...(fault === undefined ? {} : { fault }) });
  });
}
export function dispose(): void {
  sandbox.dispose();
}
