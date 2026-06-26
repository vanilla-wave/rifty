import { describe, expect, it } from 'vitest';
import { INDEX_PATH, rootForId } from './project-index.ts';

describe('rootForId (ADR-0165 §2/§4)', () => {
  it("maps 'scratch' to /scratch", () => {
    expect(rootForId('scratch')).toBe('/scratch');
  });
  it('maps a project id to /projects/<id>', () => {
    expect(rootForId('p-abc')).toBe('/projects/p-abc');
  });
});

describe('INDEX_PATH', () => {
  it('is the index json under base', () => {
    expect(INDEX_PATH('/')).toBe('/.rifty-project-index.json');
    expect(INDEX_PATH('/data')).toBe('/data/.rifty-project-index.json');
  });
});

import { MemoryFsSync } from '@riftydev/vfs/internal';
import {
  INDEX_PATH as IDX_PATH,
  cleanupCommittedScratchSource,
  loadIndex,
  writeIndex,
} from './project-index.ts';

const enc = new TextEncoder();
const BASE = '/';
const EMPTY = { activeId: 'scratch', scratch: null, projects: [] };

describe('loadIndex / writeIndex (ADR-0165 §2)', () => {
  it('returns the empty default when the index is absent', () => {
    const fs = new MemoryFsSync();
    expect(loadIndex(fs, BASE)).toEqual(EMPTY);
  });

  it('THROWS loud on corrupt index JSON (never a silent default)', () => {
    const fs = new MemoryFsSync();
    fs.writeFileSync(IDX_PATH(BASE), enc.encode('{not json'));
    expect(() => loadIndex(fs, BASE)).toThrow(/corrupt project index/i);
  });

  it('round-trips a written index (write-through, readable immediately)', () => {
    const fs = new MemoryFsSync();
    const index = {
      activeId: 'p-1',
      scratch: { starter: 'project-files', dirty: true, editedAt: '2026-06-21T00:00:00.000Z' },
      projects: [
        { id: 'p-1', name: 'My App', starter: 'real-vite', editedAt: '2026-06-21T00:00:00.000Z' },
      ],
    };
    writeIndex(fs, BASE, index);
    expect(fs.existsSync(IDX_PATH(BASE))).toBe(true);
    expect(loadIndex(fs, BASE)).toEqual(index);
  });

  it('rejects a structurally invalid (non-array projects) index as corrupt', () => {
    const fs = new MemoryFsSync();
    fs.writeFileSync(
      IDX_PATH(BASE),
      enc.encode(JSON.stringify({ activeId: 'scratch', scratch: null, projects: {} })),
    );
    expect(() => loadIndex(fs, BASE)).toThrow(/corrupt project index/i);
  });

  it('rejects a project-active index whose activeId is absent from projects', () => {
    const fs = new MemoryFsSync();
    fs.writeFileSync(
      IDX_PATH(BASE),
      enc.encode(JSON.stringify({ activeId: 'p-missing', scratch: null, projects: [] })),
    );
    expect(() => loadIndex(fs, BASE)).toThrow(/activeId.*missing project/i);
  });
});

import { rootForId as rootFor, saveScratchAsProject } from './project-index.ts';

function seedScratchTree(fs: MemoryFsSync): void {
  fs.mkdirSync('/scratch/src', { recursive: true });
  fs.writeFileSync('/scratch/src/main.js', enc.encode('console.log(1)'));
  fs.writeFileSync('/scratch/package.json', enc.encode('{"name":"app"}'));
}

