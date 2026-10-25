import type { ProjectSession } from '@riftydev/workbench';
import {
  type PlaygroundWorkbench,
  type PlaygroundWorkbenchOptions,
  openPlaygroundWorkbench,
} from '@riftydev/workbench/playground';

interface Snapshot {
  readonly packageJsonText: string;
  readonly entrySource: string;
  readonly expectedOutput: string;
  readonly savedEntrySource: string;
  readonly savedExpectedOutput: string;
  readonly snapshotId: string;
  readonly templateId: string;
}

const encoder = new TextEncoder();
const namespaces = [' packed-namespace-A ', 'packed-namespace-B'] as const;
const savedId = 'packed-saved';
const indexPath = '/node_modules/ms/index.js';
const retainedText = 'retained public project bytes\n';
const defaultPaths = [
  '/main.cjs',
  '/package.json',
  '/user.txt',
  indexPath,
  '/node_modules/ms/package.json',
  '/node_modules/ms/local.txt',
] as const;

function expectBytes(actual: Uint8Array, expected: Uint8Array, label: string): void {
  if (actual.length !== expected.length || !actual.every((byte, index) => byte === expected[index]))
    throw new Error(`Packed storage namespace changed ${label}`);
}

async function runProgram(project: ProjectSession<void>, expected: string): Promise<void> {
  const run = project.run();
  let output = '';
  const detach = run.terminal.attach((chunk) => {
    output += chunk;
  });
  try {
    await run.ready;
    const exit = await run.exited;
    const closed = await run.close();
    if (
      exit.code !== 0 ||
      exit.signal !== null ||
      closed.code !== exit.code ||
      closed.signal !== exit.signal ||
      output.trim() !== expected
    ) {
      throw new Error(
        `Namespace program disagrees with real Node: ${JSON.stringify({ exit, closed, output, expected })}`,
      );
    }
  } finally {
    detach();
    await run.close();
  }
}

