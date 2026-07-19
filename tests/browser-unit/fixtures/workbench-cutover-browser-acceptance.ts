import { workbenchViteHostAssets } from '../../../apps/playground/src/browser-unit/workbench-vite-host-assets.ts';
import {
  type PreviewHandle,
  type ProjectSession,
  type ProjectTerminalRun,
  type RuntimeAssetProgress,
  openWorkbench,
  projects,
} from '../../../packages/workbench/src/workbench/public.ts';

type Exit = { readonly code: number | null; readonly signal: string | null };

interface CommandProof {
  readonly exit: Exit;
  readonly output: string;
}

interface ModeProof {
  readonly devHtml: string;
  readonly devOutput: string;
  readonly build: CommandProof;
  readonly previewHtml: string;
  readonly previewOutput: string;
}

export interface DurableVite7Proof extends ModeProof {
  readonly progress: readonly RuntimeAssetProgress[];
}

export interface Vite8EmptyProof extends ModeProof {
  readonly progress: readonly RuntimeAssetProgress[];
}

export interface Vite7FaultProof {
  readonly failureName: string;
  readonly failureMessage: string;
  readonly output: string;
  readonly exit: Exit;
  readonly previewStatus: number;
  readonly previewBody: string;
}

function withTimeout<T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
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

function deployment(nodeWorkerUrl?: string) {
  const ownerWorkerUrl = new URL(workbenchViteHostAssets.workers.owner, location.href);
  const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
  let base = document.querySelector<HTMLBaseElement>('base[data-cutover-acceptance]');
  if (base === null) {
    base = document.createElement('base');
    base.dataset.cutoverAcceptance = 'true';
    document.head.prepend(base);
  }
  base.href = ownerWorkerBaseUrl.href;
  return {
    workers: {
      ...workbenchViteHostAssets.workers,
      owner: ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length),
      ...(nodeWorkerUrl === undefined ? {} : { node: new URL(nodeWorkerUrl, location.href).href }),
    },
    serviceWorker: { url: '/sw.js', scope: '/' },
    wasm: workbenchViteHostAssets.wasm,
    previewProbeTimeoutMs: 30_000,
  } as const;
}

function viteFiles(
  marker: string,
  cacheOutsidePackageTree = false,
): Readonly<Record<string, string>> {
  return {
    '/index.html': '<div id="app">booting</div><script type="module" src="/src/main.js"></script>',
    '/src/main.js': `document.querySelector('#app').textContent = ${JSON.stringify(marker)};\n`,
    ...(cacheOutsidePackageTree
      ? { '/vite.config.cjs': "module.exports = { cacheDir: '.vite-cache' };\n" }
      : {}),
  };
}

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

async function responseText(url: string, label: string): Promise<string> {
  const response = await withTimeout(fetch(url, { cache: 'no-store' }), label, 30_000);
  const body = await response.text();
  if (!response.ok) throw new Error(`${label} failed (${String(response.status)}): ${body}`);
  return body;
}

async function waitForPreview(url: string, label: string): Promise<string> {
  const deadline = performance.now() + 120_000;
  let lastFailure = 'not attempted';
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.text();
      if (response.ok) return body;
      lastFailure = `${String(response.status)}: ${body}`;
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
): Promise<{ readonly html: string; readonly output: string }> {
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
    await withTimeout(run.close(), `${label} close`, 30_000);
    return { html, output };
  } finally {
    detach();
    await terminal.close();
  }
}