describe('saveScratchAsProject (ADR-0165 §7 — copy → flip LAST → delete)', () => {
  it('converts /scratch into /projects/<id>, flips activeId, drops scratch', () => {
    const fs = new MemoryFsSync();
    seedScratchTree(fs);
    const index = {
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: true, editedAt: '2026-06-21T00:00:00.000Z' },
      projects: [],
    };
    const next = saveScratchAsProject(fs, index, 'p-7', 'My App');

    // tree MOVED: source gone, dst carries the files
    expect(fs.existsSync('/scratch')).toBe(false);
    expect(new TextDecoder().decode(fs.readFileBytesSync('/projects/p-7/src/main.js'))).toBe(
      'console.log(1)',
    );
    // index: project pushed, activeId flipped, scratch cleared
    expect(next.activeId).toBe('p-7');
    expect(next.scratch).toBeNull();
    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]).toMatchObject({ id: 'p-7', name: 'My App', starter: 'project-files' });
    expect(rootFor(next.activeId)).toBe('/projects/p-7');
  });

  it('persists the flipped index to disk (durable before return)', () => {
    const fs = new MemoryFsSync();
    seedScratchTree(fs);
    const index = {
      activeId: 'scratch',
      scratch: { starter: 'real-vite', dirty: true, editedAt: '2026-06-21T00:00:00.000Z' },
      projects: [],
    };
    saveScratchAsProject(fs, index, 'p-7', 'My App');
    expect(loadIndex(fs, '/').activeId).toBe('p-7'); // index written under base='/'
  });

  it('THROWS on a duplicate project id (no clobber of an existing tree)', () => {
    const fs = new MemoryFsSync();
    seedScratchTree(fs);
    fs.mkdirSync('/projects/p-7', { recursive: true });
    const index = {
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: true, editedAt: '2026-06-21T00:00:00.000Z' },
      projects: [
        { id: 'p-7', name: 'Old', starter: 'project-files', editedAt: '2026-06-20T00:00:00.000Z' },
      ],
    };
    expect(() => saveScratchAsProject(fs, index, 'p-7', 'Dup')).toThrow(/already exists/i);
  });

  it('THROWS when there is no scratch to save', () => {
    const fs = new MemoryFsSync();
    const index = { activeId: 'scratch', scratch: null, projects: [] };
    expect(() => saveScratchAsProject(fs, index, 'p-7', 'X')).toThrow(/no scratch/i);
  });
});

import { recoverIndex } from './project-index.ts';

function tree(fs: MemoryFsSync, root: string, marker: string): void {
  fs.mkdirSync(`${root}/src`, { recursive: true });
  fs.writeFileSync(`${root}/src/main.js`, enc.encode(marker));
}

describe('recoverIndex (ADR-0165 §7 — boot-time half-move reconcile)', () => {
  it('clean state returns the index unchanged', () => {
    const fs = new MemoryFsSync();
    tree(fs, '/scratch', 's');
    const index = {
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: false, editedAt: '2026-06-21T00:00:00.000Z' },
      projects: [],
    };
    writeIndex(fs, '/', index);
    expect(recoverIndex(fs, '/')).toEqual(index);
  });

  it('CRASH AFTER copy, BEFORE flip: orphan /projects/<id> not in the index → rolled back (deleted)', () => {
    // disk: /scratch + /projects/p-9 both present; index still points at scratch, no p-9 entry.
    const fs = new MemoryFsSync();
    tree(fs, '/scratch', 's');
    tree(fs, '/projects/p-9', 's-copy');
    const index = {
      activeId: 'scratch',
      scratch: { starter: 'project-files', dirty: true, editedAt: '2026-06-21T00:00:00.000Z' },
      projects: [],
    };
    writeIndex(fs, '/', index);
    const recovered = recoverIndex(fs, '/');
    expect(fs.existsSync('/projects/p-9')).toBe(false); // orphan rolled back
    expect(recovered).toEqual(index); // index untouched
  });

  it('CRASH AFTER flip, BEFORE delete: index has the project + scratch tree lingers → finish the delete', () => {
    // disk: /projects/p-9 (committed) AND a stale /scratch; index already lists p-9 + activeId=p-9, scratch=null.
    const fs = new MemoryFsSync();
    tree(fs, '/projects/p-9', 's-copy');
    tree(fs, '/scratch', 'stale');
    const index = {
      activeId: 'p-9',
      scratch: null,
      projects: [
        {
          id: 'p-9',
          name: 'My App',
          starter: 'project-files',
          editedAt: '2026-06-21T00:00:00.000Z',
        },
      ],
    };
    writeIndex(fs, '/', index);
    const recovered = recoverIndex(fs, '/');
    expect(fs.existsSync('/scratch')).toBe(false); // stale source removed
    expect(recovered).toEqual(index); // committed index stands
  });

  it('deferred committed-save cleanup does not delete a fresh active scratch', () => {
    const fs = new MemoryFsSync();
    tree(fs, '/scratch', 'fresh');
    const index = {
      activeId: 'scratch',
      scratch: { starter: 'node-worker', dirty: false, editedAt: 'new scratch' },
      projects: [
        {
          id: 'p-9',
          name: 'My App',
          starter: 'project-files',
          editedAt: '2026-06-21T00:00:00.000Z',
        },
      ],
    };

    cleanupCommittedScratchSource(fs, index);

    expect(fs.existsSync('/scratch')).toBe(true);
  });

  it('THROWS loud when the index points at a project whose tree is ABSENT (data loss, never silent)', () => {
    const fs = new MemoryFsSync();
    const index = {
      activeId: 'p-9',
      scratch: null,
      projects: [
        { id: 'p-9', name: 'Gone', starter: 'project-files', editedAt: '2026-06-21T00:00:00.000Z' },
      ],
    };
    writeIndex(fs, '/', index);
    expect(() => recoverIndex(fs, '/')).toThrow(/project p-9 .*missing|missing.*p-9/i);
  });
});

