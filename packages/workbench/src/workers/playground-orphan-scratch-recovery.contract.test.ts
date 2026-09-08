import { MemoryFsSync, resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { createPlaygroundProjectCatalog } from '../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../workbench/internal/playground-project-definition.ts';
import type { PlaygroundProjectCatalog, VitePlaygroundPlan } from '../workbench/playground.ts';
import type { ProjectDefinition } from '../workbench/public.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import { createPlaygroundProjectAuthority } from './playground-project-authority.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const EDITED_AT = '2026-09-09T12:00:00.000Z';
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
const SCRATCH_TREE = '/.rifty/workbench/v1/projects/scratch/tree';
const ORPHAN_BYTES = encoder.encode('orphan bytes');
const NESTED_BYTES = encoder.encode('nested orphan');
const DEP_BYTES = encoder.encode('module.exports = 1;\n');

interface PlaygroundRetainedOrphan {
  readonly id: string;
  readonly retainedAt: string;
}

interface PlaygroundRetainedOrphanEntry {
  readonly path: string;
}

type RetainedOrphanCatalog = PlaygroundProjectCatalog & {
  listRetainedOrphans(): Promise<readonly PlaygroundRetainedOrphan[]>;
  listRetainedOrphanEntries(id: string): Promise<readonly PlaygroundRetainedOrphanEntry[]>;
  readRetainedOrphanFile(id: string, path: string): Promise<Uint8Array>;
};

function plan(): VitePlaygroundPlan {
  return {
    kind: 'vite',
    id: 'scratch',
    starterId: 'starter-a',
    templateId: 'vite-template-v1',
    files: {
      '/index.html': '<main>orphan recovery</main>\n',
      '/package.json': '{"scripts":{"dev":"vite"},"devDependencies":{"vite":"8.0.0"}}\n',
      '/src/main.ts': 'document.body.dataset.ready = "yes";\n',
    },
    devDependencies: { vite: '8.0.0' },
    port: 5173,
    firstMaterialization: { kind: 'install' },
  };
}

function definition(): ProjectDefinition<unknown> {
  return definePlaygroundProject(plan(), CAPTURED_URL_CONTEXT);
}

function plantUnjournaledOrphan(fs: MemoryFsSync): void {
  fs.mkdirSync(`${SCRATCH_TREE}/src`, { recursive: true });
  fs.mkdirSync(`${SCRATCH_TREE}/node_modules/pkg`, { recursive: true });
  fs.writeFileSync(`${SCRATCH_TREE}/user.txt`, ORPHAN_BYTES);
  fs.writeFileSync(`${SCRATCH_TREE}/src/note.txt`, NESTED_BYTES);
  fs.writeFileSync(`${SCRATCH_TREE}/node_modules/pkg/index.js`, DEP_BYTES);
}

async function harness(fs = new MemoryFsSync()) {
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: 'orphan-scratch-recovery-owner',
    initialRoots: ['/', '/.rifty'],
  });
  let stageSequence = 0;
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => EDITED_AT,
    createStageId: () => `orphan-stage-${String(++stageSequence)}`,
    acquisition: Object.freeze({
      ensure: async () => Object.freeze({ kind: 'install' as const, snapshotFailures: [] }),
    }),
    projectSave: {
      projectSave: async (_input, run) => run(async () => ({ status: 'untrusted' })),
    },
  });
  return {
    fs,
    authority: composition.authority,
    owner,
    catalog: createPlaygroundProjectCatalog(owner) as RetainedOrphanCatalog,
  };
}

afterEach(() => {
  resetSyncMirror();
});

describe('orphan Scratch retain/download (I6)', () => {
  it('exposes retain methods on an empty catalog without creating files', async () => {
    const h = await harness();
    await expect(h.catalog.listRetainedOrphans()).resolves.toEqual([]);
    await expect(h.catalog.listRetainedOrphanEntries('orphan-scratch-missing')).rejects.toThrow(
      /orphan-scratch-missing|absent|unknown/i,
    );
    await expect(
      h.catalog.readRetainedOrphanFile('orphan-scratch-missing', 'user.txt'),
    ).rejects.toThrow(/orphan-scratch-missing|absent|unknown/i);
    expect(h.fs.existsSync('/.rifty/workbench/v1/retained-orphans')).toBe(false);
    expect(h.catalog.snapshot()).toEqual({ active: null, scratch: null, projects: [] });
    await h.owner.close();
  });

  it('retains unjournaled Scratch bytes and opens a fresh starter Scratch', async () => {
    const fs = new MemoryFsSync();
    plantUnjournaledOrphan(fs);
    const h = await harness(fs);

    const snapshot = await h.catalog.createScratch({ definition: definition() });
    expect(snapshot.scratch).toMatchObject({ starterId: 'starter-a', dirty: false });
    expect(snapshot.projects).toEqual([]);
    expect(h.fs.existsSync(`${SCRATCH_TREE}/user.txt`)).toBe(false);
    expect(decoder.decode(h.authority.readFileBytesSync(`${SCRATCH_TREE}/src/main.ts`))).toContain(
      'dataset.ready',
    );

    const orphans = await h.catalog.listRetainedOrphans();
    expect(orphans).toHaveLength(1);
    const id = orphans[0]?.id;
    expect(id).toMatch(/^orphan-scratch-/);
    expect(orphans[0]?.retainedAt).toBe(EDITED_AT);

    const entries = await h.catalog.listRetainedOrphanEntries(id as string);
    const paths = entries.map((entry) => entry.path).sort();
    expect(paths).toEqual(['node_modules/pkg/index.js', 'src/note.txt', 'user.txt']);

    expect(await h.catalog.readRetainedOrphanFile(id as string, 'user.txt')).toEqual(ORPHAN_BYTES);
    expect(await h.catalog.readRetainedOrphanFile(id as string, 'src/note.txt')).toEqual(
      NESTED_BYTES,
    );
    expect(
      await h.catalog.readRetainedOrphanFile(id as string, 'node_modules/pkg/index.js'),
    ).toEqual(DEP_BYTES);
    await h.owner.close();
  });

  it('keeps retained bytes after close and reopen on the same VFS', async () => {
    const fs = new MemoryFsSync();
    plantUnjournaledOrphan(fs);
    const first = await harness(fs);
    await first.catalog.createScratch({ definition: definition() });
    const orphans = await first.catalog.listRetainedOrphans();
    const id = orphans[0]?.id as string;
    await first.owner.close();

    const second = await harness(fs);
    await expect(second.catalog.listRetainedOrphans()).resolves.toEqual([
      { id, retainedAt: EDITED_AT },
    ]);
    expect(await second.catalog.readRetainedOrphanFile(id, 'user.txt')).toEqual(ORPHAN_BYTES);
    await second.owner.close();
  });

  it('retries a failed download without consuming saved bytes', async () => {
    const fs = new MemoryFsSync();
    plantUnjournaledOrphan(fs);
    const h = await harness(fs);
    await h.catalog.createScratch({ definition: definition() });
    const id = (await h.catalog.listRetainedOrphans())[0]?.id as string;

    await expect(h.catalog.readRetainedOrphanFile(id, '..')).rejects.toThrow(
      /path|TypeError|\.\./i,
    );
    await expect(h.catalog.readRetainedOrphanFile(id, 'missing.txt')).rejects.toThrow();
    expect(await h.catalog.readRetainedOrphanFile(id, 'user.txt')).toEqual(ORPHAN_BYTES);
    expect(await h.catalog.readRetainedOrphanFile(id, 'user.txt')).toEqual(ORPHAN_BYTES);
    await h.owner.close();
  });
});
