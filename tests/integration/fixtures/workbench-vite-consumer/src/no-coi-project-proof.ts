import { type ToolchainSandbox, createSandbox } from '@riftydev/sdk';

interface Snapshot {
  readonly assetUrl: string;
  readonly snapshotId: string;
  readonly templateId: string;
}
type SnapshotToolchain = ToolchainSandbox['toolchain'] & {
  applySnapshot(input: { cwd: string; snapshot: Snapshot; force?: boolean }): Promise<void>;
  open(input: { cwd: string }): Promise<void>;
};
let sandbox: ToolchainSandbox;
let output = '';
let held = false;
let applyState = 'idle';

const api = {
  async boot(workerUrl: string, namespace: string, fault?: 'hold' | 'quota') {
    const selectedUrl = fault
      ? URL.createObjectURL(
          new Blob(
            [
              `
      const writable = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = function(...args) {
        if (this.name === 'esbuild.wasm') {
          if (${JSON.stringify(fault)} === 'quota') return Promise.reject(new DOMException('packed snapshot quota', 'QuotaExceededError'));
          self.postMessage({type:'snapshot-native-held'});
          return new Promise(() => {});
        }
        return Reflect.apply(writable, this, args);
      };
      await import(${JSON.stringify(workerUrl)});
    `,
            ],
            { type: 'text/javascript' },
          ),
        )
      : workerUrl;
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
        startupTimeoutMs: 60_000,
        toolchain: { workerUrl: selectedUrl },
      });
    } finally {
      globalThis.Worker = NativeWorker;
    }
    sandbox.runtime.on((event) => {
      if (event.type === 'stdout' || event.type === 'stderr') output += event.chunk;
    });
    return { coi: crossOriginIsolated, backend: sandbox.vfs.backend };
  },
  async seed() {
    for (const [path, content] of Object.entries({
      '/index.html': '<!doctype html><script type="module" src="/main.js"></script>',
      '/main.js': 'document.body.textContent = "packed-sdk-initial";',
      '/local.cjs': 'console.log("packed-sdk-independent-source");',
      '/vite.config.js': 'export default { build: { minify: false, sourcemap: false } };',
    }))
      await sandbox.fs.writeFile(`/project${path}`, content);
  },
  apply(snapshot: Snapshot, force = false) {
    return (sandbox.toolchain as SnapshotToolchain).applySnapshot({
      cwd: '/project',
      snapshot,
      force,
    });
  },
  beginApply(snapshot: Snapshot) {
    applyState = 'pending';
    void api.apply(snapshot).then(
      () => {
        applyState = 'succeeded';
      },
      (error) => {
        applyState = `failed:${error.message}`;
      },
    );
  },
  state: () => ({ held, applyState }),
  open: () => (sandbox.toolchain as SnapshotToolchain).open({ cwd: '/project' }),
  write: (path: string, content: string) => sandbox.fs.writeFile(`/project${path}`, content),
  read: (path: string) => sandbox.fs.readFile(`/project${path}`, 'utf8'),
  async evaluate(source: string) {
    output = '';
    const result = await sandbox.runtime.eval(source);
    return { result, output };
  },
  async build() {
    output = '';
    const result = await sandbox.toolchain.runBin({
      cwd: '/project',
      binPath: '/project/node_modules/.bin/vite',
      args: ['build'],
    });
    const html = await api.read('/dist/index.html');
    const asset = html.match(/src="([^"]+\.js)"/u)?.[1];
    if (!asset) throw new Error(`Vite emitted no JS asset: ${html}`);
    return { ...result, output, html, js: await api.read(`/dist${asset}`) };
  },
  dispose: () => sandbox.dispose(),
};
Reflect.set(globalThis, 'packedSdkProject', api);