export async function proveStorageNamespaces(options: PlaygroundWorkbenchOptions): Promise<void> {
  const response = await fetch('/producer-snapshot.json');
  if (!response.ok) throw new Error(`Producer namespace metadata HTTP ${response.status}`);
  const snapshot = (await response.json()) as Snapshot;
  const assetUrl = new URL('/producer-snapshot.tar.gz', location.href).href;
  const persistent: PlaygroundWorkbenchOptions = {
    ...options,
    storage: { persistence: 'required' },
  };
  const open = (namespace?: string) =>
    openPlaygroundWorkbench(
      namespace === undefined
        ? persistent
        : { ...persistent, storage: { persistence: 'required', namespace } },
    );
  const definition = (workbench: PlaygroundWorkbench, id: string) =>
    workbench.playground.define({
      kind: 'node-cli',
      id,
      starterId: 'packed-ms',
      templateId: snapshot.templateId,
      entryPath: '/main.cjs',
      files: { '/package.json': snapshot.packageJsonText, '/main.cjs': snapshot.entrySource },
      firstMaterialization: {
        kind: 'snapshot',
        snapshot: { snapshotId: snapshot.snapshotId, templateId: snapshot.templateId, assetUrl },
      },
    });
  const origin = await navigator.storage.getDirectory();
  for (const namespace of namespaces) {
    try {
      await origin.getDirectoryHandle(namespace);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') continue;
      throw error;
    }
    throw new Error(`Packed namespace was not fresh: ${JSON.stringify(namespace)}`);
  }
  const sentinelBytes = new Uint8Array([0, 1, 127, 128, 254, 255, 13, 10]);
  const sentinel = await origin.getFileHandle('packed-host-sentinel.bin', { create: true });
  const writable = await sentinel.createWritable();
  await writable.write(sentinelBytes);
  await writable.close();
  const checkSentinel = async () =>
    expectBytes(
      new Uint8Array(await (await sentinel.getFile()).arrayBuffer()),
      sentinelBytes,
      'origin host sentinel',
    );

  const checkDefault = async (prior?: ReadonlyMap<string, Uint8Array>) => {
    const workbench = await open();
    try {
      const projects = workbench.playground.catalog.snapshot().projects;
      if (projects.length !== 1 || projects[0]?.id !== savedId)
        throw new Error(`Default catalog changed: ${JSON.stringify(projects)}`);
      const project = await workbench.openProject(definition(workbench, savedId));
      try {
        const captured = new Map<string, Uint8Array>();
        for (const path of defaultPaths) {
          const bytes = (await project.files.readFile(path)).bytes.slice();
          const expected = prior?.get(path);
          if (expected !== undefined) expectBytes(bytes, expected, `default ${path}`);
          const text =
            path === '/main.cjs'
              ? snapshot.savedEntrySource
              : path === '/package.json'
                ? snapshot.packageJsonText
                : path === '/user.txt' || path === '/node_modules/ms/local.txt'
                  ? retainedText
                  : undefined;
          if (text !== undefined) expectBytes(bytes, encoder.encode(text), `default ${path}`);
          captured.set(path, bytes);
        }
        await runProgram(project, snapshot.savedExpectedOutput);
        return captured;
      } finally {
        await project.close();
      }
    } finally {
      await workbench.close();
      await checkSentinel();
    }
  };
  const originalDefault = await checkDefault();
  const originalIndex = originalDefault.get(indexPath);
  if (originalIndex === undefined) throw new Error('Default dependency baseline is absent');

  const checkNamespace = async (namespace: string, fresh: boolean) => {
    const workbench = await open(namespace);
    try {
      const catalog = workbench.playground.catalog.snapshot();
      if (
        fresh
          ? catalog.projects.length !== 0 || catalog.scratch !== null
          : catalog.projects.length !== 1 || catalog.projects[0]?.id !== savedId
      )
        throw new Error(
          `Namespace catalog isolation failed: ${JSON.stringify({ namespace, fresh, catalog })}`,
        );
      const source = encoder.encode(
        `${snapshot.entrySource}// namespace ${JSON.stringify(namespace)}\n`,
      );
      const marker = new Uint8Array([0, 128, 255, ...encoder.encode(namespace), 13, 10]);
      const plan = definition(workbench, fresh ? 'scratch' : savedId);
      if (fresh) await workbench.playground.catalog.createScratch({ definition: plan });
      const project = await workbench.openProject(plan);
      try {
        if (fresh) {
          const main = await project.files.readFile('/main.cjs');
          await project.files.writeFile('/main.cjs', source, { expectedVersion: main.version });
          await project.files.writeFile('/namespace.bin', marker, { expectedVersion: null });
          const roots = await project.files.readdir('/');
          if (roots.some((entry) => entry.path === '/user.txt'))
            throw new Error('Fresh namespace imported default user files');
          await workbench.playground.forSession(project).awaitDurability();
        }
        expectBytes(
          (await project.files.readFile('/main.cjs')).bytes,
          source,
          `${namespace} saved source`,
        );
        expectBytes(
          (await project.files.readFile('/namespace.bin')).bytes,
          marker,
          `${namespace} binary marker`,
        );
        expectBytes(
          (await project.files.readFile(indexPath)).bytes,
          originalIndex,
          `${namespace} producer dependency`,
        );
        await runProgram(project, snapshot.expectedOutput);
      } finally {
        await project.close();
      }
      if (fresh) {
        await workbench.playground.catalog.saveScratch({
          id: savedId,
          name: 'Packed namespace project',
          definition: definition(workbench, savedId),
        });
      }
    } finally {
      await workbench.close();
      await checkSentinel();
    }
    const physical = await origin.getDirectoryHandle(namespace);
    if (physical.name !== namespace || (await physical.isSameEntry(origin)))
      throw new Error(
        `Namespace did not select its literal native directory: ${JSON.stringify(namespace)}`,
      );
  };
  for (const namespace of namespaces) await checkNamespace(namespace, true);
  for (const namespace of namespaces) await checkNamespace(namespace, false);
  await checkDefault(originalDefault);
}