async function runModeMatrix(
  project: ProjectSession<PreviewHandle>,
  previewPort: number,
  marker: string,
  label: string,
): Promise<ModeProof> {
  const dev = project.run();
  let devOutput = '';
  const detach = dev.terminal.attach((chunk, stream) => {
    devOutput += `[${stream}] ${chunk}`;
  });
  let preview: PreviewHandle;
  try {
    preview = await withTimeout(dev.ready, `${label} dev readiness`, 120_000);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${devOutput}`, {
      cause: error,
    });
  } finally {
    detach();
  }
  const devHtml = await responseText(preview.url, `${label} dev response`);
  if (!devHtml.includes('/src/main.js')) {
    throw new Error(`${label} dev returned the wrong document for ${marker}`);
  }
  await waitForRenderedMarker(preview.url, marker, `${label} dev`);
  await withTimeout(dev.close(), `${label} dev close`, 30_000);
  const build = await runCommand(project, 'vite build', `${label} build`);
  const previewProof = await runPreview(project, previewPort, `${label} preview`, marker);
  if (!previewProof.html.includes('/assets/')) {
    throw new Error(`${label} preview did not serve its production build`);
  }
  return {
    devHtml,
    devOutput,
    build,
    previewHtml: previewProof.html,
    previewOutput: previewProof.output,
  };
}

export async function runDurableVite7(stage: 'cold' | 'reopen'): Promise<DurableVite7Proof> {
  const progress: RuntimeAssetProgress[] = [];
  const workbench = await openWorkbench({
    deployment: deployment(),
    packageAcquisition: { registryUrl: '/npm-registry' },
    storage: { persistence: 'required' },
  });
  const project = await workbench.openProject(
    projects.vite({
      id: 'browser-cutover-durable-vite7',
      viteVersion: '7.3.6',
      files: viteFiles('browser-cutover-durable-vite7', true),
    }),
    { onRuntimeAssetProgress: (entry) => progress.push(entry) },
  );
  try {
    const proof = await runModeMatrix(
      project,
      stage === 'cold' ? 43_271 : 43_272,
      'browser-cutover-durable-vite7',
      `durable Vite 7 ${stage}`,
    );
    return { ...proof, progress: Object.freeze([...progress]) };
  } finally {
    await project.close();
    await workbench.close();
  }
}

export async function runDefaultVite8Empty(nodeWorkerUrl: string): Promise<Vite8EmptyProof> {
  const progress: RuntimeAssetProgress[] = [];
  const workbench = await openWorkbench({
    deployment: deployment(nodeWorkerUrl),
    packageAcquisition: { registryUrl: '/npm-registry' },
    storage: { persistence: 'ephemeral' },
  });
  const project = await workbench.openProject(
    projects.vite({
      id: 'browser-cutover-default-vite8',
      files: viteFiles('browser-cutover-default-vite8'),
    }),
    { onRuntimeAssetProgress: (entry) => progress.push(entry) },
  );
  try {
    const proof = await runModeMatrix(
      project,
      43_288,
      'browser-cutover-default-vite8',
      'default Vite 8',
    );
    return { ...proof, progress: Object.freeze([...progress]) };
  } finally {
    await project.close();
    await workbench.close();
  }
}

export async function runVite7CapabilityClose(nodeWorkerUrl: string): Promise<Vite7FaultProof> {
  const workbench = await openWorkbench({
    deployment: deployment(nodeWorkerUrl),
    packageAcquisition: { registryUrl: '/npm-registry' },
    storage: { persistence: 'ephemeral' },
  });
  const project = await workbench.openProject(
    projects.vite({
      id: 'browser-cutover-vite7-capability-close',
      viteVersion: '7.3.6',
      files: viteFiles('must-not-publish'),
    }),
  );
  const run = project.run();
  let output = '';
  const detach = run.terminal.attach((chunk, stream) => {
    output += `[${stream}] ${chunk}`;
  });
  try {
    const failure = await withTimeout(run.ready, 'Vite 7 fault readiness', 120_000).then(
      () => null,
      (error: unknown) => error,
    );
    if (!(failure instanceof Error)) {
      throw new Error('Vite 7 capability close published false readiness');
    }
    const exit = await withTimeout(run.exited, 'Vite 7 fault exit', 30_000);
    const previewResponse = await fetch('/preview/5173/', { cache: 'no-store' });
    const previewBody = await previewResponse.text();
    return {
      failureName: failure.name,
      failureMessage: failure.message,
      output,
      exit,
      previewStatus: previewResponse.status,
      previewBody,
    };
  } finally {
    detach();
    await run.close();
    await project.close();
    await workbench.close();
  }
}
