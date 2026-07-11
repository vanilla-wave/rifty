/**
 * Behavioral contract of the owner-backed SCM core (ADR-0197 slice 4,
 * ADR-0185) — replaces the App.test.ts source-greps for the git-status feed,
 * GIT panel reads, side-aware diffs, explorer compares and GIT actions.
 * Ports per ADR-0197 §4; the git port is the structural GitOwnerClient subset.
 */
import type { LogEntry } from '@riftydev/git';
import {
  type FileReadOwnerLike,
  type OwnerFileReader,
  createOwnerFileReader,
} from '@riftydev/workbench';
import { describe, expect, it, vi } from 'vitest';
import type { ScmResourceRow } from '../glue/scm-status.ts';
import {
  type Scm,
  type ScmGitPort,
  type ScmStatusFrame,
  createScm,
  decodeTextBlob,
} from './scm.ts';

const enc = new TextEncoder();

class FakeOwner implements FileReadOwnerLike {
  alive = true;
  files = new Map<string, Uint8Array>();
  constructor(
    readonly root: string,
    readonly snapshotPort: unknown = 1,
  ) {}
  isAlive(): boolean {
    return this.alive;
  }
  async readFileBytes(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`ENOENT ${path}`);
    return bytes;
  }
}

class FakeGit implements ScmGitPort {
  disposed = 0;
  log_: LogEntry[] = [];
  branch: string | undefined = 'main';
  blobs = new Map<string, Uint8Array>(); // rev → content
  statusEntries: Array<{ filepath: string; status: unknown }> = [];
  actions: string[] = [];
  failBranch = false;
  async show(rev: string): Promise<{ type: 'blob'; oid: string; content: Uint8Array }> {
    const content = this.blobs.get(rev);
    if (!content) throw new Error(`unknown rev ${rev}`);
    return { type: 'blob', oid: `oid-${rev}`, content };
  }
  async status(): Promise<never[]> {
    return this.statusEntries as never[];
  }
  async log(): Promise<readonly LogEntry[]> {
    return this.log_;
  }
  async currentBranch(): Promise<string | undefined> {
    if (this.failBranch) throw new Error('no repo');
    return this.branch;
  }
  async add(filepath: string): Promise<void> {
    this.actions.push(`add:${filepath}`);
  }
  async remove(filepath: string): Promise<void> {
    this.actions.push(`remove:${filepath}`);
  }
  async unstage(filepath: string): Promise<void> {
    this.actions.push(`unstage:${filepath}`);
  }
  async restore(pathspecs: readonly string[]): Promise<never> {
    this.actions.push(`restore:${pathspecs.join(',')}`);
    return undefined as never;
  }
  async commitResolvedIdentity(input: { message: string }): Promise<string> {
    this.actions.push(`commit:${input.message}`);
    return 'abcdef1234567890';
  }
  dispose(): void {
    this.disposed += 1;
  }
}

class Harness {
  owner = new FakeOwner('/scratch');
  git = new FakeGit();
  statusCbs: Array<(frame: ScmStatusFrame) => void> = [];
  unsubscribed = 0;
  statusRequests = 0;
  vfsRequests = 0;
  flushes = 0;
  confirmAnswer = true;
  confirms: string[] = [];
  errors: string[] = [];
  successes: string[] = [];
  textDiffs: Array<Record<string, unknown>> = [];
  workingDiffs: Array<Record<string, unknown>> = [];
  closedPaths: string[] = [];
  activeRoot = '/scratch';

