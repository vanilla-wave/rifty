import serviceWorkerUrl from '@riftydev/service-worker/sw?worker&url';
import {
  type PreviewHandle,
  type ProjectSession,
  type ProjectTerminalRun,
  type RuntimeAssetProgress,
  openWorkbench,
  projects,
} from '@riftydev/workbench';
import devServerWorkerUrl from '@riftydev/workbench/dev-server-worker?worker&url';
import kernelWorkerUrl from '@riftydev/workbench/kernel-worker?worker&url';
import nodeWorkerUrl from '@riftydev/workbench/node-worker?worker&url';
import ownerWorkerUrl from '@riftydev/workbench/owner-worker?worker&url';
import { openPlaygroundWorkbench } from '@riftydev/workbench/playground';
import typescriptWorkerUrl from '@riftydev/workbench/typescript-worker?worker&url';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

interface CommandProof {
  readonly exit: { readonly code: number | null; readonly signal: string | null };
  readonly output: string;
}

interface VersionJourneyProof {
  readonly devHtml: string;
  readonly build: CommandProof;
  readonly previewHtml: string;
}

export interface PackedVite7Proof extends VersionJourneyProof {
  readonly optimize: CommandProof;
}

export interface PackedVite8Proof extends VersionJourneyProof {
  readonly vite8RuntimeAssetProgress: readonly RuntimeAssetProgress[];
}

export interface PackedWorkbenchAcceptance {
  readonly previewUrl: string;
  readonly runtimeAssetProgress: readonly RuntimeAssetProgress[];
  readonly publishedCompanion: 'function';
  writeMessage(message: string): Promise<void>;
  runVite7BuildPreview(): Promise<PackedVite7Proof>;
  runDefaultVite8(): Promise<PackedVite8Proof>;
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

const withTimeout = <T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
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

async function runCommand(
  project: ProjectSession<unknown>,
  line: string,
  label: string,
): Promise<CommandProof> {
  const terminal = project.terminals.open();
  const run = terminal.run(line);
  let output = '';
  const detach = terminal.attach((chunk, stream) => {
    output += `[${stream}] ${chunk}`;
  });
  try {
    await withTimeout(run.ready, `${label} admission`, 30_000);
    const exit = await withTimeout(run.exited, `${label} exit`, 180_000);
    if (exit.code !== 0 || exit.signal !== null) {
      throw new Error(`${label} failed (${JSON.stringify(exit)}):\n${output}`);
    }
    return { exit, output };
  } finally {
    detach();
    await terminal.close();
  }
}

async function waitForPreview(url: string, label: string): Promise<string> {
  const deadline = performance.now() + 120_000;
  let lastFailure = 'not attempted';
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.text();
      if (response.ok) return body;
      lastFailure = `${response.status}: ${body}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} did not become ready: ${lastFailure}`);
}

async function waitForRenderedMarker(url: string, marker: string, label: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    'position:fixed;inset:auto 0 0 auto;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  frame.src = url;
  document.body.append(frame);
  try {
    const deadline = performance.now() + 120_000;
    while (performance.now() < deadline) {
      if (frame.contentDocument?.querySelector('#app')?.textContent === marker) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`${label} did not render ${JSON.stringify(marker)}`);
  } finally {
    frame.remove();
  }
}

async function runPreview(
  project: ProjectSession<unknown>,
  port: number,
  label: string,
  marker: string,
): Promise<string> {
  const terminal = project.terminals.open();
  const run: ProjectTerminalRun = terminal.run(`vite preview --port ${String(port)} --strictPort`);
  let output = '';
  const detach = terminal.attach((chunk, stream) => {
    output += `[${stream}] ${chunk}`;
  });
  try {
    await withTimeout(run.ready, `${label} admission`, 30_000);
    const html = await waitForPreview(`/preview/${String(port)}/`, label);
    await waitForRenderedMarker(`/preview/${String(port)}/`, marker, label);
    const exit = await withTimeout(run.close(), `${label} close`, 30_000);
    if (exit.code !== 0 && exit.signal === null) {
      throw new Error(`${label} close failed (${JSON.stringify(exit)}):\n${output}`);
    }
    return html;
  } finally {
    detach();
    await terminal.close();
  }
}

function viteFiles(
  message: string,
  cacheOutsidePackageTree = false,
): Readonly<Record<string, string>> {
  return {
    '/index.html': '<div id="app">booting</div><script type="module" src="/src/main.ts"></script>',
    '/src/main.ts': projectMain,
    '/src/message.ts': `export const message = ${JSON.stringify(message)};\n`,
    ...(cacheOutsidePackageTree
      ? { '/vite.config.cjs': "module.exports = { cacheDir: '.vite-cache' };\n" }
      : {}),
  };
}

