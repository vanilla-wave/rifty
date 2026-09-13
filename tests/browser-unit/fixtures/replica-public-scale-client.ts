import type { ProjectSession, ProjectTerminal } from '../../../packages/workbench/src/index.ts';
import {
  type PlaygroundWorkbench,
  openPlaygroundWorkbench,
} from '../../../packages/workbench/src/workbench/playground.ts';
import { program, verifyInstalled, verifyTree } from './replica-public-scale-program.ts';
export interface ScaleMetrics {
  readonly flushes: number[];
  readonly writes: number;
}
export interface ScaleOpening {
  readonly metrics: ScaleMetrics;
  readonly bootMs: number;
  readonly openMs: number;
  readonly readyMs: number;
}
export interface PublicScaleProof {
  open(first: boolean): Promise<ScaleOpening>;
  measure(op: 'reset' | 'get' | 'close'): Promise<ScaleMetrics>;
  run(line: string): Promise<{ exit: number; out: string }>;
  edit(): Promise<void>;
  close(): Promise<void>;
}
let state:
  | { workbench: PlaygroundWorkbench; project: ProjectSession<unknown>; terminal: ProjectTerminal }
  | undefined;
const channel = new BroadcastChannel('replica-public-scale-measure');
let requestId = 0;
function measure(op: 'reset' | 'get' | 'close'): Promise<ScaleMetrics> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.removeEventListener('message', receive);
      reject(new Error('Owner measurement timed out'));
    }, 30000);
    const receive = (e: MessageEvent<ScaleMetrics & { id: number }>) => {
      if (e.data.id !== id) return;
      clearTimeout(timer);
      channel.removeEventListener('message', receive);
      resolve(e.data);
    };
    channel.addEventListener('message', receive);
    channel.postMessage({ op, id });
  });
}
const proof: PublicScaleProof = {
  measure,
  async open(first) {
    const meta = (await (await fetch('/meta.json')).json()) as {
      snapshotId: string;
      templateId: string;
      packageJsonText: string;
      installedManifest: string;
    };
    const start = performance.now();
    const url = (name: string) => new URL(`/assets/${name}`, location.href).href;
    const workbench = await openPlaygroundWorkbench({
      deployment: {
        workers: {
          owner: url('owner-measured.js'),
          kernel: url('kernel-worker.js'),
          node: url('node-worker.js'),
          devServer: url('dev-server-worker.js'),
          typescript: url('typescript-worker.js'),
        },
        serviceWorker: { url: url('sw.js'), scope: '/' },
        wasm: { sqlite: url('sql-wasm.wasm') },
      },
      packageAcquisition: { registryUrl: new URL('/registry', location.href).href },
      storage: { persistence: 'required', namespace: 'replica-public-scale' },
    });
    const bootMs = performance.now() - start;
    const definition = workbench.playground.define({
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'replica-public-scale',
      templateId: meta.templateId,
      files: {
        '/package.json': meta.packageJsonText,
        '/note.txt': 'initial',
        '/main.cjs': program,
        '/verify.cjs': verifyTree,
        '/verify-installed.cjs': verifyInstalled,
        '/installed-manifest.json': meta.installedManifest,
      },
      firstMaterialization: {
        kind: 'snapshot',
        snapshot: {
          snapshotId: meta.snapshotId,
          templateId: meta.templateId,
          assetUrl: new URL('/snapshot.tar.gz', location.href).href,
        },
      },
      entryPath: '/main.cjs',
    });
    await measure('reset');
    const openStart = performance.now();
    if (first) await workbench.playground.catalog.createScratch({ definition });
    const project = await workbench.openProject(definition);
    state = { workbench, project, terminal: project.terminals.open() };
    const openMs = performance.now() - openStart;
    const readyMs = performance.now() - start;
    return { metrics: await measure('get'), bootMs, openMs, readyMs };
  },
  async run(line) {
    if (!state) throw Error('Not open');
    let out = '';
    const detach = state.terminal.attach((c) => {
      out += c;
    });
    try {
      const run = state.terminal.run(line);
      const exit = await run.exitCode;
      await run.close();
      return { exit, out };
    } finally {
      detach();
    }
  },
  async edit() {
    if (!state) throw Error('Not open');
    const file = await state.project.files.readFile('/note.txt');
    await state.project.files.writeFile('/note.txt', new TextEncoder().encode('edited'), {
      expectedVersion: file.version,
    });
    await state.workbench.playground.forSession(state.project).awaitDurability();
  },
  async close() {
    if (!state) return;
    await state.terminal.close();
    await state.project.close();
    await measure('close');
    await state.workbench.close();
    channel.close();
    state = undefined;
  },
};
Object.assign(globalThis, { replicaPublicProof: proof });
