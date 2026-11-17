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
type Scale = 'small' | 'tracker';
type Kind = 'file' | 'directory';

// Transparent observation of the real memory backend; no substituted behavior.
class ObservedMemory extends MemoryFsSync {
  readonly contentReads: string[] = [];
  override readFileBytesSync(path: string): Uint8Array {
    this.contentReads.push(path);
    return super.readFileBytesSync(path);
  }
}

function build(scale: Scale) {
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
  const read = (kind: Kind) =>
    vfs.handleFrame({
      type:
        kind === 'file'
          ? 'workbench:project-vfs-read-file'
          : 'workbench:project-vfs-read-directory',
      requestId: 'measure',
      path: `${root}/${kind === 'file' ? 'src/main.ts' : 'browse'}`,
    });
  return { scale, raw, authority, vfs, read, entryCount, last: () => result };
}
type Tree = ReturnType<typeof build>;

/** Mean ms per read over one batch; observation buffer cleared like every batch. */
function batch(tree: Tree, kind: Kind, reads: number): number {
  tree.raw.contentReads.length = 0;
  const start = performance.now();
  for (let i = 0; i < reads; i++) tree.read(kind);
  return (performance.now() - start) / reads;
}

async function measure() {
  // Both trees share one Worker/heap so runner and GC phases hit both sides.
  const trees = { small: build('small'), tracker: build('tracker') };
  const reads: Record<Scale, Record<Kind, string[]>> = {
    small: { file: [], directory: [] },
    tracker: { file: [], directory: [] },
  };
  const pairs: Record<Kind, { small: number; tracker: number }[]> = { file: [], directory: [] };
  const batchReads: Record<Kind, number> = { file: 0, directory: 0 };
  for (const kind of ['file', 'directory'] as const) {
    for (const tree of Object.values(trees)) {
      tree.read(kind);
      tree.raw.contentReads.length = 0;
      tree.read(kind);
      reads[tree.scale][kind] = [...tree.raw.contentReads];
      // Untimed warm-up: JIT tier-up must not land inside a timed batch.
      for (let i = 0; i < 300; i++) tree.read(kind);
    }
    // Batches long enough (>= 2 ms on the small tree) to dwarf the coarse COI clock.
    let n = 20;
    while (n < 100_000 && batch(trees.small, kind, n) * n < 2) n *= 2;
    batchReads[kind] = n;
    for (let pair = 0; pair < 21; pair++) {
      // Alternate order so neither side always runs first.
      const first = pair % 2 === 0 ? trees.small : trees.tracker;
      const second = first === trees.small ? trees.tracker : trees.small;
      const a = batch(first, kind, n);
      const b = batch(second, kind, n);
      pairs[kind].push(first === trees.small ? { small: a, tracker: b } : { small: b, tracker: a });
    }
  }
  const scales = [];
  for (const tree of Object.values(trees)) {
    tree.read('file');
    const file = tree.last();
    if (file?.type !== 'workbench:project-vfs-read-file-result' || !file.ok)
      throw new Error('file read failed');
    file.entry.content.fill(0);
    const isolated = tree.authority
      .readFileBytesSync(`${root}/src/main.ts`)
      .every((byte) => byte === 42);
    const fileVersion = file.entry.version;
    tree.authority.writeFileSync(`${root}/src/main.ts`, encoder.encode('edited'));
    tree.read('file');
    const edited = tree.last();
    tree.read('directory');
    const directory = tree.last();
    await tree.vfs.close();
    scales.push({
      scale: tree.scale,
      entryCount: tree.entryCount,
      reads: reads[tree.scale],
      isolated,
      fileVersion,
      edited,
      directory,
    });
  }
  return { scales, pairs, batchReads };
}

self.onmessage = () => {
  void measure().then(
    (result) => self.postMessage({ ok: true, result }),
    (error: unknown) => self.postMessage({ ok: false, error: String(error) }),
  );
};