async function openAcceptance(): Promise<PackedWorkbenchAcceptance> {
  if (typeof openPlaygroundWorkbench !== 'function') {
    throw new Error('packed Workbench Playground companion export is not callable');
  }
  if (typeof typescriptWorkerUrl !== 'string' || typescriptWorkerUrl.length === 0) {
    throw new Error('packed Workbench TypeScript worker export is not a URL');
  }
  const runtimeAssetProgress: RuntimeAssetProgress[] = [];
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
      files: viteFiles('packed-consumer-ready', true),
    }),
    { onRuntimeAssetProgress: (progress) => runtimeAssetProgress.push(progress) },
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
  status.textContent = 'ready';
  previewLink.href = preview.url;
  previewLink.textContent = preview.url;
  previewFrame.src = preview.url;

  let closed = false;
  let currentMessage = 'packed-consumer-ready';
  let vite7Promise: Promise<PackedVite7Proof> | null = null;
  let vite8Promise: Promise<PackedVite8Proof> | null = null;

  const openDefaultVite8 = async (): Promise<{
    readonly project: ProjectSession<PreviewHandle>;
    readonly run: ReturnType<ProjectSession<PreviewHandle>['run']>;
    readonly progress: RuntimeAssetProgress[];
  }> => {
    const vite8RuntimeAssetProgress: RuntimeAssetProgress[] = [];
    const vite8Project = await workbench.openProject(
      projects.vite({
        id: 'packed-vite8-consumer',
        files: viteFiles('packed-vite8-ready'),
      }),
      {
        onRuntimeAssetProgress: (progress) => vite8RuntimeAssetProgress.push(progress),
      },
    );
    const vite8Run = vite8Project.run();
    return { project: vite8Project, run: vite8Run, progress: vite8RuntimeAssetProgress };
  };

  return Object.freeze({
    previewUrl: preview.url,
    runtimeAssetProgress: Object.freeze([...runtimeAssetProgress]),
    publishedCompanion: 'function' as const,
    async writeMessage(message: string): Promise<void> {
      const current = await project.files.readFile('/src/message.ts');
      await project.files.writeFile(
        '/src/message.ts',
        new TextEncoder().encode(`export const message = ${JSON.stringify(message)};\n`),
        { expectedVersion: current.version },
      );
      currentMessage = message;
    },
    runVite7BuildPreview(): Promise<PackedVite7Proof> {
      if (vite7Promise !== null) return vite7Promise;
      vite7Promise = (async () => {
        const vite7DevResponse = await fetch(preview.url, { cache: 'no-store' });
        const vite7DevHtml = await vite7DevResponse.text();
        if (!vite7DevResponse.ok) throw new Error('packed Vite 7 dev preview became unavailable');
        await run.close();
        const vite7Build = await runCommand(project, 'vite build', 'packed Vite 7 build');
        const vite7Optimize = await runCommand(
          project,
          'vite optimize --force',
          'packed Vite 7 optimize',
        );
        const vite7PreviewHtml = await runPreview(
          project,
          43_177,
          'packed Vite 7 preview',
          currentMessage,
        );
        await project.close();
        return Object.freeze({
          devHtml: vite7DevHtml,
          build: vite7Build,
          optimize: vite7Optimize,
          previewHtml: vite7PreviewHtml,
        });
      })();
      void vite7Promise.catch(() => {});
      return vite7Promise;
    },
    runDefaultVite8(): Promise<PackedVite8Proof> {
      if (vite8Promise !== null) return vite8Promise;
      vite8Promise = (async () => {
        if (vite7Promise === null) {
          throw new Error('packed default Vite 8 requires completed Vite 7 acceptance');
        }
        await vite7Promise;
        const vite8 = await openDefaultVite8();
        let vite8TerminalOutput = '';
        const detachVite8 = vite8.run.terminal.attach((chunk, stream) => {
          vite8TerminalOutput += `[${stream}] ${chunk}`;
        });
        let vite8Preview: PreviewHandle;
        try {
          vite8Preview = await withTimeout(vite8.run.ready, 'packed default Vite 8 dev', 120_000);
        } catch (error) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\n${vite8TerminalOutput}`,
            { cause: error },
          );
        } finally {
          detachVite8();
        }
        const vite8DevResponse = await fetch(vite8Preview.url, { cache: 'no-store' });
        const vite8DevHtml = await vite8DevResponse.text();
        if (!vite8DevResponse.ok || !vite8DevHtml.includes('/src/main.ts')) {
          throw new Error('packed default Vite 8 dev returned the wrong document');
        }
        await waitForRenderedMarker(
          vite8Preview.url,
          'packed-vite8-ready',
          'packed default Vite 8 dev',
        );
        await vite8.run.close();
        const vite8Build = await runCommand(vite8.project, 'vite build', 'packed Vite 8 build');
        const vite8PreviewHtml = await runPreview(
          vite8.project,
          43_188,
          'packed Vite 8 preview',
          'packed-vite8-ready',
        );
        await vite8.project.close();

        return Object.freeze({
          devHtml: vite8DevHtml,
          build: vite8Build,
          previewHtml: vite8PreviewHtml,
          vite8RuntimeAssetProgress: Object.freeze([...vite8.progress]),
        });
      })();
      void vite8Promise.catch(() => {});
      return vite8Promise;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      try {
        if (vite8Promise !== null) await vite8Promise;
        else if (vite7Promise !== null) await vite7Promise;
        else {
          await run.close();
          await project.close();
        }
      } finally {
        await workbench.close();
      }
    },
  });
}

const acceptance = openAcceptance().catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : String(error);
  throw error;
});
void acceptance.catch(() => {});
window.__RIFTY_PACKED_WORKBENCH__ = acceptance;
