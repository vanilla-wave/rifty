import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import { installStampPath } from './install-stamp.ts';
import {
  type ProjectIndex,
  commitScratchProjectSave,
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

  it.each([
    {
      marker: 'no root marker (partial install)',
      seedMarker: () => undefined,
    },
    {
      marker: 'malformed root marker',
      seedMarker: (fs: ReturnType<typeof createMemoryFs>['fsSync']) => {
        fs.writeFileSync('/scratch/node_modules/.rifty-install-stamp.json', enc.encode('{broken'));
      },
    },
    {
      marker: 'valid marker for another project',
      seedMarker: (fs: ReturnType<typeof createMemoryFs>['fsSync']) => {
        fs.writeFileSync(
          '/scratch/node_modules/.rifty-install-stamp.json',
          enc.encode(
            JSON.stringify({
              version: 2,
              slug: 'another-project',
              packageJsonText: '{"dependencies":{"vite":"^5.4.0"}}',
              installArtifactIdentity: `sha256:${'0'.repeat(64)}`,
              deps: { vite: '^5.4.0' },
              packages: 1,
            }),
          ),
        );
      },
    },
    {
      marker: 'nested marker only',
      seedMarker: (fs: ReturnType<typeof createMemoryFs>['fsSync']) => {
        fs.mkdirSync('/scratch/node_modules/manual/node_modules', { recursive: true });
        fs.writeFileSync(
          '/scratch/node_modules/manual/node_modules/.rifty-install-stamp.json',
          enc.encode('{}'),
        );
      },
    },
  ])('never copies the node_modules namespace with $marker', ({ seedMarker }) => {
    const { fsSync } = createMemoryFs();
    seedScratch(fsSync, seedFilesForStarter(starterById('project-files'), '/scratch'));
    fsSync.mkdirSync('/scratch/node_modules/manual', { recursive: true });
    fsSync.writeFileSync('/scratch/node_modules/manual/index.js', enc.encode('partial'));
    seedMarker(fsSync);

    saveScratchAsProject(fsSync, scratchIndex(), 'proj-1', 'My App');

    expect(fsSync.existsSync(`${rootForId('proj-1')}/package.json`)).toBe(true);
    expect(fsSync.existsSync(`${rootForId('proj-1')}/node_modules`)).toBe(false);
  });

  it('still excludes node_modules when package revocation removed its root marker', () => {
    const { fsSync } = createMemoryFs();
    seedStampedScratch(fsSync);
    fsSync.rmSync('/scratch/node_modules/.rifty-install-stamp.json', { force: true });

    commitScratchProjectSave(fsSync, scratchIndex(), 'proj-1', 'My App');

    expect(fsSync.existsSync(`${rootForId('proj-1')}/package.json`)).toBe(true);
    expect(fsSync.existsSync(`${rootForId('proj-1')}/node_modules`)).toBe(false);
  });

  it('plans nested claim exclusion before applying any saved-project byte', () => {
    const { fsSync } = createMemoryFs();
    seedScratch(fsSync, seedFilesForStarter(starterById('project-files'), '/scratch'));
    fsSync.writeFileSync('/scratch/a.txt', enc.encode('a'));
    fsSync.mkdirSync('/scratch/src/node_modules', { recursive: true });
    fsSync.writeFileSync('/scratch/src/ordinary.txt', enc.encode('ordinary'));
    fsSync.writeFileSync(installStampPath('/scratch/src'), enc.encode('raw nested claim'));
    const { authority } = createOwnerVfsAuthorityComposition(fsSync, {
      ownerEpoch: 'project-save-nested-claim',
    });

    const next = commitScratchProjectSave(authority, scratchIndex(), 'proj-1', 'My App');

    expect(next.activeId).toBe('proj-1');
    expect(new TextDecoder().decode(authority.readFileBytesSync('/projects/proj-1/a.txt'))).toBe(
      'a',
    );
    expect(
      new TextDecoder().decode(authority.readFileBytesSync('/projects/proj-1/src/ordinary.txt')),
    ).toBe('ordinary');
    expect(authority.existsSync(installStampPath('/projects/proj-1/src'))).toBe(false);
  });

  it('omits nested node_modules after its package claim was already revoked', () => {
    const { fsSync } = createMemoryFs();
    seedScratch(fsSync, seedFilesForStarter(starterById('project-files'), '/scratch'));
    fsSync.mkdirSync('/scratch/packages/app/node_modules/pkg', { recursive: true });
    fsSync.writeFileSync('/scratch/packages/app/source.ts', enc.encode('ordinary source'));
    fsSync.writeFileSync(
      '/scratch/packages/app/node_modules/pkg/index.js',
      enc.encode('derived dependency'),
    );
    fsSync.writeFileSync(installStampPath('/scratch/packages/app'), enc.encode('claim'));
    fsSync.rmSync(installStampPath('/scratch/packages/app'), { force: true });

    commitScratchProjectSave(fsSync, scratchIndex(), 'proj-1', 'My App');

    expect(
      new TextDecoder().decode(fsSync.readFileBytesSync('/projects/proj-1/packages/app/source.ts')),
    ).toBe('ordinary source');
    expect(fsSync.existsSync('/projects/proj-1/packages/app/node_modules')).toBe(false);
  });
});
