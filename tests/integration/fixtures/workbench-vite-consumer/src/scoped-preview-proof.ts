import { SW_FRAME_VERSION, SW_PING, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';
import type { PreviewHandle, ProjectSession } from '@riftydev/workbench';
import {
  type PlaygroundWorkbenchOptions,
  openPlaygroundWorkbench,
} from '@riftydev/workbench/playground';

const prefix = '/sandbox/p/';
const opaqueQuery = 'opaque=a%20b~c&dup=one&dup=two&bare';
const asset = (name: string) => new URL(`/rifty/${name}`, location.href).href;
const indexHtml =
  '<div id="app">booting</div><div id="api"></div><div id="chunk"></div><img id="logo" src="/guest-image.svg"><link rel="stylesheet" href="/src/style.css"><script type="module" src="/src/main.ts"></script>';
const mainSource = `
import { message } from './message.ts'
const render = (value) => { document.querySelector('#app').textContent = value }
render(message)
if (import.meta.hot) import.meta.hot.accept('./message.ts', (module) => render(module.message))
fetch('/api/collision.txt').then(response => response.text()).then(text => { document.querySelector('#api').textContent = text })
import('./chunk.ts').then(module => { document.querySelector('#chunk').textContent = module.chunk })
`;

interface Snapshot {
  readonly packageJsonText: string;
  readonly snapshotId: string;
  readonly templateId: string;
}
interface ControllerProof {
  readonly scriptURL: string;
  readonly scope: string;
  readonly previewPrefix: string;
  readonly frameVersion: string;
  readonly routingVersion: string;
}
export interface ScopedPreviewAcceptance {
  readonly previewUrl: string;
  readonly buildOutput: string;
  readonly storage: unknown;
  writeMessage(message: string): Promise<void>;
  controlProof(): Promise<ControllerProof>;
  close(): Promise<void>;
}
declare global {
  interface Window {
    __RIFTY_PACKED_SCOPED_PREVIEW__: Promise<ScopedPreviewAcceptance>;
  }
}

async function controlProof(): Promise<ControllerProof> {
  const controller = navigator.serviceWorker.controller;
  if (controller === null) throw new Error('Scoped host has no service-worker controller');
  const registration = await navigator.serviceWorker.getRegistration(location.href);
  if (registration === undefined) throw new Error('Scoped host has no service-worker registration');
  const expectedScript = new URL(
    `/sandbox/sw.js?${opaqueQuery}&__rifty_preview_prefix=${encodeURIComponent(prefix)}`,
    location.href,
  ).href;
  if (controller.scriptURL !== expectedScript)
    throw new Error(`Scoped SW query/config mismatch: ${controller.scriptURL}`);
  const pong = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error('Scoped controller PONG timed out'));
    }, 10_000);
    channel.port1.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    controller.postMessage(
      { type: SW_PING, frameVersion: SW_FRAME_VERSION, routingVersion: SW_ROUTING_VERSION },
      [channel.port2],
    );
  });
  if (
    navigator.serviceWorker.controller !== controller ||
    pong.type !== SW_PONG ||
    pong.from !== 'service-worker' ||
    pong.frameVersion !== SW_FRAME_VERSION ||
    pong.routingVersion !== SW_ROUTING_VERSION ||
    pong.previewPrefix !== prefix
  )
    throw new Error(
      `Scoped controller did not prove its actual configuration: ${JSON.stringify(pong)}`,
    );
  return {
    scriptURL: controller.scriptURL,
    scope: registration.scope,
    previewPrefix: prefix,
    frameVersion: SW_FRAME_VERSION,
    routingVersion: SW_ROUTING_VERSION,
  };
}

async function build(project: ProjectSession<PreviewHandle>): Promise<string> {
  const terminal = project.terminals.open();
  let output = '';
  const detach = terminal.attach((chunk) => {
    output += chunk;
  });
  const run = terminal.run('npm run build');
  try {
    const exit = await run.exited;
    const closed = await run.close();
    if (
      exit.code !== 0 ||
      exit.signal !== null ||
      closed.code !== exit.code ||
      closed.signal !== exit.signal
    )
      throw new Error(`Scoped real Vite build failed: ${JSON.stringify({ exit, closed, output })}`);
    const html = new TextDecoder().decode((await project.files.readFile('/dist/index.html')).bytes);
    if (!html.includes('/assets/') || html.includes('/src/main.ts'))
      throw new Error(`Scoped build did not bundle guest assets: ${html}`);
    return output;
  } finally {
    await run.close();
    detach();
    await terminal.close();
  }
}

