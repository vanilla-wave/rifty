import { createSandbox } from '@riftydev/sdk';
import serviceWorkerUrl from '@riftydev/service-worker/sw?worker&url';
import { type PreviewHandle, openWorkbench, projects } from '@riftydev/workbench';
import devServerWorkerUrl from '@riftydev/workbench/dev-server-worker?worker&url';
import kernelWorkerUrl from '@riftydev/workbench/kernel-worker?worker&url';
import noCoiToolchainWorkerUrl from '@riftydev/workbench/no-coi-toolchain-worker?worker&url';
import nodeWorkerUrl from '@riftydev/workbench/node-worker?worker&url';
import ownerWorkerUrl from '@riftydev/workbench/owner-worker?worker&url';
import { openPlaygroundWorkbench } from '@riftydev/workbench/playground';
import typescriptWorkerUrl from '@riftydev/workbench/typescript-worker?worker&url';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export interface PackedWorkbenchAcceptance {
  readonly previewUrl: string;
  readonly sqliteProof: string;
  readonly companionLoaded: boolean;
  readonly sdkLoaded: boolean;
  readonly noCoiToolchainWorkerUrl: string;
  readonly typescriptWorkerUrl: string;
  readonly hostWasm: {
    readonly sqlite: string;
  };
  writeMessage(message: string): Promise<void>;
  close(): Promise<void>;
}

declare global {
  interface Window {
    __RIFTY_PACKED_WORKBENCH__: Promise<PackedWorkbenchAcceptance>;
  }
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Packed Workbench acceptance document is missing ${selector}`);
  }
  return element;
}

const status = requiredElement<HTMLParagraphElement>('#status');
const previewLink = requiredElement<HTMLAnchorElement>('#preview-link');
const previewFrame = requiredElement<HTMLIFrameElement>('#preview');

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

async function openAcceptance(): Promise<PackedWorkbenchAcceptance> {
  const workbench = await openWorkbench({
    deployment: {
      workers: {
        owner: ownerWorkerUrl,
        kernel: kernelWorkerUrl,
        node: nodeWorkerUrl,
        devServer: devServerWorkerUrl,
      },
      serviceWorker: { url: serviceWorkerUrl, scope: '/' },
      wasm: { sqlite: sqlWasmUrl },
      previewProbeTimeoutMs: 30_000,
    },
    packageAcquisition: {
      registryUrl: new URL('/npm-registry/', globalThis.location.href).href,
    },
    storage: { persistence: 'ephemeral' },
  });
  const project = await workbench.openProject(
    projects.vite({
      id: 'packed-vite-consumer',
      viteVersion: '7.3.6',
      files: {
        '/index.html':
          '<div id="app">booting</div><script type="module" src="/src/main.ts"></script>',
        '/src/main.ts': projectMain,
        '/src/message.ts': 'export const message = "packed-consumer-ready";\n',
        '/sqlite-proof.cjs': sqliteProofSource,
      },
    }),
  );
  const run = project.run();
  let terminalOutput = '';
  const detachTerminal = run.terminal.attach((chunk, stream) => {
    terminalOutput += `[${stream}] ${chunk}`;
  });
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

  const sqliteTerminal = project.terminals.open();
  let sqliteOutput = '';
  const detachSqlite = sqliteTerminal.attach((chunk) => {
    sqliteOutput += chunk;
  });
  try {
    const sqliteRun = sqliteTerminal.run('node sqlite-proof.cjs');
    const exited = await sqliteRun.exited;
    const closed = await sqliteRun.close();
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
  previewLink.href = preview.url;
  previewLink.textContent = preview.url;
  previewFrame.src = preview.url;

  return Object.freeze({
    previewUrl: preview.url,
    sqliteProof: sqliteOutput,
    companionLoaded: typeof openPlaygroundWorkbench === 'function',
    sdkLoaded: typeof createSandbox === 'function',
    noCoiToolchainWorkerUrl,
    typescriptWorkerUrl,
    hostWasm: Object.freeze({ sqlite: sqlWasmUrl }),
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