import { resetProjectToStarter, resetScratchToStarter, seedScratch } from './project-index.ts';
import { seedFilesForStarter, starterById } from './starter.ts';

// Canonical signature per Cross-Phase Reconciliation A/B:
// seedFilesForStarter(starter, root) returns ABSOLUTE paths under `root`
// (e.g. /scratch/src/main.js); seedScratch/resetScratchToStarter consume those
// already-rooted files directly (no re-prefix). Adapted from the task's stale
// single-arg/relative-path form (the real starter.ts forces (starter, root)).
describe('seedScratch / resetScratchToStarter (ADR-0165 §6)', () => {
  it('seedScratch writes the starter bundle under /scratch (idempotent: keeps an existing file)', () => {
    const fs = new MemoryFsSync();
    const files = seedFilesForStarter(starterById('project-files'), '/scratch');
    seedScratch(fs, files);
    // entry written under /scratch
    expect(fs.existsSync('/scratch/src/main.js')).toBe(true);
    // idempotency: a user edit is preserved on a second seed
    fs.writeFileSync('/scratch/src/main.js', enc.encode('user-edit'));
    seedScratch(fs, files);
    expect(new TextDecoder().decode(fs.readFileBytesSync('/scratch/src/main.js'))).toBe(
      'user-edit',
    );
  });

  it('resetScratchToStarter REPLACES the whole /scratch tree from the bundle (one-shot re-seed)', () => {
    const fs = new MemoryFsSync();
    const files = seedFilesForStarter(starterById('project-files'), '/scratch');
    seedScratch(fs, files);
    fs.writeFileSync('/scratch/src/main.js', enc.encode('user-edit'));
    fs.writeFileSync('/scratch/stray.txt', enc.encode('orphan'));
    resetScratchToStarter(fs, files);
    // user edit reverted to baseline, stray file gone (whole-workspace reset)
    expect(new TextDecoder().decode(fs.readFileBytesSync('/scratch/src/main.js'))).toBe(
      files['/scratch/src/main.js'],
    );
    expect(fs.existsSync('/scratch/stray.txt')).toBe(false);
  });

  it('resetProjectToStarter REPLACES the whole /projects/<id> tree from the bundle (ADR-0165 §6, named project)', () => {
    const fs = new MemoryFsSync();
    const files = seedFilesForStarter(starterById('project-files'), '/projects/p-1');
    seedScratch(fs, files); // seed under /projects/p-1 (paths are already rooted there)
    fs.writeFileSync('/projects/p-1/src/main.js', enc.encode('user-edit'));
    fs.writeFileSync('/projects/p-1/stray.txt', enc.encode('orphan'));
    fs.mkdirSync('/projects/p-1/node_modules/x', { recursive: true });
    resetProjectToStarter(fs, 'p-1', files);
    // user edit reverted, stray file + node_modules gone (whole-tree reset → clean re-install)
    expect(new TextDecoder().decode(fs.readFileBytesSync('/projects/p-1/src/main.js'))).toBe(
      files['/projects/p-1/src/main.js'],
    );
    expect(fs.existsSync('/projects/p-1/stray.txt')).toBe(false);
    expect(fs.existsSync('/projects/p-1/node_modules')).toBe(false);
  });
});

