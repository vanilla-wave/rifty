import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { type BinExecutor, Shell } from '../src/index.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

afterEach(() => {
  resetSyncMirror();
});

function seed(label: string): MemoryFsSync {
  const fs = new MemoryFsSync();
  fs.mkdirSync('/work/node_modules/.bin', { recursive: true });
  fs.writeFileSync('/work/shared.txt', enc.encode(`${label}\n`));
  fs.writeFileSync(`/work/${label}.only`, enc.encode(label));
  fs.writeFileSync('/work/node_modules/.bin/tool', enc.encode(label));
  return fs;
}

describe('Shell file-system injection', () => {
  it('keeps an omitted filesystem dynamically bound to the ambient mirror', async () => {
    setSyncMirror(seed('first'));
    const shell = new Shell({ cwd: '/work' });
    setSyncMirror(seed('second'));

    const result = await shell.run('cat shared.txt');

    expect(result.stdout).toBe('second\n');
  });

  it('keeps builtins, globs, redirects, and bin resolution instance-local concurrently', async () => {
    const global = seed('global');
    const first = seed('first');
    const second = seed('second');
    setSyncMirror(global);

    const binCalls: string[] = [];
    const execBin: BinExecutor = async (binPath, _args, ctx) => {
      binCalls.push(`${ctx.env.SHELL_ID}:${binPath}`);
      ctx.stdout.write(`${ctx.env.SHELL_ID}-bin\n`);
      return 0;
    };
    const firstShell = new Shell({
      cwd: '/work',
      env: { SHELL_ID: 'first' },
      execBin,
      fileSystem: first,
    });
    const secondShell = new Shell({
      cwd: '/work',
      env: { SHELL_ID: 'second' },
      execBin,
      fileSystem: second,
    });

    const [
      firstRead,
      secondRead,
      firstGlob,
      secondGlob,
      firstWalk,
      secondWalk,
      firstBin,
      secondBin,
    ] = await Promise.all([
      firstShell.run('cat shared.txt > result.txt && cat result.txt'),
      secondShell.run('cat shared.txt > result.txt && cat result.txt'),
      firstShell.run('echo *.only'),
      secondShell.run('echo *.only'),
      firstShell.run("find . -name '*.only'"),
      secondShell.run("find . -name '*.only'"),
      firstShell.run('tool'),
      secondShell.run('tool'),
    ]);

    expect(firstRead.stdout).toBe('first\n');
    expect(secondRead.stdout).toBe('second\n');
    expect(firstGlob.stdout).toBe('first.only\n');
    expect(secondGlob.stdout).toBe('second.only\n');
    expect(firstWalk.stdout).toBe('./first.only\n');
    expect(secondWalk.stdout).toBe('./second.only\n');
    expect(firstBin.stdout).toBe('first-bin\n');
    expect(secondBin.stdout).toBe('second-bin\n');
    expect(binCalls.sort()).toEqual([
      'first:/work/node_modules/.bin/tool',
      'second:/work/node_modules/.bin/tool',
    ]);
    expect(dec.decode(first.readFileBytesSync('/work/result.txt'))).toBe('first\n');
    expect(dec.decode(second.readFileBytesSync('/work/result.txt'))).toBe('second\n');
    expect(global.existsSync('/work/result.txt')).toBe(false);
  });

  it('keeps git on the injected instance instead of the ambient async VFS', async () => {
    const global = seed('global');
    const first = seed('first');
    const second = seed('second');
    setSyncMirror(global);
    const firstShell = new Shell({ cwd: '/work', fileSystem: first });
    const secondShell = new Shell({ cwd: '/work', fileSystem: second });

    const [firstGit, secondGit] = await Promise.all([
      firstShell.run('git init && git add shared.txt && git status --porcelain'),
      secondShell.run('git init && git add shared.txt && git status --porcelain'),
    ]);

    expect(firstGit.exitCode).toBe(0);
    expect(secondGit.exitCode).toBe(0);
    expect(firstGit.stdout).toContain('A  shared.txt\n');
    expect(secondGit.stdout).toContain('A  shared.txt\n');
    expect(first.existsSync('/work/.git/HEAD')).toBe(true);
    expect(second.existsSync('/work/.git/HEAD')).toBe(true);
    expect(global.existsSync('/work/.git')).toBe(false);
  });
});
