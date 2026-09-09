import type { PreviewHandle, ProjectSession } from '@riftydev/workbench';
import {
  type PlaygroundWorkbenchOptions,
  openPlaygroundWorkbench,
} from '@riftydev/workbench/playground';
import { captureBuiltFiles, proveOrphanScratchRecovery } from './orphan-scratch-recovery-proof';
import { proveSnapshotApplication } from './snapshot-application-proof';
import { proveStorageNamespaces } from './storage-namespace-proof';

interface Snapshot {
  readonly packageJsonText: string;
  readonly snapshotId: string;
  readonly templateId: string;
}

export interface SnapshotOnlyAcceptance {
  readonly previewUrl: string;
  readonly buildOutput: string;
  writeMessage(message: string): Promise<void>;
  closeAndProveSavedState(): Promise<void>;
  proveStorageNamespaces(): Promise<void>;
  proveOrphanScratchRecovery(): Promise<void>;
}

async function command(project: ProjectSession<PreviewHandle>, line: string) {
  const terminal = project.terminals.open();
  let output = '';
  const detach = terminal.attach((chunk) => {
    output += chunk;
  });
  try {
    const run = terminal.run(line);
    try {
      const exit = await run.exited;
      const closed = await run.close();
      if (closed.code !== exit.code || closed.signal !== exit.signal)
        throw new Error(`Terminal settlement changed: ${line}`);
      return { exit, output };
    } finally {
      await run.close();
    }
  } finally {
    detach();
    await terminal.close();
  }
}

export async function openSnapshotOnlyAcceptance(
  options: PlaygroundWorkbenchOptions,
): Promise<SnapshotOnlyAcceptance> {
  const strict: PlaygroundWorkbenchOptions = {
    ...options,
    packageAcquisition: { mode: 'snapshot-only' },
    storage: { persistence: 'ephemeral' },
  };
  const response = await fetch('/producer-vite-snapshot.json');
  if (!response.ok) throw new Error(`Vite producer metadata HTTP ${response.status}`);
  const snapshot = (await response.json()) as Snapshot;
  const unavailable = await openPlaygroundWorkbench(strict);
  try {
    const missing = unavailable.playground.define({
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'missing-snapshot',
      templateId: snapshot.templateId,
      entryPath: '/sentinel.cjs',
      files: {
        '/package.json': snapshot.packageJsonText,
        '/sentinel.cjs': "throw new Error('unavailable snapshot reached guest startup')\n",
      },
      firstMaterialization: {
        kind: 'snapshot',
        snapshot: {
          snapshotId: snapshot.snapshotId,
          templateId: snapshot.templateId,
          assetUrl: new URL('/required-missing-snapshot.tar.gz', location.href).href,
        },
      },
    });
    await unavailable.playground.catalog.createScratch({ definition: missing });
    let failure: unknown;
    let unexpected: ProjectSession<void> | undefined;
    try {
      unexpected = await unavailable.openProject(missing);
    } catch (error) {
      failure = error;
    } finally {
      await unexpected?.close();
    }
    if (!(failure instanceof Error) || !failure.message.includes('404'))
      throw new Error(`Required snapshot reason was lost across public owner: ${String(failure)}`);
  } finally {
    await unavailable.close();
  }
  const workbench = await openPlaygroundWorkbench(strict);
  const definition = workbench.playground.define({
    kind: 'npm-dev-server',
    id: 'scratch',
    starterId: snapshot.templateId,
    templateId: snapshot.templateId,
    files: {
      '/package.json': snapshot.packageJsonText,
      '/index.html':
        '<div id="app">booting</div><script type="module" src="/src/main.ts"></script>',
      '/src/main.ts': `
import { message } from './message.ts'
const render = (value) => { document.querySelector('#app').textContent = value }
render(message)
if (import.meta.hot) import.meta.hot.accept('./message.ts', (module) => render(module.message))
`,
      '/src/message.ts': 'export const message = "snapshot-only-vite-ready";\n',
      '/probe.cjs': "console.log('snapshot-only-local-script')\n",
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
  await workbench.playground.catalog.createScratch({ definition });
  const project = await workbench.openProject(definition);
  const local = await command(project, 'npm run probe');
  if (local.exit.code !== 0 || !local.output.includes('snapshot-only-local-script'))
    throw new Error(`Local script failed without registry: ${JSON.stringify(local)}`);
  const built = await command(project, 'npm run build');
  if (built.exit.code !== 0 || built.exit.signal !== null)
    throw new Error(`Snapshot Vite build failed: ${JSON.stringify(built)}`);
  const html = new TextDecoder().decode((await project.files.readFile('/dist/index.html')).bytes);
  if (!html.includes('/assets/') || html.includes('/src/main.ts'))
    throw new Error(`Snapshot build did not emit real bundled output: ${html}`);
  const builtFiles = await captureBuiltFiles(project);
  const run = project.run();
  let output = '';
  const detach = run.terminal.attach((chunk) => {
    output += chunk;
  });
  let preview: PreviewHandle;
  try {
    preview = await run.ready;
  } catch (error) {
    throw new Error(`Snapshot npm dev failed: ${String(error)}\n${output}`, { cause: error });
  }
  return Object.freeze({
    previewUrl: preview.url,
    buildOutput: built.output,
    async writeMessage(message: string) {
      const current = await project.files.readFile('/src/message.ts');
      await project.files.writeFile(
        '/src/message.ts',
        new TextEncoder().encode(`export const message = ${JSON.stringify(message)};\n`),
        { expectedVersion: current.version },
      );
    },
    proveStorageNamespaces: () => proveStorageNamespaces(strict),
    proveOrphanScratchRecovery: () => proveOrphanScratchRecovery(strict, builtFiles),
    async closeAndProveSavedState() {
      try {
        await run.close();
        const uncached = await command(project, 'npm install');
        if (
          uncached.exit.code === 0 ||
          uncached.exit.signal !== null ||
          !uncached.output.includes('npm-client.registry.tarball') ||
          !uncached.output.includes('not cached')
        )
          throw new Error(
            `Uncached required tarball did not fail loudly: ${JSON.stringify(uncached)}`,
          );
        const denied = await command(
          project,
          'npm install rifty-packed-unavailable --prefer-online',
        );
        if (denied.exit.code === 0 || !/registry|acquisition|not implemented/i.test(denied.output))
          throw new Error(`Required absent package did not fail loudly: ${JSON.stringify(denied)}`);
      } finally {
        detach();
        await project.close();
        await workbench.close();
      }
      await proveSnapshotApplication(
        strict,
        new URL('/producer-snapshot.tar.gz', location.href).href,
      );
    },
  });
}
