import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { type BinExecutor, Shell } from '../src/index.ts';

interface ExecCall {
  readonly path: string;
  readonly args: readonly string[];
}

function recordingExecutor(): {
  readonly calls: ExecCall[];
  readonly execBin: BinExecutor;
} {
  const calls: ExecCall[] = [];
  return {
    calls,
    execBin: async (path, args) => {
      calls.push({ path, args: [...args] });
      return 0;
    },
  };
}

describe('Shell command resolution and discovery', () => {
  it('runs an explicit relative VFS file as a normalized Node entry', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/proj/scripts/tool.mjs': 'console.log(process.argv.slice(2).join(","));\n',
    });
    const calls: Array<{ readonly path: string; readonly args: readonly string[] }> = [];
    const execBin: BinExecutor = async (path, args) => {
      calls.push({ path, args: [...args] });
      return 0;
    };
    const shell = new Shell({ cwd: '/proj', fileSystem, execBin });

    const result = await shell.run('./scripts/tool.mjs first second');

    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    expect(calls).toEqual([{ path: '/proj/scripts/tool.mjs', args: ['first', 'second'] }]);
  });

  it('keeps a registered command authoritative across execution and discovery', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/proj/node_modules/.bin/greet': 'shadowed shim\n',
    });
    const { calls, execBin } = recordingExecutor();
    const shell = new Shell({ cwd: '/proj', fileSystem, execBin });
    shell.registerCommand('greet', async (_args, ctx) => {
      ctx.stdout.write('registered\n');
      return 0;
    });

    expect(shell.hasCommand('greet')).toBe(true);
    expect(shell.commandNames().filter((name) => name === 'greet')).toEqual(['greet']);
    expect(await shell.run('which greet')).toMatchObject({ exitCode: 0, stdout: 'greet\n' });
    expect(await shell.run('greet')).toMatchObject({ exitCode: 0, stdout: 'registered\n' });
    expect((await shell.run('gret')).stderr).toContain("Did you mean 'greet'?");
    expect(calls).toEqual([]);
  });

  it('discovers installed bins for names, suggestions, and completion without leaking into help', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/proj/node_modules/.bin/vite': 'installed shim\n',
    });
    const shell = new Shell({ cwd: '/proj', fileSystem });
    shell.registerCommand('frobnicate', async () => 0);

    expect(shell.commandNames()).toContain('vite');
    expect(await shell.run('vte')).toMatchObject({
      exitCode: 127,
      stderr: "vte: command not found\nDid you mean 'vite'?\n",
    });
    expect(shell.complete('vi', 2)).toEqual({
      start: 0,
      end: 2,
      items: [{ value: 'vite ', display: 'vite' }],
    });

    const help = await shell.run('help');
    const commandList = help.stdout.split('\n')[0];
    expect(help.exitCode).toBe(0);
    expect(commandList).toContain('frobnicate');
    expect(commandList).not.toContain('vite');
  });

  it('uses the same nearest ancestor bin for execution, which, presence, and names', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/repo/node_modules/.bin/vite': 'outer shim\n',
      '/repo/packages/app/node_modules/.bin/vite': 'near shim\n',
      '/repo/packages/app/src/index.ts': 'export {};\n',
    });
    const { calls, execBin } = recordingExecutor();
    const shell = new Shell({ cwd: '/repo/packages/app/src', fileSystem, execBin });

    expect(shell.hasCommand('vite')).toBe(true);
    expect(shell.commandNames().filter((name) => name === 'vite')).toEqual(['vite']);
    expect(await shell.run('which vite')).toMatchObject({
      exitCode: 0,
      stdout: '/repo/packages/app/node_modules/.bin/vite\n',
    });
    expect(await shell.run('vite --host')).toMatchObject({ exitCode: 0, stderr: '' });
    expect(calls).toEqual([
      { path: '/repo/packages/app/node_modules/.bin/vite', args: ['--host'] },
    ]);
  });

  it('keeps a genuine bare miss consistent across execution and discovery', async () => {
    const shell = new Shell({ fileSystem: new MemoryFsSync() });

    expect(shell.hasCommand('ghostcommand')).toBe(false);
    expect(shell.commandNames()).not.toContain('ghostcommand');
    expect(await shell.run('which ghostcommand')).toMatchObject({ exitCode: 1, stdout: '' });
    expect(await shell.run('ghostcommand')).toMatchObject({
      exitCode: 127,
      stderr: 'ghostcommand: command not found\n',
    });
  });

  it('discovers a sorted deduplicated union of live ancestor bins after cd', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/repo/node_modules/.bin/zulu': 'root shim\n',
      '/repo/node_modules/.bin/shared': 'root shared shim\n',
      '/repo/packages/app/node_modules/.bin/alpha': 'app shim\n',
      '/repo/packages/app/node_modules/.bin/shared': 'near shared shim\n',
      '/repo/packages/app/src/index.ts': 'export {};\n',
    });
    fileSystem.mkdirSync('/repo/packages/app/node_modules/.bin/directory', { recursive: true });
    const shell = new Shell({ cwd: '/repo', fileSystem });

    expect(shell.commandNames()).not.toContain('alpha');
    fileSystem.writeFileSync(
      '/repo/packages/app/node_modules/.bin/beta',
      new TextEncoder().encode('installed after Shell construction\n'),
    );
    expect((await shell.run('cd packages/app/src')).exitCode).toBe(0);

    const names = shell.commandNames();
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => ['alpha', 'beta', 'shared', 'zulu'].includes(name))).toEqual([
      'alpha',
      'beta',
      'shared',
      'zulu',
    ]);
    expect(names).not.toContain('directory');
  });

  it('runs and reports an explicit absolute VFS file without adding it as a bare name', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/proj/scripts/tool.mjs': 'console.log("absolute");\n',
    });
    const { calls, execBin } = recordingExecutor();
    const shell = new Shell({ cwd: '/elsewhere', fileSystem, execBin });

    expect(shell.hasCommand('/proj/scripts/tool.mjs')).toBe(true);
    expect(shell.commandNames()).not.toContain('/proj/scripts/tool.mjs');
    expect(await shell.run('which /proj/scripts/tool.mjs')).toMatchObject({
      exitCode: 0,
      stdout: '/proj/scripts/tool.mjs\n',
    });
    expect(await shell.run('/proj/scripts/tool.mjs arg')).toMatchObject({ exitCode: 0 });
    expect(calls).toEqual([{ path: '/proj/scripts/tool.mjs', args: ['arg'] }]);
  });

  it('runs an explicit relative .bin path through the existing executor', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/proj/node_modules/.bin/vite': 'shim\n',
    });
    const { calls, execBin } = recordingExecutor();
    const shell = new Shell({ cwd: '/proj', fileSystem, execBin });

    expect(shell.hasCommand('./node_modules/.bin/vite')).toBe(true);
    expect(await shell.run('which ./node_modules/.bin/vite')).toMatchObject({
      exitCode: 0,
      stdout: './node_modules/.bin/vite\n',
    });
    expect(await shell.run('./node_modules/.bin/vite --version')).toMatchObject({ exitCode: 0 });
    expect(calls).toEqual([{ path: '/proj/node_modules/.bin/vite', args: ['--version'] }]);
  });

  it.each([
    {
      command: './scripts/missing.mjs',
      exitCode: 127,
      diagnostic: './scripts/missing.mjs: No such file or directory\n',
    },
    {
      command: './scripts',
      exitCode: 126,
      diagnostic: './scripts: is a directory\n',
    },
    {
      command: './scripts/tool.mjs/child',
      exitCode: 126,
      diagnostic: './scripts/tool.mjs/child: Not a directory\n',
    },
  ])(
    'reports the directed failure class for $command',
    async ({ command, exitCode, diagnostic }) => {
      const fileSystem = new MemoryFsSync();
      fileSystem.loadFixture({
        '/proj/scripts/tool.mjs': 'console.log("tool");\n',
      });
      const { calls, execBin } = recordingExecutor();
      const shell = new Shell({ cwd: '/proj', fileSystem, execBin });

      expect(shell.hasCommand(command)).toBe(false);
      expect(await shell.run(`which ${command}`)).toMatchObject({ exitCode: 1, stdout: '' });
      expect(await shell.run(command)).toMatchObject({ exitCode, stderr: diagnostic });
      expect(calls).toEqual([]);
    },
  );

  it('reports an existing direct file without an executor as found but not executable', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/proj/scripts/tool.mjs': 'console.log("tool");\n',
    });
    const shell = new Shell({ cwd: '/proj', fileSystem });

    expect(shell.hasCommand('./scripts/tool.mjs')).toBe(true);
    expect(await shell.run('which ./scripts/tool.mjs')).toMatchObject({
      exitCode: 0,
      stdout: './scripts/tool.mjs\n',
    });
    expect(await shell.run('./scripts/tool.mjs')).toMatchObject({
      exitCode: 126,
      stderr:
        './scripts/tool.mjs: cannot execute /proj/scripts/tool.mjs: no Node executor configured\n',
    });
  });

  it('never falls back from a path-like miss to a same-named installed bin', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/proj/node_modules/.bin/vite': 'installed shim\n',
    });
    const { calls, execBin } = recordingExecutor();
    const shell = new Shell({ cwd: '/proj', fileSystem, execBin });

    expect(shell.hasCommand('vite')).toBe(true);
    expect(shell.hasCommand('./vite')).toBe(false);
    expect(await shell.run('which ./vite')).toMatchObject({ exitCode: 1, stdout: '' });
    expect(await shell.run('./vite')).toMatchObject({
      exitCode: 127,
      stderr: './vite: No such file or directory\n',
    });
    expect(calls).toEqual([]);
  });

  it('suggests an installed bin for a close bare-name typo', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/proj/node_modules/.bin/vite': 'installed shim\n',
    });
    const shell = new Shell({ cwd: '/proj', fileSystem });

    expect(await shell.run('vte')).toMatchObject({
      exitCode: 127,
      stderr: "vte: command not found\nDid you mean 'vite'?\n",
    });
  });
});
