/// <reference lib="webworker" />
import { RegistryClient } from '@riftydev/npm-client';
import { MemoryFsSync, createMemoryFs } from '@riftydev/vfs/internal';
import type { OwnerProjectVfsFrame } from '../../../packages/workbench/src/workbench/project-vfs-protocol.ts';
import { createOwnerPackageState } from '../../../packages/workbench/src/workers/owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from '../../../packages/workbench/src/workers/owner-vfs-authority.ts';
import { createWorkbenchProjectVfs } from '../../../packages/workbench/src/workers/workbench-project-vfs.ts';
import manifest from './tracker-tree-manifest.json';

declare const self: DedicatedWorkerGlobalScope;
const root = '/workspace';
const encoder = new TextEncoder();

// Transparent observation of the real memory backend; no substituted behavior.
class ObservedMemory extends MemoryFsSync {
  readonly contentReads: string[] = [];
  override readFileBytesSync(path: string): Uint8Array {
    this.contentReads.push(path);
    return super.readFileBytesSync(path);
  }
}

async function measure(scale: 'tracker' | 'small') {
  const memory = createMemoryFs();
  const raw = new ObservedMemory(memory.backend);
  raw.mkdirSync(`${root}/src`, { recursive: true });
  raw.mkdirSync(`${root}/browse/nested`, { recursive: true });
  raw.writeFileSync(`${root}/src/main.ts`, new Uint8Array(4096).fill(42));
  for (let i = 0; i < 32; i++)
    raw.writeFileSync(`${root}/browse/file-${i}.ts`, encoder.encode(`export default ${i}`));
  if (scale === 'tracker') {
    for (const [relative, size] of manifest.files as [string, number][]) {
      const path = `${root}/node_modules/${relative}`;
      raw.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      raw.writeFileSync(path, new Uint8Array(size).fill(73));
    }
  } else {
    for (let i = 0; i < 483; i++) raw.writeFileSync(`${root}/other-${i}`, new Uint8Array(4096));
  }
  const composition = createOwnerVfsAuthorityComposition(raw, { ownerEpoch: `reads-${scale}` });
  const { authority, appliedMutations, installStampClaims } = composition;
  const entryCount = authority.snapshot().entries.length;
  const packages = createOwnerPackageState({
    initial: {
      cfg: {
        runtime: 'node-cli',
        root,
        entryPath: `${root}/src/main.ts`,
        packageName: 'targeted-reads',
        packageVersion: '1.0.0',
        installDeps: {},
        packageJson: '{"name":"targeted-reads","version":"1.0.0"}',
        seedFiles: {},
      },
      templateId: 'targeted-reads',
      slug: 'targeted-reads',
      fromScratch: true,
    },
    vfs: memory.vfs,
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({ baseUrl: self.location.origin }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  let result: OwnerProjectVfsFrame | undefined;
  const vfs = createWorkbenchProjectVfs({
    projectRoot: root,
    authority,
    appliedMutations,
    packageMutations: packages.mutations,
    durability: 'ephemeral',
    emit: (frame) => {
      result = frame;
    },
    fatal: (error) => {
      throw error;
    },
  });
  const read = (kind: 'file' | 'directory') =>
    vfs.handleFrame({
      type:
        kind === 'file'
          ? 'workbench:project-vfs-read-file'
          : 'workbench:project-vfs-read-directory',
      requestId: 'measure',
      path: `${root}/${kind === 'file' ? 'src/main.ts' : 'browse'}`,
    });
  const timings: Record<string, number[]> = {};
  const reads: Record<string, string[]> = {};
  for (const kind of ['file', 'directory'] as const) {
    read(kind);
    raw.contentReads.length = 0;
    read(kind);
    reads[kind] = [...raw.contentReads];
    timings[kind] = [];
    for (let batch = 0; batch < 7; batch++) {
      raw.contentReads.length = 0;
      const start = performance.now();
      for (let i = 0; i < 20; i++) read(kind);
      timings[kind].push((performance.now() - start) / 20);
    }
  }
  read('file');
  const file = result as OwnerProjectVfsFrame | undefined;
  if (file?.type !== 'workbench:project-vfs-read-file-result' || !file.ok)
    throw new Error('file read failed');
  file.entry.content.fill(0);
  const isolated = authority.readFileBytesSync(`${root}/src/main.ts`).every((byte) => byte === 42);
  const fileVersion = file.entry.version;
  authority.writeFileSync(`${root}/src/main.ts`, encoder.encode('edited'));
  read('file');
  const edited = result as OwnerProjectVfsFrame | undefined;
  read('directory');
  const directory = result;
  await vfs.close();
  return { scale, entryCount, timings, reads, isolated, fileVersion, edited, directory };
}

self.onmessage = (event: MessageEvent<'tracker' | 'small'>) => {
  void measure(event.data).then(
    (result) => self.postMessage({ ok: true, result }),
    (error: unknown) => self.postMessage({ ok: false, error: String(error) }),
  );
};
