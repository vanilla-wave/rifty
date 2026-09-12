import { createSandbox } from '@riftydev/sdk';
import type { PreviewHandle, ProjectSession } from '@riftydev/workbench';
import {
  type PlaygroundWorkbench,
  type PlaygroundWorkbenchOptions,
  openPlaygroundWorkbench,
} from '@riftydev/workbench/playground';

interface FileEntry {
  readonly path: string;
  readonly encoding: 'base64';
  readonly content: string;
}
interface Seed {
  readonly directories: readonly string[];
  readonly files: readonly FileEntry[];
}
interface Snapshot {
  readonly packageJsonText: string;
  readonly entrySource: string;
  readonly expectedOutput: string;
  readonly snapshotId: string;
  readonly templateId: string;
}
const encoder = new TextEncoder();
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function decode(content: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
}
const textFile = (path: string, text: string): FileEntry => ({
  path,
  encoding: 'base64',
  content: encode(encoder.encode(text)),
});

/** Capture actual preceding Vite build output through the public file API. */
export async function captureBuiltFiles(project: ProjectSession<PreviewHandle>): Promise<Seed> {
  const files: FileEntry[] = [];
  const directories: string[] = ['dist'];
  const walk = async (path: string): Promise<void> => {
    for (const child of await project.files.readdir(path)) {
      if (child.kind === 'dir') {
        directories.push(child.path.slice(1));
        await walk(child.path);
      } else {
        files.push({
          path: child.path.slice(1),
          encoding: 'base64',
          content: encode((await project.files.readFile(child.path)).bytes),
        });
      }
    }
  };
  await walk('/dist');
  if (!files.some((file) => file.path === 'dist/index.html'))
    throw new Error('Real browser Vite build output is absent');
  return { directories, files };
}