  scm(): Scm<FakeOwner> {
    const reader: OwnerFileReader<FakeOwner> = createOwnerFileReader<FakeOwner>({
      currentOwner: () => this.owner,
      ownerUnavailable: (owner) => owner.snapshotPort === -1,
    });
    return createScm<FakeOwner>({
      currentOwner: () => this.owner,
      ownerUnavailable: (owner) => owner.snapshotPort === -1,
      reader,
      bridgeGit: () => this.git,
      subscribeStatus: (_owner, cb) => {
        this.statusCbs.push(cb);
        return () => {
          this.statusCbs = this.statusCbs.filter((c) => c !== cb);
          this.unsubscribed += 1;
        };
      },
      requestStatus: () => {
        this.statusRequests += 1;
      },
      requestVfsSnapshot: () => {
        this.vfsRequests += 1;
      },
      joinRootPath: (root, path) => `${root}/${path}`,
      editor: {
        openTextDiff: (spec) => this.textDiffs.push(spec as unknown as Record<string, unknown>),
        openWorkingDiff: (spec) =>
          this.workingDiffs.push(spec as unknown as Record<string, unknown>),
        closePath: (path) => this.closedPaths.push(path),
      },
      flushEditorWrites: async () => {
        this.flushes += 1;
      },
      confirmDiscard: (message) => {
        this.confirms.push(message);
        return this.confirmAnswer;
      },
      showError: (message) => this.errors.push(message),
      showSuccess: (message) => this.successes.push(message),
      activeRoot: () => this.activeRoot,
    });
  }
}

