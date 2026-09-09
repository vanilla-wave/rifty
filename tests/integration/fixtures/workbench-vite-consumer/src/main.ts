import { createSandbox } from '@riftydev/sdk';
import type { PreviewHandle } from '@riftydev/workbench';
import { openPlaygroundWorkbench } from '@riftydev/workbench/playground';
import { PACKED_HOST_COMPOSITION } from './packed-host-composition';

export interface PackedWorkbenchAcceptance {
  readonly previewUrl: string;
  readonly sqliteProof: string;
  readonly companionLoaded: boolean;
  readonly sdkLoaded: boolean;
  readonly orphanDownloaded: string;
  readonly noCoiToolchainWorkerUrl: string;
  readonly typescriptWorkerUrl: string;
  readonly hostWasm: {
    readonly quickjs: string;
    readonly sqlite: string;
  };
  writeMessage(message: string): Promise<void>;
  close(): Promise<void>;
}

interface PackedWorkbenchDiagnostics {
  stage: string;
  terminalOutput: string;
  sqliteOutput: string;
}

interface PackedHostSnapshotManifest {
  readonly snapshotId: string;
  readonly assetUrl: string;
  readonly templateId: string;
  readonly packageJsonText: string;
}

declare global {
  interface Window {
    __RIFTY_PACKED_WORKBENCH__: Promise<PackedWorkbenchAcceptance>;
    __RIFTY_PACKED_WORKBENCH_DIAGNOSTICS__: PackedWorkbenchDiagnostics;
  }
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Packed Workbench acceptance document is missing ${selector}`);
  }
  return element;
}

const ownerWorkerUrl = `${import.meta.env.BASE_URL}runtime/owner-worker.js`;
const kernelWorkerUrl = `${import.meta.env.BASE_URL}runtime/kernel-worker.js`;
const nodeWorkerUrl = `${import.meta.env.BASE_URL}runtime/node-worker.js`;
const devServerWorkerUrl = `${import.meta.env.BASE_URL}runtime/dev-server-worker.js`;
const typescriptWorkerUrl = `${import.meta.env.BASE_URL}runtime/typescript-worker.js`;
const noCoiToolchainWorkerUrl = `${import.meta.env.BASE_URL}runtime/no-coi-toolchain-worker.js`;
const serviceWorkerUrl = `${import.meta.env.BASE_URL}runtime/sw.js`;
const sqliteWasmUrl = `${import.meta.env.BASE_URL}runtime/sqlite.wasm`;
const quickjsWasmUrl = `${import.meta.env.BASE_URL}runtime/quickjs.wasm`;

const status = requiredElement<HTMLParagraphElement>('#status');
const previewLink = requiredElement<HTMLAnchorElement>('#preview-link');
const previewFrame = requiredElement<HTMLIFrameElement>('#preview');
const diagnostics: PackedWorkbenchDiagnostics = {
  stage: 'opening Workbench',
  terminalOutput: '',
  sqliteOutput: '',
};
window.__RIFTY_PACKED_WORKBENCH_DIAGNOSTICS__ = diagnostics;

const projectMain = `
import { message } from './message.ts'

const render = (value) => {
  document.querySelector('#app').textContent = value
}

render(message)
if (import.meta.hot) {
  import.meta.hot.accept('./message.ts', (module) => render(module.message))
}
`;

const sqliteProofSource = `
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE proof (answer INTEGER); INSERT INTO proof VALUES (42)')
const row = db.prepare('SELECT answer FROM proof').get()
console.log('packed-sqlite-' + row.answer)
db.close()
`;

async function loadPackedHostSnapshot(): Promise<PackedHostSnapshotManifest> {
  const response = await fetch(new URL('snapshots/manifest.json', document.baseURI));
  if (!response.ok) {
    throw new Error(`Packed host snapshot manifest ${response.status}`);
  }
  const manifest = (await response.json()) as PackedHostSnapshotManifest;
  if (
    typeof manifest.snapshotId !== 'string' ||
    typeof manifest.assetUrl !== 'string' ||
    typeof manifest.templateId !== 'string' ||
    typeof manifest.packageJsonText !== 'string'
  ) {
    throw new Error('Packed host snapshot manifest is incomplete');
  }
  return manifest;
}

async function plantPackedHostOrphan(): Promise<void> {
  const encoder = new TextEncoder();
  const origin = await navigator.storage.getDirectory();
  const namespaced = await origin.getDirectoryHandle(PACKED_HOST_COMPOSITION.namespace, {
    create: true,
  });
  let tree = namespaced;
  for (const segment of ['.rifty', 'workbench', 'v1', 'projects', 'scratch', 'tree']) {
    tree = await tree.getDirectoryHandle(segment, { create: true });
  }
  const file = await tree.getFileHandle('user.txt', { create: true });
  const writer = await file.createWritable();
  await writer.write(encoder.encode('orphan bytes'));
  await writer.close();
}

async function openAcceptance(): Promise<PackedWorkbenchAcceptance> {
  diagnostics.stage = 'planting orphan Scratch';
  await plantPackedHostOrphan();
  diagnostics.stage = 'loading produced snapshot manifest';
  const snapshot = await loadPackedHostSnapshot();
  diagnostics.stage = 'opening Playground Workbench';
  const workbench = await openPlaygroundWorkbench({
    deployment: {
      workers: {
        owner: ownerWorkerUrl,
        kernel: kernelWorkerUrl,
        node: nodeWorkerUrl,
        devServer: devServerWorkerUrl,
        typescript: typescriptWorkerUrl,
      },
      serviceWorker: { url: serviceWorkerUrl, scope: PACKED_HOST_COMPOSITION.scope },
      wasm: { sqlite: sqliteWasmUrl },
      previewProbeTimeoutMs: 30_000,
      previewPrefix: PACKED_HOST_COMPOSITION.previewPrefix,
      ownerStartupTimeoutMs: PACKED_HOST_COMPOSITION.ownerStartupTimeoutMs,
      projectFileTimeoutMs: PACKED_HOST_COMPOSITION.projectFileTimeoutMs,
      sessionToolsTimeoutMs: PACKED_HOST_COMPOSITION.sessionToolsTimeoutMs,
    },
    packageAcquisition: {},
    storage: {
      persistence: 'required',
      namespace: PACKED_HOST_COMPOSITION.namespace,
    },
  });
  diagnostics.stage = 'defining snapshot project';
  const definition = workbench.playground.define({
    kind: 'vite',
    id: 'scratch',
    starterId: 'packed-host',
    templateId: snapshot.templateId,
    files: {
      '/package.json': snapshot.packageJsonText,
      '/index.html':
        '<div id="app">booting</div><script type="module" src="/src/main.ts"></script>',
      '/src/main.ts': projectMain,
      '/src/message.ts': 'export const message = "packed-consumer-ready";\n',
      '/sqlite-proof.cjs': sqliteProofSource,
    },
    port: 5173,
    firstMaterialization: {
      kind: 'snapshot',
      snapshot: {
        snapshotId: snapshot.snapshotId,
        assetUrl: snapshot.assetUrl,
        templateId: snapshot.templateId,
      },
    },
  });
  diagnostics.stage = 'retaining planted orphan';
  await workbench.playground.catalog.createScratch({ definition });
  const orphans = await workbench.playground.catalog.listRetainedOrphans();
  const orphanId = orphans[0]?.id;
  if (orphanId === undefined) {
    throw new Error('Packed host did not retain planted orphan Scratch');
  }
  const orphanDownloaded = new TextDecoder('utf-8', { fatal: true }).decode(
    await workbench.playground.catalog.readRetainedOrphanFile(orphanId, 'user.txt'),
  );
  if (orphanDownloaded !== 'orphan bytes') {
    throw new Error(`Packed host orphan download drifted: ${JSON.stringify(orphanDownloaded)}`);
  }
  diagnostics.stage = 'opening project';
  const project = await workbench.openProject(definition);
  diagnostics.stage = 'starting project';
  const run = project.run();
  let terminalOutput = '';
  const detachTerminal = run.terminal.attach((chunk, stream) => {
    terminalOutput += `[${stream}] ${chunk}`;
    diagnostics.terminalOutput = terminalOutput;
  });
  diagnostics.stage = 'waiting for preview';
  let preview: PreviewHandle;
  try {
    preview = await run.ready;
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${terminalOutput}`.trim(),
      { cause: error },
    );
  } finally {
    detachTerminal();
  }

  diagnostics.stage = 'running sqlite proof';
  const sqliteTerminal = project.terminals.open();
  let sqliteOutput = '';
  const detachSqlite = sqliteTerminal.attach((chunk) => {
    sqliteOutput += chunk;
    diagnostics.sqliteOutput = sqliteOutput;
  });
  try {
    const sqliteRun = sqliteTerminal.run('node sqlite-proof.cjs');
    diagnostics.stage = 'waiting for sqlite exit';
    const exited = await sqliteRun.exited;
    diagnostics.stage = 'closing sqlite run';
    const closed = await sqliteRun.close();
    diagnostics.stage = 'validating sqlite proof';
    if (
      exited.code !== 0 ||
      exited.signal !== null ||
      closed.code !== exited.code ||
      closed.signal !== exited.signal ||
      !sqliteOutput.includes('packed-sqlite-42')
    ) {
      throw new Error(
        `Packed Workbench sqlite proof failed: ${JSON.stringify({ exited, closed, sqliteOutput })}`,
      );
    }
  } finally {
    detachSqlite();
    await sqliteTerminal.close();
  }

  status.textContent = 'ready';
  diagnostics.stage = 'ready';
  previewLink.href = preview.url;
  previewLink.textContent = preview.url;
  previewFrame.src = preview.url;

  return Object.freeze({
    previewUrl: preview.url,
    sqliteProof: sqliteOutput,
    companionLoaded: typeof openPlaygroundWorkbench === 'function',
    sdkLoaded: typeof createSandbox === 'function',
    orphanDownloaded,
    noCoiToolchainWorkerUrl,
    typescriptWorkerUrl,
    hostWasm: Object.freeze({ quickjs: quickjsWasmUrl, sqlite: sqliteWasmUrl }),
    async writeMessage(message: string): Promise<void> {
      const current = await project.files.readFile('/src/message.ts');
      await project.files.writeFile(
        '/src/message.ts',
        new TextEncoder().encode(`export const message = ${JSON.stringify(message)};\n`),
        { expectedVersion: current.version },
      );
    },
    async close(): Promise<void> {
      await run.close();
      await project.close();
      await workbench.close();
    },
  });
}

const acceptance = openAcceptance().catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : String(error);
  throw error;
});
void acceptance.catch(() => {});
window.__RIFTY_PACKED_WORKBENCH__ = acceptance;
