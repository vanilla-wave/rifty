import { type MemoryFsSync, resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { createPlaygroundProjectCatalog } from '../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../workbench/internal/playground-project-definition.ts';
import type { VitePlaygroundPlan } from '../workbench/playground.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import { createPlaygroundProjectAuthority } from './playground-project-authority.ts';
import { type DurableOwnerFault, DurableOwnerFs } from './test-fixtures/durable-owner-fs.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const EDITED_AT = '2026-09-09T12:00:00.000Z';
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
const SCRATCH_TREE = '/.rifty/workbench/v1/projects/scratch/tree';
const SCRATCH_CONTAINER = '/.rifty/workbench/v1/projects/scratch';
const ORPHAN_TEXT = 'orphan bytes';

function definition() {
  const plan: VitePlaygroundPlan = {
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
  return definePlaygroundProject(plan, CAPTURED_URL_CONTEXT);
}

function plantUnjournaledOrphan(fs: MemoryFsSync): void {
  fs.mkdirSync(SCRATCH_TREE, { recursive: true });
  fs.writeFileSync(`${SCRATCH_TREE}/user.txt`, encoder.encode(ORPHAN_TEXT));
}

async function harness(fs: DurableOwnerFs) {
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: 'orphan-scratch-recovery-fault-owner',
    initialRoots: ['/', '/.rifty'],
  });
  let stageSequence = 0;
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => EDITED_AT,
    createStageId: () => `orphan-fault-stage-${String(++stageSequence)}`,
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
    catalog: createPlaygroundProjectCatalog(owner),
  };
}

afterEach(() => {
  resetSyncMirror();
});

describe('orphan Scratch preserve faults (I6)', () => {
  it.each(['quota-report', 'permission-rejection'] as const)(
    'failed %s preserve leaves the only copy and does not claim fresh Scratch',
    async (fault: DurableOwnerFault) => {
      const fs = new DurableOwnerFs();
      const h = await harness(fs);
      plantUnjournaledOrphan(h.fs);
      const setupFlush = await h.authority.flush();
      expect(setupFlush?.total ?? 0).toBe(0);
      fs.armPersistFailure(1, fault);

      let error: unknown;
      try {
        await h.catalog.createScratch({ definition: definition() });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toMatch(/already exists/i);
      expect(message).toMatch(
        fault === 'permission-rejection' ? /permission/i : /quota|persistence/i,
      );
      expect(decoder.decode(h.authority.readFileBytesSync(`${SCRATCH_TREE}/user.txt`))).toBe(
        ORPHAN_TEXT,
      );
      expect(h.fs.existsSync(SCRATCH_CONTAINER)).toBe(true);
      expect(h.catalog.snapshot()).toEqual({ active: null, scratch: null, projects: [] });
      expect(h.fs.existsSync('/.rifty/workbench/v1/retained-orphans')).toBe(false);
      await h.owner.close();
    },
  );
});