async function openScopedPreview(): Promise<ScopedPreviewAcceptance> {
  const metadata = await fetch('/producer-vite-snapshot.json');
  if (!metadata.ok) throw new Error(`Scoped producer metadata HTTP ${metadata.status}`);
  const snapshot = (await metadata.json()) as Snapshot;
  const options: PlaygroundWorkbenchOptions = {
    deployment: {
      workers: {
        owner: asset('owner-worker.js'),
        kernel: asset('kernel-worker.js'),
        node: asset('node-worker.js'),
        devServer: asset('dev-server-worker.js'),
        typescript: asset('typescript-worker.js'),
      },
      serviceWorker: {
        url: new URL(`/sandbox/sw.js?${opaqueQuery}`, location.href).href,
        scope: '/sandbox/',
      },
      wasm: { sqlite: asset('sql-wasm.wasm') },
      previewPrefix: prefix,
      previewProbeTimeoutMs: 30_000,
    },
    packageAcquisition: { mode: 'snapshot-only' },
    storage: { persistence: 'required', namespace: 'packed-scoped-preview' },
  };
  const workbench = await openPlaygroundWorkbench(options);
  let project: ProjectSession<PreviewHandle> | undefined;
  let run: ReturnType<ProjectSession<PreviewHandle>['run']> | undefined;
  try {
    await controlProof();
    const definition = workbench.playground.define({
      kind: 'npm-dev-server',
      id: 'scratch',
      starterId: snapshot.templateId,
      templateId: snapshot.templateId,
      files: {
        '/package.json': snapshot.packageJsonText,
        '/index.html': indexHtml,
        '/src/main.ts': mainSource,
        '/src/message.ts': 'export const message = "scoped-vite-ready";\n',
        '/src/chunk.ts': 'export const chunk = "guest dynamic chunk";\n',
        '/src/style.css': '#app { color: rgb(12, 34, 56); }\n',
        '/public/guest-image.svg':
          '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="5"><rect width="7" height="5" fill="green"/></svg>',
        '/public/api/collision.txt': 'guest root API\n',
        '/public/host-file.txt': 'guest static file\n',
      },
      firstMaterialization: {
        kind: 'snapshot',
        snapshot: {
          snapshotId: snapshot.snapshotId,
          templateId: snapshot.templateId,
          assetUrl: new URL('/producer-vite-snapshot.tar.gz', location.href).href,
        },
      },
    });
    await workbench.playground.catalog.createScratch({
      definition,
      preserveDirtySameStarter: true,
    });
    project = await workbench.openProject(definition);
    const buildOutput = await build(project);
    for (const [path, expected] of [
      ['/index.html', indexHtml],
      ['/src/main.ts', mainSource],
    ] as const) {
      const actual = new TextDecoder().decode((await project.files.readFile(path)).bytes);
      if (actual !== expected) throw new Error(`Host prefix rewrote guest source ${path}`);
    }
    run = project.run();
    const preview = await run.ready;
    const pathname = new URL(preview.url).pathname;
    if (!/^\/sandbox\/p\/\d+\/$/.test(pathname))
      throw new Error(`Wrong public scoped preview URL: ${preview.url}`);
    const session = project;
    const activeRun = run;
    return {
      previewUrl: preview.url,
      buildOutput,
      storage: workbench.snapshot().storage,
      controlProof,
      async writeMessage(message) {
        const before = await session.files.readFile('/src/message.ts');
        await session.files.writeFile(
          '/src/message.ts',
          new TextEncoder().encode(`export const message = ${JSON.stringify(message)};\n`),
          { expectedVersion: before.version },
        );
        await workbench.playground.forSession(session).awaitDurability();
      },
      async close() {
        await activeRun.close();
        await session.close();
        await workbench.close();
      },
    };
  } catch (error) {
    await run?.close();
    await project?.close();
    await workbench.close();
    throw error;
  }
}

window.__RIFTY_PACKED_SCOPED_PREVIEW__ = openScopedPreview().then((proof) => {
  const frame = document.querySelector<HTMLIFrameElement>('#preview');
  const status = document.querySelector('#status');
  if (frame === null || status === null) throw new Error('Scoped host DOM is incomplete');
  frame.src = proof.previewUrl;
  status.textContent = 'scoped Workbench ready';
  return proof;
});