function row(over: Partial<ScmResourceRow> = {}): ScmResourceRow {
  return {
    path: '/scratch/src/a.ts',
    relativePath: 'src/a.ts',
    code: ' M',
    side: 'worktree',
    badge: 'M',
    ...over,
  };
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('owner status feed + branch/history mirror', () => {
  it('attachOwner subscribes the feed, maps status paths onto the root, refreshes reads', async () => {
    const h = new Harness();
    h.git.log_ = [{ oid: 'x' } as unknown as LogEntry];
    const scm = h.scm();
    scm.attachOwner(h.owner);
    await tick(0);
    expect(scm.activeScm().branch).toBe('main');
    expect(scm.activeScm().history).toHaveLength(1);
    h.statusCbs[0]?.({ entries: [{ path: 'src/a.ts', code: ' M' }] });
    expect(scm.gitStatus().get('/scratch/src/a.ts')).toBe(' M');
    scm.dispose();
    expect(h.unsubscribed).toBe(1);
    expect(h.git.disposed).toBe(1);
    expect(scm.gitStatus().size).toBe(0); // teardown resets the mirror
  });

  it('an unavailable owner resets the mirror and never bridges git', async () => {
    const h = new Harness();
    h.owner = new FakeOwner('/scratch', -1);
    const scm = h.scm();
    scm.attachOwner(h.owner);
    await tick(0);
    expect(h.statusCbs).toHaveLength(0);
    expect(scm.activeScm()).toEqual({ root: '/scratch', history: [] });
  });

  it('a failed read degrades to empty reads (no repo yet), never throws', async () => {
    const h = new Harness();
    h.git.failBranch = true;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scm = h.scm();
    scm.attachOwner(h.owner);
    await tick(0);
    spy.mockRestore();
    expect(scm.activeScm()).toEqual({ root: '/scratch', history: [] });
  });

  it('reads for a NO-LONGER-ACTIVE root surface as empty (stale-root guard)', async () => {
    const h = new Harness();
    const scm = h.scm();
    scm.attachOwner(h.owner);
    await tick(0);
    expect(scm.activeScm().branch).toBe('main');
    h.activeRoot = '/projects/p1'; // switch re-pointed the active root
    expect(scm.activeScm()).toEqual({ root: '/projects/p1', history: [] });
  });

  it('requestActiveGitStatus is a no-op for the unavailable owner stub', () => {
    const h = new Harness();
    const scm = h.scm();
    h.owner = new FakeOwner('/scratch', -1);
    scm.requestActiveGitStatus();
    expect(h.statusRequests).toBe(0);
    h.owner = new FakeOwner('/scratch');
    scm.requestActiveGitStatus();
    expect(h.statusRequests).toBe(1);
  });
});

describe('git-original read (editor working diff)', () => {
  it('reads ref:relative from the owner git and decodes text', async () => {
    const h = new Harness();
    h.git.blobs.set('HEAD:src/a.ts', enc.encode('original'));
    const scm = h.scm();
    await expect(scm.readGitOriginalText({ path: '/scratch/src/a.ts', ref: 'HEAD' })).resolves.toBe(
      'original',
    );
    expect(h.git.disposed).toBe(1); // per-call bridge always disposed
  });

  it('rejects a path outside the owner root', async () => {
    const h = new Harness();
    await expect(scmReadOriginal(h, '/elsewhere/a.ts')).rejects.toThrow(
      'Cannot read git original outside /scratch',
    );
  });

  it('an owner respawn mid-show fails loud', async () => {
    const h = new Harness();
    const git = h.git;
    git.blobs.set('HEAD:src/a.ts', enc.encode('original'));
    const origShow = git.show.bind(git);
    git.show = async (rev) => {
      h.owner = new FakeOwner('/scratch', 2); // respawned owner (new port)
      return origShow(rev);
    };
    await expect(scmReadOriginal(h, '/scratch/src/a.ts')).rejects.toThrow(
      'workspace owner changed while reading HEAD:src/a.ts',
    );
  });

  it('an owner object respawn with the same root and port still fails loud', async () => {
    const h = new Harness();
    h.git.blobs.set('HEAD:src/a.ts', enc.encode('original'));
    const origShow = h.git.show.bind(h.git);
    h.git.show = async (rev) => {
      h.owner = new FakeOwner('/scratch');
      return origShow(rev);
    };
    await expect(scmReadOriginal(h, '/scratch/src/a.ts')).rejects.toThrow(
      'workspace owner changed while reading HEAD:src/a.ts',
    );
  });

  it('a binary blob refuses a text diff loud', async () => {
    const h = new Harness();
    h.git.blobs.set('HEAD:src/a.ts', new Uint8Array([0, 1, 2]));
    await expect(scmReadOriginal(h, '/scratch/src/a.ts')).rejects.toThrow(
      'is binary; text diff is unavailable',
    );
  });
});

function scmReadOriginal(h: Harness, path: string): Promise<string> {
  return h.scm().readGitOriginalText({ path, ref: 'HEAD' });
}

describe('side-aware SCM row diffs (scm-diff-plan driven)', () => {
  it('worktree M row: HEAD original vs fresh working bytes, flush first', async () => {
    const h = new Harness();
    h.git.blobs.set('HEAD:src/a.ts', enc.encode('old'));
    h.owner.files.set('/scratch/src/a.ts', enc.encode('new'));
    await h.scm().openScmResourceDiff(row());
    expect(h.flushes).toBe(1);
    expect(h.textDiffs).toHaveLength(1);
    expect(h.textDiffs[0]?.original).toBe('old');
    expect(h.textDiffs[0]?.modified).toBe('new');
    expect(h.textDiffs[0]?.id).toContain('scm-worktree-');
  });

  it('index (staged) row: HEAD vs INDEX blob — no working read', async () => {
    const h = new Harness();
    h.git.blobs.set('HEAD:src/a.ts', enc.encode('old'));
    h.git.blobs.set(':src/a.ts', enc.encode('staged'));
    await h.scm().openScmResourceDiff(row({ side: 'index', code: 'M ' }));
    expect(h.textDiffs[0]?.original).toBe('old');
    expect(h.textDiffs[0]?.modified).toBe('staged');
    expect(h.textDiffs[0]?.id).toContain('scm-index-');
  });

  it('untracked row: empty original vs working bytes', async () => {
    const h = new Harness();
    h.owner.files.set('/scratch/src/a.ts', enc.encode('new file'));
    await h.scm().openScmResourceDiff(row({ code: '??', badge: 'U' }));
    expect(h.textDiffs[0]?.original).toBe('');
    expect(h.textDiffs[0]?.modified).toBe('new file');
  });

  it('a failed blob read surfaces the loud open-changes error', async () => {
    const h = new Harness();
    await h.scm().openScmResourceDiff(row()); // no HEAD blob in the fake
    expect(h.textDiffs).toEqual([]);
    expect(h.errors[0]).toContain('Open changes failed:');
  });

  it('an owner respawn during blob reads fails loud before opening a stale diff', async () => {
    const h = new Harness();
    h.git.blobs.set('HEAD:src/a.ts', enc.encode('old'));
    h.git.blobs.set(':src/a.ts', enc.encode('staged'));
    const show = h.git.show.bind(h.git);
    h.git.show = async (rev) => {
      const result = await show(rev);
      if (rev === ':src/a.ts') h.owner = new FakeOwner('/scratch', 2);
      return result;
    };

    await h.scm().openScmResourceDiff(row({ side: 'index', code: 'M ' }));

    expect(h.textDiffs).toEqual([]);
    expect(h.errors).toEqual([
      'Open changes failed: workspace owner changed while opening src/a.ts',
    ]);
  });

  it('a path outside the owner root refuses', async () => {
    const h = new Harness();
    await h.scm().openScmResourceDiff(row({ path: '/elsewhere/a.ts' }));
    expect(h.errors).toEqual(['Cannot open git diff outside /scratch']);
  });
});

describe('explorer compares', () => {
  it('working file compare: two guarded owner reads → generic Monaco text diff', async () => {
    const h = new Harness();
    h.owner.files.set('/scratch/a.ts', enc.encode('left'));
    h.owner.files.set('/scratch/b.ts', enc.encode('right'));
    await h.scm().openWorkingFileCompare('/scratch/a.ts', '/scratch/b.ts');
    expect(h.flushes).toBe(1);
    expect(h.textDiffs[0]?.original).toBe('left');
    expect(h.textDiffs[0]?.modified).toBe('right');
    expect(h.textDiffs[0]?.title).toBe('a.ts ↔ b.ts');
  });

  it('working file compare fails loud when the owner respawns mid-read', async () => {
    const h = new Harness();
    h.owner.files.set('/scratch/a.ts', enc.encode('left'));
    h.owner.files.set('/scratch/b.ts', enc.encode('right'));
    const readOrig = h.owner.readFileBytes.bind(h.owner);
    h.owner.readFileBytes = async (p: string) => {
      const bytes = await readOrig(p);
      h.owner = new FakeOwner('/scratch', 2); // respawned owner mid-read
      return bytes;
    };
    await h.scm().openWorkingFileCompare('/scratch/a.ts', '/scratch/b.ts');
    expect(h.textDiffs).toEqual([]);
    expect(h.errors[0]).toContain('Compare failed: workspace owner changed while');
  });

  it('compare-with-HEAD: working bytes + head-blob presence from the porcelain status', async () => {
    const h = new Harness();
    h.owner.files.set('/scratch/src/a.ts', enc.encode('work'));
    h.git.statusEntries = [{ filepath: 'src/a.ts', status: ['src/a.ts', 1, 2, 1] }];
    await h.scm().openWorkingHeadCompare('/scratch/src/a.ts');
    expect(h.workingDiffs).toHaveLength(1);
    expect(h.workingDiffs[0]?.modified).toBe('work');
    expect(h.workingDiffs[0]?.ref).toBe('HEAD');
  });

  it('binary working bytes refuse the compare loud', async () => {
    const h = new Harness();
    h.owner.files.set('/scratch/src/a.ts', new Uint8Array([0, 250, 3]));
    await h.scm().openWorkingHeadCompare('/scratch/src/a.ts');
    expect(h.workingDiffs).toEqual([]);
    expect(h.errors[0]).toContain('is binary; text diff is unavailable');
  });

  it('compare-with-HEAD fails loud when the owner respawns before opening the diff', async () => {
    const h = new Harness();
    h.owner.files.set('/scratch/src/a.ts', enc.encode('work'));
    h.git.statusEntries = [{ filepath: 'src/a.ts', status: ['src/a.ts', 1, 2, 1] }];
    const dispose = h.git.dispose.bind(h.git);
    h.git.dispose = () => {
      dispose();
      h.owner = new FakeOwner('/scratch', 2);
    };

    await h.scm().openWorkingHeadCompare('/scratch/src/a.ts');

    expect(h.workingDiffs).toEqual([]);
    expect(h.errors).toEqual([
      'Compare failed: workspace owner changed while comparing src/a.ts with HEAD',
    ]);
  });
});

describe('GIT actions (flush → act → re-assert owner → refresh status)', () => {
  it('stage adds a modified row; stage of a working DELETE uses git remove', async () => {
    const h = new Harness();
    const scm = h.scm();
    await scm.stageRow(row());
    await scm.stageRow(row({ badge: 'D' }));
    expect(h.git.actions).toEqual(['add:src/a.ts', 'remove:src/a.ts']);
    expect(h.statusRequests).toBe(2); // status refresh after each ack
    expect(h.flushes).toBe(2);
  });

  it('unstage routes through git unstage', async () => {
    const h = new Harness();
    await h.scm().unstageRow(row({ side: 'index' }));
    expect(h.git.actions).toEqual(['unstage:src/a.ts']);
  });

  it('discard: confirm → git restore → VFS refresh → drop the editor model', async () => {
    const h = new Harness();
    await h.scm().discardRow(row());
    expect(h.confirms).toEqual(['Discard changes in src/a.ts? This cannot be undone.']);
    expect(h.git.actions).toEqual(['restore:src/a.ts']);
    expect(h.vfsRequests).toBe(1); // restore changed the tree → snapshot refresh
    expect(h.closedPaths).toEqual(['/scratch/src/a.ts']); // discarded buffer can't re-flush
  });

  it('a declined confirm discards nothing', async () => {
    const h = new Harness();
    h.confirmAnswer = false;
    await h.scm().discardRow(row());
    expect(h.git.actions).toEqual([]);
    expect(h.closedPaths).toEqual([]);
  });

  it('an untracked row is not discardable through git restore (loud refuse)', async () => {
    const h = new Harness();
    await expect(h.scm().discardRow(row({ badge: 'U' }))).rejects.toThrow(
      'untracked files are not discardable',
    );
    expect(h.confirms).toEqual([]);
  });

  it('commit resolves identity owner-side and reports the short oid', async () => {
    const h = new Harness();
    await h.scm().commit('feat: x');
    expect(h.git.actions).toEqual(['commit:feat: x']);
    expect(h.successes).toEqual(['Committed abcdef1']);
  });

  it('an action against a swapped owner fails loud and never refreshes status', async () => {
    const h = new Harness();
    const git = h.git;
    git.add = async (filepath) => {
      h.owner = new FakeOwner('/scratch', 2); // owner respawned mid-action
      git.actions.push(`add:${filepath}`);
    };
    await expect(h.scm().stageRow(row())).rejects.toThrow(
      'workspace owner changed while applying Git action',
    );
    expect(h.statusRequests).toBe(0);
    expect(h.errors[0]).toContain('Stage src/a.ts failed:');
    expect(h.git.disposed).toBe(1); // bridge still disposed in finally
  });
});

describe('decodeTextBlob', () => {
  it('decodes UTF-8, refuses binary and invalid UTF-8 loud', () => {
    expect(decodeTextBlob('x', enc.encode('привет'))).toBe('привет');
    expect(() => decodeTextBlob('x', new Uint8Array([0, 1]))).toThrow('is binary');
    expect(() => decodeTextBlob('x', new Uint8Array([0xff, 0xfe, 0xfd]))).toThrow(
      'is not valid UTF-8',
    );
  });
});