import { reconcileOwnerIndexAtBoot } from './project-index.ts';

describe('reconcileOwnerIndexAtBoot (ADR-0165 §7 — owner boot reconcile + scratch synthesis)', () => {
  it('synthesizes+persists a scratch entry when /scratch exists but the index is a cold-boot empty', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/scratch', { recursive: true });
    fs.writeFileSync('/scratch/marker.txt', enc.encode('hi'));
    // cold-boot empty index (no writeIndex yet) → loadIndex returns the EMPTY_INDEX.
    const result = reconcileOwnerIndexAtBoot(fs, 'node-worker');
    expect(result.scratch).toMatchObject({ starter: 'node-worker', dirty: false });
    // persisted to disk so saveScratchAsProject's precondition holds across a re-load.
    expect(loadIndex(fs, '/').scratch).toMatchObject({ starter: 'node-worker', dirty: false });
    // and now a Save's precondition holds (no throw).
    expect(() => saveScratchAsProject(fs, loadIndex(fs, '/'), 'p-x', 'X')).not.toThrow();
  });

  it('leaves a project-active spawn (already-indexed) untouched — never overwrites a published scratch', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/projects/p-1', { recursive: true });
    writeIndex(fs, '/', {
      activeId: 'p-1',
      scratch: null,
      projects: [{ id: 'p-1', name: 'A', starter: 'project-files', editedAt: 'x' }],
    });
    const result = reconcileOwnerIndexAtBoot(fs, 'node-worker');
    expect(result.activeId).toBe('p-1');
    expect(result.scratch).toBeNull(); // no synthesis on a project spawn
  });

  it('finishes a half-completed Save (recoverIndex: stale /scratch after a committed flip)', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/projects/p-1/src', { recursive: true });
    fs.writeFileSync('/projects/p-1/src/main.js', enc.encode('saved'));
    fs.mkdirSync('/scratch', { recursive: true }); // stale source left by a crash before delete
    writeIndex(fs, '/', {
      activeId: 'p-1',
      scratch: null,
      projects: [{ id: 'p-1', name: 'A', starter: 'project-files', editedAt: 'x' }],
    });
    reconcileOwnerIndexAtBoot(fs, 'project-files');
    expect(fs.existsSync('/scratch')).toBe(false); // recoverIndex finished the delete
  });
});

import { MemoryBackend } from '@riftydev/vfs/internal';

describe('index survives a reload (OPFS source of truth proxy)', () => {
  it('a fresh sync mirror over the same backend reads the committed Save', () => {
    const backend = new MemoryBackend();
    const session1 = new MemoryFsSync(backend);
    // session 1: seed scratch + save it
    session1.mkdirSync('/scratch/src', { recursive: true });
    session1.writeFileSync('/scratch/src/main.js', enc.encode('reload-me'));
    saveScratchAsProject(
      session1,
      {
        activeId: 'scratch',
        scratch: { starter: 'project-files', dirty: true, editedAt: '2026-06-21T00:00:00.000Z' },
        projects: [],
      },
      'p-keep',
      'Kept',
    );

    // session 2: a NEW mirror over the SAME backend = the reload.
    const session2 = new MemoryFsSync(backend);
    const reloaded = recoverIndex(session2, '/');
    expect(reloaded.activeId).toBe('p-keep');
    expect(reloaded.projects.map((p) => p.id)).toEqual(['p-keep']);
    expect(
      new TextDecoder().decode(session2.readFileBytesSync('/projects/p-keep/src/main.js')),
    ).toBe('reload-me');
    expect(session2.existsSync('/scratch')).toBe(false);
  });
});
