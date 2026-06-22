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

function installAndStamp(
  fs: ReturnType<typeof createMemoryFs>['fsSync'],
  root: string,
  slug: string,
): void {
  fs.mkdirSync(`${root}/node_modules/vite`, { recursive: true });
  fs.writeFileSync(
    `${root}/package.json`,
    enc.encode(JSON.stringify({ name: 'a', dependencies: { vite: '^5.4.0' } })),
  );
  fs.writeFileSync(
    `${root}/node_modules/.rifty-install-stamp.json`,
    enc.encode(
      `${JSON.stringify({ version: 1, slug, deps: { vite: '^5.4.0' }, packages: 14 }, null, 2)}\n`,
    ),
  );
}

describe('node_modules isolation per-root (ADR-0165 §5) — same starter, no cross-contamination', () => {
  it('a saved project keeps its tree; a fresh same-starter scratch starts empty', async () => {
    const { vfs, fsSync } = createMemoryFs();

    // 1. scratch from a vite starter, installed + scratch-stamped.
    seedScratch(fsSync, seedFilesForStarter(starterById('project-files'), rootForId('scratch')));
    installAndStamp(fsSync, rootForId('scratch'), 'scratch');

    // 2. Save → /projects/p1, slug re-keyed (Task 4).
    const index: ProjectIndex = {
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: false, editedAt: 't0' },
      projects: [],
    };
    saveScratchAsProject(fsSync, index, 'p1', 'P1');

    // 3. A NEW scratch from the SAME starter (no node_modules — never installed).
    seedScratch(fsSync, seedFilesForStarter(starterById('project-files'), rootForId('scratch')));

    // p1's tree is intact + reusable under its own slug.
    expect((await installStampSatisfied(vfs, rootForId('p1'), 'p1'))?.packages).toBe(14);
    // The fresh scratch has NO stamp → it would install from scratch, not reuse p1's.
    expect(fsSync.existsSync(`${rootForId('scratch')}/node_modules`)).toBe(false);
    expect(await installStampSatisfied(vfs, rootForId('scratch'), 'scratch')).toBeNull();
    // Cross-check: p1's tree must never satisfy scratch's slug at the scratch root.
    expect(await installStampSatisfied(vfs, rootForId('scratch'), 'p1')).toBeNull();
  });
});
