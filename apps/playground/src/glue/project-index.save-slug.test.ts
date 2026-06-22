import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { installStampSatisfied } from './install-stamp.ts';
import {
  type ProjectIndex,
  rootForId,
  saveScratchAsProject,
  seedScratch,
} from './project-index.ts';
// Canonical seeding per Cross-Phase Reconciliation A/B: seedScratch is 2-arg in
// project-index.ts (the caller computes files via seedFilesForStarter), and the
// Starter map lives in starter.ts — NOT a project-lifecycle.ts with seedScratch(fs,id).
import { seedFilesForStarter, starterById } from './starter.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function seedStampedScratch(fs: ReturnType<typeof createMemoryFs>['fsSync']): void {
  seedScratch(fs, seedFilesForStarter(starterById('project-files'), '/scratch'));
  // Simulate an installed + scratch-stamped node_modules.
  fs.mkdirSync('/scratch/node_modules/vite', { recursive: true });
  fs.writeFileSync(
    '/scratch/node_modules/.rifty-install-stamp.json',
    enc.encode(
      `${JSON.stringify({ version: 1, slug: 'scratch', deps: { vite: '^5.4.0' }, packages: 14 }, null, 2)}\n`,
    ),
  );
  // package.json deps must match the stamp for installStampSatisfied to hit.
  fs.writeFileSync(
    '/scratch/package.json',
    enc.encode(JSON.stringify({ name: 'a', dependencies: { vite: '^5.4.0' } })),
  );
}

describe('saveScratchAsProject — install-stamp re-keyed on the move (ADR-0165)', () => {
  it('moves /scratch→/projects/<id>, flips the pointer last, re-stamps slug=<id>', async () => {
    const { vfs, fsSync } = createMemoryFs();
    seedStampedScratch(fsSync);
    const index: ProjectIndex = {
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: true, editedAt: 't0' },
      projects: [],
    };

    const next = saveScratchAsProject(fsSync, index, 'proj-1', 'My App');

    // Pointer flipped + source deleted.
    expect(next.activeId).toBe('proj-1');
    expect(next.scratch).toBeNull();
    expect(next.projects.map((p) => p.id)).toEqual(['proj-1']);
    expect(fsSync.existsSync('/scratch')).toBe(false);
    expect(fsSync.existsSync(`${rootForId('proj-1')}/package.json`)).toBe(true);

    // The MOVED tree's stamp now carries slug=proj-1 → the next boot reuses it.
    expect(
      dec.decode(
        fsSync.readFileBytesSync(`${rootForId('proj-1')}/node_modules/.rifty-install-stamp.json`),
      ),
    ).toContain('"slug": "proj-1"');
    expect((await installStampSatisfied(vfs, rootForId('proj-1'), 'proj-1'))?.packages).toBe(14);
    // The old scratch slug no longer satisfies the moved root.
    expect(await installStampSatisfied(vfs, rootForId('proj-1'), 'scratch')).toBeNull();
  });
});
