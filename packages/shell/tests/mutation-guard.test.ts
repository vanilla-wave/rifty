import type { VfsMutationGuard, VfsMutationIntent } from '@riftydev/vfs';
import { asyncVfs } from '@riftydev/vfs';
import {
  MemoryFsSync,
  installMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Shell } from '../src/index.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

type GuardedShellOptions = ConstructorParameters<typeof Shell>[0] & {
  readonly mutationGuard: VfsMutationGuard;
};

function guardedShell(
  mutationGuard: VfsMutationGuard,
  cwd = '/',
  env: Record<string, string> = {},
): Shell {
  return new Shell({ cwd, env, mutationGuard } as GuardedShellOptions);
}

function recordingGuard(batches: VfsMutationIntent[][]): VfsMutationGuard {
  return async (intents, apply) => {
    batches.push([...intents]);
    return await apply();
  };
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

describe('Shell VFS mutation guard', () => {
  it('batches every touch operand once with exact package, tree, and unrelated paths', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project/node_modules', { recursive: true });
    fs.mkdirSync('/outside', { recursive: true });
    setSyncMirror(fs);
    const batches: VfsMutationIntent[][] = [];
    const shell = guardedShell(recordingGuard(batches));

    expect(
      (
        await shell.run(
          'touch /project/package.json /project/node_modules/pkg.json /outside/readme.md',
        )
      ).exitCode,
    ).toBe(0);
    expect(batches).toEqual([
      [
        { kind: 'write', path: '/project/package.json' },
        { kind: 'write', path: '/project/node_modules/pkg.json' },
        { kind: 'write', path: '/outside/readme.md' },
      ],
    ]);
  });

  it('describes mkdir, rm, cp, and mv as one exact batch per logical command', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project/node_modules/pkg', { recursive: true });
    fs.mkdirSync('/sources', { recursive: true });
    fs.mkdirSync('/outside', { recursive: true });
    fs.writeFileSync('/sources/index.js', enc.encode('source'));
    fs.writeFileSync('/project/package.json', enc.encode('{}'));
    fs.writeFileSync('/outside/readme.md', enc.encode('readme'));
    setSyncMirror(fs);
    const batches: VfsMutationIntent[][] = [];
    const shell = guardedShell(recordingGuard(batches));

    expect((await shell.run('mkdir /project/node_modules/new-pkg /outside/new-dir')).exitCode).toBe(
      0,
    );
    expect(batches.splice(0)).toEqual([
      [
        { kind: 'mkdir', path: '/project/node_modules/new-pkg' },
        { kind: 'mkdir', path: '/outside/new-dir' },
      ],
    ]);

    expect(
      (await shell.run('cp /sources/index.js /project/node_modules/pkg/index.js')).exitCode,
    ).toBe(0);
    expect(batches.splice(0)).toEqual([
      [
        {
          kind: 'copy',
          sourcePath: '/sources/index.js',
          targetPath: '/project/node_modules/pkg/index.js',
        },
      ],
    ]);

    expect((await shell.run('mv /project/package.json /outside/package.json')).exitCode).toBe(0);
    expect(batches.splice(0)).toEqual([
      [
        {
          kind: 'rename',
          sourcePath: '/project/package.json',
          targetPath: '/outside/package.json',
        },
      ],
    ]);

    expect((await shell.run('rm -r /project /outside/readme.md')).exitCode).toBe(0);
    expect(batches).toEqual([
      [
        { kind: 'rm', path: '/project' },
        { kind: 'rm', path: '/outside/readme.md' },
      ],
    ]);
  });

  it('reports utimes rather than write when touch updates an existing file', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project', { recursive: true });
    fs.writeFileSync('/project/package.json', enc.encode('{}'));
    setSyncMirror(fs);
    const batches: VfsMutationIntent[][] = [];
    const shell = guardedShell(recordingGuard(batches));

    expect((await shell.run('touch /project/package.json')).exitCode).toBe(0);
    expect(batches).toEqual([[{ kind: 'utimes', path: '/project/package.json' }]]);
  });

  it('rejects before apply without mutating any operand', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project', { recursive: true });
    fs.writeFileSync('/project/package.json', enc.encode('{}'));
    fs.writeFileSync('/project/keep.txt', enc.encode('keep'));
    setSyncMirror(fs);
    const guard: VfsMutationGuard = async () => {
      throw new Error('durable invalidation failed');
    };
    const shell = guardedShell(guard);

    const result = await shell.run('rm /project/package.json /project/keep.txt');
    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain('durable invalidation failed');
    expect(dec.decode(fs.readFileBytesSync('/project/package.json'))).toBe('{}');
    expect(dec.decode(fs.readFileBytesSync('/project/keep.txt'))).toBe('keep');
  });

  it('holds redirect truncation and append behind an exact write intent', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project', { recursive: true });
    fs.writeFileSync('/project/package.json', enc.encode('old'));
    setSyncMirror(fs);
    const batches: VfsMutationIntent[][] = [];
    let reject = true;
    const guard: VfsMutationGuard = async (intents, apply) => {
      batches.push([...intents]);
      if (reject) throw new Error('stamp revoke failed');
      return await apply();
    };
    const shell = guardedShell(guard);

    const refused = await shell.run('echo next > /project/package.json');
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('stamp revoke failed');
    expect(dec.decode(fs.readFileBytesSync('/project/package.json'))).toBe('old');
    expect(batches.splice(0)).toEqual([[{ kind: 'write', path: '/project/package.json' }]]);

    reject = false;
    expect((await shell.run('printf +more >> /project/package.json')).exitCode).toBe(0);
    expect(dec.decode(fs.readFileBytesSync('/project/package.json'))).toBe('old+more');
    expect(batches).toEqual([[{ kind: 'write', path: '/project/package.json' }]]);
  });

  it('awaits FIFO guards so concurrent commands cannot overtake a held mutation', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project', { recursive: true });
    setSyncMirror(fs);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const applied: string[] = [];
    let tail = Promise.resolve();
    let sequence = 0;
    const guard: VfsMutationGuard = (intents, apply) => {
      const slot = ++sequence;
      const run = tail.then(async () => {
        if (slot === 1) await firstGate;
        const result = await apply();
        applied.push('path' in intents[0]! ? intents[0]!.path : intents[0]!.targetPath);
        return result;
      });
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
    const shell = guardedShell(guard);

    const first = shell.run('touch /project/first');
    const second = shell.run('touch /project/second');
    await Promise.resolve();
    await Promise.resolve();
    expect(fs.existsSync('/project/first')).toBe(false);
    expect(fs.existsSync('/project/second')).toBe(false);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { exitCode: 0 },
      { exitCode: 0 },
    ]);
    expect(applied).toEqual(['/project/first', '/project/second']);
  });

  it('preserves the guard in the Shell clone used by background commands', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project', { recursive: true });
    setSyncMirror(fs);
    const batches: VfsMutationIntent[][] = [];
    const shell = guardedShell(recordingGuard(batches));

    expect((await shell.run('touch /project/background &')).exitCode).toBe(0);
    await shell.dispose();
    expect(batches).toEqual([[{ kind: 'write', path: '/project/background' }]]);
  });

  it('guards git worktree moves once with the semantic rename paths', async () => {
    installMemoryFs();
    const vfs = asyncVfs();
    if (!vfs) throw new Error('no async VFS');
    await vfs.mkdir('/repo', { recursive: true });
    await vfs.writeFile('/repo/package.json', '{}');
    const batches: VfsMutationIntent[][] = [];
    const shell = guardedShell(recordingGuard(batches), '/repo');
    expect((await shell.run('git init')).exitCode).toBe(0);
    expect((await shell.run('git add package.json')).exitCode).toBe(0);
    batches.length = 0;

    expect((await shell.run('git mv package.json package.next.json')).exitCode).toBe(0);
    expect(batches).toEqual([
      [
        { kind: 'write', path: '/repo/.git' },
        {
          kind: 'rename',
          sourcePath: '/repo/package.json',
          targetPath: '/repo/package.next.json',
        },
      ],
    ]);
    expect(await vfs.exists('/repo/package.json')).toBe(false);
    expect(await vfs.exists('/repo/package.next.json')).toBe(true);
  });

  it('guards nested-repo metadata writers narrowly while leaving reads unguarded', async () => {
    installMemoryFs();
    const vfs = asyncVfs();
    if (!vfs) throw new Error('no async VFS');
    await vfs.mkdir('/project/node_modules/pkg', { recursive: true });
    await vfs.writeFile('/project/node_modules/pkg/index.js', 'module.exports = 1;\n');
    const batches: VfsMutationIntent[][] = [];
    const shell = guardedShell(recordingGuard(batches), '/project/node_modules/pkg');

    expect((await shell.run('git init')).exitCode).toBe(0);
    expect(batches.splice(0)).toEqual([
      [{ kind: 'write', path: '/project/node_modules/pkg/.git' }],
    ]);

    expect((await shell.run('git add index.js')).exitCode).toBe(0);
    expect(batches.splice(0)).toEqual([
      [{ kind: 'write', path: '/project/node_modules/pkg/.git' }],
    ]);

    expect((await shell.run('git config user.name rifty')).exitCode).toBe(0);
    expect(batches.splice(0)).toEqual([
      [{ kind: 'write', path: '/project/node_modules/pkg/.git/config' }],
    ]);

    expect((await shell.run('git status --porcelain')).exitCode).toBe(0);
    expect((await shell.run('git config user.name')).stdout).toBe('rifty\n');
    expect(batches).toEqual([]);
  });

  it('guards every supported git index/ref writer and excludes read-only porcelain', async () => {
    installMemoryFs();
    const vfs = asyncVfs();
    if (!vfs) throw new Error('no async VFS');
    await vfs.mkdir('/repo', { recursive: true });
    await vfs.writeFile('/repo/package.json', '{}\n');
    const setup = new Shell({ cwd: '/repo', env: GIT_ENV });
    expect((await setup.run('git init')).exitCode).toBe(0);
    expect((await setup.run('git add package.json')).exitCode).toBe(0);
    expect((await setup.run('git commit -m initial')).exitCode).toBe(0);

    const batches: VfsMutationIntent[][] = [];
    const reject: VfsMutationGuard = async (intents) => {
      batches.push([...intents]);
      throw new Error('guarded for classification');
    };
    const shell = guardedShell(reject, '/repo', GIT_ENV);
    const metadata = [[{ kind: 'write', path: '/repo/.git' }]] as VfsMutationIntent[][];
    const config = [[{ kind: 'write', path: '/repo/.git/config' }]] as VfsMutationIntent[][];

    for (const command of [
      'git add package.json',
      'git commit -m next',
      'git tag v1',
      'git remote add origin https://example.invalid/repo.git',
      'git fetch',
      'git push',
      'git reset --mixed',
      'git restore --staged package.json',
      'git rm --cached package.json',
      'git stash drop',
      'git stash clear',
      'git stash create',
    ]) {
      batches.length = 0;
      expect((await shell.run(command)).exitCode, command).toBe(1);
      expect(batches, command).toEqual(metadata);
    }

    batches.length = 0;
    expect((await shell.run('git config user.email rifty@example.test')).exitCode).toBe(1);
    expect(batches).toEqual(config);

    batches.length = 0;
    for (const command of [
      'git status --porcelain',
      'git log --oneline',
      'git diff',
      'git show HEAD',
      'git branch',
      'git tag',
      'git remote',
      'git config user.name',
      'git stash list',
      'git tag --list',
      'git tag -a missing-message',
      'git tag -d',
    ]) {
      await shell.run(command);
    }
    expect(batches).toEqual([]);
  });

  it('guards the complete supported git worktree-writer set at one command boundary', async () => {
    installMemoryFs();
    const vfs = asyncVfs();
    if (!vfs) throw new Error('no async VFS');
    await vfs.mkdir('/repo', { recursive: true });
    await vfs.writeFile('/repo/package.json', '{}\n');
    const setup = new Shell({ cwd: '/repo', env: GIT_ENV });
    expect((await setup.run('git init')).exitCode).toBe(0);
    expect((await setup.run('git add package.json')).exitCode).toBe(0);
    expect((await setup.run('git commit -m initial')).exitCode).toBe(0);

    const batches: VfsMutationIntent[][] = [];
    const reject: VfsMutationGuard = async (intents) => {
      batches.push([...intents]);
      throw new Error('guarded for classification');
    };
    const shell = guardedShell(reject, '/repo', GIT_ENV);
    for (const command of [
      'git checkout feature',
      'git switch feature',
      'git restore package.json',
      'git reset --hard',
      'git merge feature',
      'git cherry-pick HEAD',
      'git revert HEAD',
      'git apply change.patch',
      'git stash push',
      'git stash save work',
      'git stash pop',
      'git stash apply',
      'git pull origin main',
    ]) {
      batches.length = 0;
      expect((await shell.run(command)).exitCode, command).toBe(1);
      expect(batches, command).toEqual([[{ kind: 'write', path: '/repo' }]]);
    }

    batches.length = 0;
    expect((await shell.run('git rm package.json')).exitCode).toBe(1);
    expect(batches).toEqual([
      [
        { kind: 'write', path: '/repo/.git' },
        { kind: 'rm', path: '/repo/package.json' },
      ],
    ]);
  });

  it('holds a root-changing git checkout behind one guard and rejects before bytes change', async () => {
    installMemoryFs();
    const vfs = asyncVfs();
    if (!vfs) throw new Error('no async VFS');
    await vfs.mkdir('/repo', { recursive: true });
    await vfs.writeFile('/repo/package.json', '{"branch":"main"}\n');
    const setup = new Shell({ cwd: '/repo', env: GIT_ENV });
    expect((await setup.run('git init')).exitCode).toBe(0);
    expect((await setup.run('git add package.json')).exitCode).toBe(0);
    expect((await setup.run('git commit -m main')).exitCode).toBe(0);
    expect((await setup.run('git checkout -b feature')).exitCode).toBe(0);
    await vfs.writeFile('/repo/package.json', '{"branch":"feature"}\n');
    expect((await setup.run('git add package.json')).exitCode).toBe(0);
    expect((await setup.run('git commit -m feature')).exitCode).toBe(0);
    expect((await setup.run('git checkout main')).exitCode).toBe(0);

    const rejected: VfsMutationIntent[][] = [];
    const reject: VfsMutationGuard = async (intents) => {
      rejected.push([...intents]);
      throw new Error('stamp revoke failed');
    };
    const refused = await guardedShell(reject, '/repo', GIT_ENV).run('git checkout feature');
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('stamp revoke failed');
    expect(dec.decode(await vfs.readFile('/repo/package.json'))).toBe('{"branch":"main"}\n');
    expect(rejected).toEqual([[{ kind: 'write', path: '/repo' }]]);

    const applied: VfsMutationIntent[][] = [];
    const switched = await guardedShell(recordingGuard(applied), '/repo', GIT_ENV).run(
      'git checkout feature',
    );
    expect(switched.exitCode).toBe(0);
    expect(dec.decode(await vfs.readFile('/repo/package.json'))).toBe('{"branch":"feature"}\n');
    expect(applied).toEqual([[{ kind: 'write', path: '/repo' }]]);
  });

  it('aborts when a nearer repository becomes governing while a git mutation is parked', async () => {
    installMemoryFs();
    const vfs = asyncVfs();
    if (!vfs) throw new Error('no async VFS');
    await vfs.mkdir('/outer/work', { recursive: true });
    const setup = new Shell({ cwd: '/outer', env: GIT_ENV });
    expect((await setup.run('git init')).exitCode).toBe(0);

    let entered!: () => void;
    const guardEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const batches: VfsMutationIntent[][] = [];
    const guard: VfsMutationGuard = async (intents, apply) => {
      batches.push([...intents]);
      entered();
      await parked;
      return await apply();
    };
    const pending = guardedShell(guard, '/outer/work').run('git config user.name changed');
    await guardEntered;
    expect((await new Shell({ cwd: '/outer/work' }).run('git init')).exitCode).toBe(0);
    release();

    const result = await pending;
    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain('repository root changed');
    expect(batches).toEqual([[{ kind: 'write', path: '/outer/.git/config' }]]);
    expect((await new Shell({ cwd: '/outer' }).run('git config user.name')).exitCode).toBe(1);
    expect((await new Shell({ cwd: '/outer/work' }).run('git config user.name')).exitCode).toBe(1);
  });

  it('parks a repo mutation planned without a repo and refuses a newly governing repo', async () => {
    installMemoryFs();
    const vfs = asyncVfs();
    if (!vfs) throw new Error('no async VFS');
    await vfs.mkdir('/workspace', { recursive: true });

    let entered!: () => void;
    const guardEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const batches: VfsMutationIntent[][] = [];
    const guard: VfsMutationGuard = async (intents, apply) => {
      batches.push([...intents]);
      entered();
      await parked;
      return await apply();
    };
    const pending = guardedShell(guard, '/workspace').run('git config user.name changed');
    const outcome = await Promise.race([
      guardEntered.then(() => 'entered' as const),
      pending.then(() => 'settled' as const),
    ]);
    expect(outcome).toBe('entered');
    if (outcome !== 'entered') return;

    expect((await new Shell({ cwd: '/workspace' }).run('git init')).exitCode).toBe(0);
    release();
    const result = await pending;
    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain('repository root changed');
    expect(batches).toEqual([[{ kind: 'write', path: '/workspace' }]]);
    expect((await new Shell({ cwd: '/workspace' }).run('git config user.name')).exitCode).toBe(1);
  });

  it('publishes a validated clone destination and rejects before creating it', async () => {
    installMemoryFs();
    const vfs = asyncVfs();
    if (!vfs) throw new Error('no async VFS');
    await vfs.mkdir('/workspace', { recursive: true });
    const batches: VfsMutationIntent[][] = [];
    const reject: VfsMutationGuard = async (intents) => {
      batches.push([...intents]);
      throw new Error('stamp revoke failed');
    };
    const shell = guardedShell(reject, '/workspace');

    expect((await shell.run('git clone https://example.test/repo.git /project')).exitCode).toBe(1);
    expect(batches).toEqual([[{ kind: 'write', path: '/project' }]]);
    expect(await vfs.exists('/project')).toBe(false);

    batches.length = 0;
    expect((await shell.run('git clone ssh://example.test/repo.git /project')).exitCode).toBe(128);
    expect(batches).toEqual([]);

    await vfs.mkdir('/project', { recursive: true });
    await vfs.writeFile('/project/package.json', '{}');
    expect((await shell.run('git clone https://example.test/repo.git /project')).exitCode).toBe(
      128,
    );
    expect(batches).toEqual([]);
    expect(dec.decode(await vfs.readFile('/project/package.json'))).toBe('{}');
  });
});

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'rifty',
  GIT_AUTHOR_EMAIL: 'rifty@localhost',
  GIT_AUTHOR_DATE: '1600000000',
  GIT_COMMITTER_NAME: 'rifty',
  GIT_COMMITTER_EMAIL: 'rifty@localhost',
  GIT_COMMITTER_DATE: '1600000000',
};
