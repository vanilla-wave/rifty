import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
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
  // package.json deps match the stamp: this is a real installed scratch tree.
  fs.writeFileSync(
    '/scratch/package.json',
    enc.encode(JSON.stringify({ name: 'a', dependencies: { vite: '^5.4.0' } })),
  );
}

function scratchIndex(): ProjectIndex {
  return {
    activeId: 'scratch',
    scratch: { starter: 'project-files', dirty: true, editedAt: 't0' },
    projects: [],
  };
}

describe('saveScratchAsProject — derived deps are restored, not moved (ADR-0165)', () => {
  it('copies scratch, skips stamped node_modules, flips the pointer last', async () => {
    const { vfs, fsSync } = createMemoryFs();
    seedStampedScratch(fsSync);

    const next = saveScratchAsProject(fsSync, scratchIndex(), 'proj-1', 'My App');

    // Pointer flipped + source deleted.
    expect(next.activeId).toBe('proj-1');
    expect(next.scratch).toBeNull();
    expect(next.projects.map((p) => p.id)).toEqual(['proj-1']);
    expect(fsSync.existsSync('/scratch')).toBe(false);
    expect(fsSync.existsSync(`${rootForId('proj-1')}/package.json`)).toBe(true);

    // Stamped deps are derived from the baked/install snapshot and restored on
    // the next owner boot; Save must not block copying tens of MB here.
    expect(fsSync.existsSync(`${rootForId('proj-1')}/node_modules`)).toBe(false);
    expect(fsSync.existsSync(`${rootForId('proj-1')}/node_modules/.rifty-install-stamp.json`)).toBe(
      false,
    );
    await expect(vfs.stat(`${rootForId('proj-1')}/node_modules`)).rejects.toThrow(/ENOENT/);
  });

  it('still copies an unstamped user-created node_modules tree', () => {
    const { fsSync } = createMemoryFs();
    seedScratch(fsSync, seedFilesForStarter(starterById('project-files'), '/scratch'));
    fsSync.mkdirSync('/scratch/node_modules/manual', { recursive: true });
    fsSync.writeFileSync('/scratch/node_modules/manual/index.js', enc.encode('manual'));

    saveScratchAsProject(fsSync, scratchIndex(), 'proj-1', 'My App');

    expect(fsSync.existsSync(`${rootForId('proj-1')}/node_modules/manual/index.js`)).toBe(true);
  });
});