export async function proveOrphanScratchRecovery(
  options: PlaygroundWorkbenchOptions,
  build: Seed,
): Promise<void> {
  const payloadResponse = await fetch('/orphan-payload.json');
  if (!payloadResponse.ok) throw new Error('Original producer orphan payload unavailable');
  const payload = (await payloadResponse.json()) as Seed;
  const source = [
    textFile('orphan-only.txt', 'unproven orphan source bytes\n'),
    textFile('src/main.js', 'throw new Error("retained orphan must never run");\n'),
    textFile('.git/config', '[core]\n\trepositoryformatversion = 0\n'),
    textFile('.vite/user.txt', 'ordinary vite directory'),
    textFile('nested/.rifty/user.txt', 'ordinary nested directory'),
    textFile('.rifty-install-stamp.json', 'ordinary root lookalike'),
    {
      path: 'binary.bin',
      encoding: 'base64' as const,
      content: encode(new Uint8Array([0, 1, 128, 255, 13, 10])),
    },
  ];
  const files = [...payload.files, ...build.files, ...source];
  const directories = [
    ...new Set([
      ...payload.directories,
      ...build.directories,
      'src',
      '.git',
      '.vite',
      'nested',
      'nested/.rifty',
      'empty-user-directory',
    ]),
  ];
  const expected = new Map(files.map((file) => [file.path, file.content]));
  if (expected.size !== files.length) throw new Error('Orphan fixture duplicate source paths');
  const namespace = 'packed-orphan-recovery';
  const seed = await createSandbox({
    requireCrossOriginIsolation: false,
    skipServiceWorker: true,
    storage: { persistence: 'required', namespace },
    toolchain: { workerUrl: new URL('/rifty/no-coi-toolchain-worker.js', location.href).href },
  });
  try {
    const root = '/.rifty/workbench/v2/projects/scratch/tree';
    for (const path of directories) await seed.fs.mkdir(`${root}/${path}`, { recursive: true });
    for (const file of files) await seed.fs.writeFile(`${root}/${file.path}`, decode(file.content));
    await seed.fs.writeFile(`${root}/.rifty/private.txt`, 'private control must not be downloaded');
    const dependencyResponse = await fetch('/producer-vite-snapshot.json');
    if (!dependencyResponse.ok) throw new Error('Orphan dependency provenance is unavailable');
    const dependency = (await dependencyResponse.json()) as {
      snapshotId: string;
      templateId: string;
    };
    await seed.toolchain.applySnapshot({
      cwd: root,
      force: true,
      snapshot: {
        snapshotId: dependency.snapshotId,
        templateId: dependency.templateId,
        assetUrl: new URL('/producer-vite-snapshot.tar.gz', location.href).href,
      },
    });
    if ((await seed.fs.readFile(`${root}/node_modules/.rifty-install-stamp.json`)).length === 0)
      throw new Error('Actual private install claim is absent');
    const flush = await seed.fs.flush();
    if (flush.persistence !== 'flushed') throw new Error('Packed SDK orphan seed was not durable');
  } finally {
    seed.dispose();
  }

  const response = await fetch('/producer-snapshot.json');
  if (!response.ok) throw new Error('Fresh project producer metadata unavailable');
  const snapshot = (await response.json()) as Snapshot;
  const persistent: PlaygroundWorkbenchOptions = {
    ...options,
    storage: { persistence: 'required', namespace },
  };
  const definition = (workbench: PlaygroundWorkbench) =>
    workbench.playground.define({
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'packed-ms',
      templateId: snapshot.templateId,
      entryPath: '/main.cjs',
      files: { '/package.json': snapshot.packageJsonText, '/main.cjs': snapshot.entrySource },
      firstMaterialization: {
        kind: 'snapshot',
        snapshot: {
          snapshotId: snapshot.snapshotId,
          templateId: snapshot.templateId,
          assetUrl: new URL('/producer-snapshot.tar.gz', location.href).href,
        },
      },
    });
  let retainedId: string | undefined;
  for (let pass = 0; pass < 2; pass++) {
    const workbench = await openPlaygroundWorkbench(persistent);
    try {
      const plan = definition(workbench);
      await workbench.playground.catalog.createScratch({ definition: plan });
      const project = await workbench.openProject(plan);
      try {
        const rootEntries = await project.files.readdir('/');
        if (rootEntries.some((entry) => entry.path === '/orphan-only.txt'))
          throw new Error('Fresh Scratch adopted orphan user bytes');
        const run = project.run();
        let output = '';
        const detach = run.terminal.attach((chunk) => {
          output += chunk;
        });
        try {
          await run.ready;
          const exit = await run.exited;
          if (exit.code !== 0 || output.trim() !== snapshot.expectedOutput)
            throw new Error(`Fresh recovery Scratch disagrees with real Node: ${output}`);
        } finally {
          detach();
          await run.close();
        }
        const records = await workbench.playground.catalog.listRetainedScratch();
        if (records.length !== 1 || records[0] === undefined)
          throw new Error('Orphan retained ownership missing/duplicated');
        const id = records[0].id;
        if (retainedId !== undefined && id !== retainedId)
          throw new Error('Retained id changed after reopen');
        retainedId = id;
        const json = await workbench.playground.catalog.exportRetainedScratch(id);
        if (json.length > 48 * 1024 * 1024) throw new Error('Recovery JSON exceeded finite bound');
        const archive = JSON.parse(json) as Seed & {
          format: string;
          version: number;
          root: string;
        };
        if (
          archive.format !== 'rifty-scratch-recovery' ||
          archive.version !== 1 ||
          archive.root !== '/'
        )
          throw new Error('Recovery envelope leaked its physical storage identity');
        if (
          archive.files.length !== expected.size ||
          new Set(archive.files.map((file) => file.path)).size !== expected.size
        )
          throw new Error('Recovery export lost ordinary files or exposed private metadata');
        for (const file of archive.files) {
          if (file.encoding !== 'base64' || expected.get(file.path) !== file.content)
            throw new Error(`Recovery changed ordinary file bytes: ${file.path}`);
        }
        if (
          JSON.stringify([...archive.directories].sort()) !==
          JSON.stringify([...directories].sort())
        )
          throw new Error('Recovery changed ordinary directories');
        await workbench.playground.forSession(project).awaitDurability();
      } finally {
        await project.close();
      }
    } finally {
      await workbench.close();
    }
  }
}
