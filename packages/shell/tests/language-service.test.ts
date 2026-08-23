import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  Shell,
  type ShellCompletionMode,
  createShellCompleter,
  shellLineHighlightSpans,
  validateShellInput,
} from '../src/index.ts';

function makeCompleter(options?: { mode?: ShellCompletionMode }) {
  const dirs: Record<string, Array<{ name: string; isDirectory: boolean }>> = {
    '/workspace': [
      { name: 'package.json', isDirectory: false },
      { name: 'src', isDirectory: true },
      { name: 'README.md', isDirectory: false },
    ],
    '/workspace/src': [
      { name: 'main.ts', isDirectory: false },
      { name: 'styles.css', isDirectory: false },
    ],
  };
  return createShellCompleter({
    mode: () => options?.mode ?? 'dev',
    commandNames: () => ['cat', 'cd', 'grep', 'npm'],
    cwd: () => '/workspace',
    readdirSync: (path) => {
      const entries = dirs[path];
      if (!entries) throw new Error(`ENOENT ${path}`);
      return entries;
    },
  });
}

describe('createShellCompleter', () => {
  it('completes command names at the start of a shell line', () => {
    const complete = makeCompleter();
    expect(complete('gr', 2)).toEqual({
      start: 0,
      end: 2,
      items: [{ value: 'grep ', display: 'grep' }],
    });
  });

  it('completes relative VFS paths after the command position', () => {
    const complete = makeCompleter();
    expect(complete('cat src/ma', 10)).toEqual({
      start: 4,
      end: 10,
      items: [{ value: 'src/main.ts ', display: 'main.ts' }],
    });
  });

  it('adds slash to directory path completions', () => {
    const complete = makeCompleter();
    expect(complete('cd s', 4)).toEqual({
      start: 3,
      end: 4,
      items: [{ value: 'src/', display: 'src/' }],
    });
  });

  it('does not complete in REPL mode', () => {
    const complete = makeCompleter({ mode: 'repl' });
    expect(complete('np', 2)).toBeNull();
  });

  it('returns null for missing completion directories', () => {
    const complete = makeCompleter();
    expect(complete('cat nope/a', 10)).toBeNull();
  });
});

describe('Shell.complete', () => {
  it('discovers installed ancestor bins from the live cwd and filesystem', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/workspace/node_modules/.bin/vite': 'workspace shim\n',
      '/workspace/packages/app/src/index.ts': 'export {};\n',
    });
    const shell = new Shell({ cwd: '/workspace', fileSystem });

    expect(shell.complete('vi', 2)).toEqual({
      start: 0,
      end: 2,
      items: [{ value: 'vite ', display: 'vite' }],
    });

    fileSystem.loadFixture({
      '/workspace/packages/app/node_modules/.bin/vitest': 'installed after construction\n',
    });
    expect((await shell.run('cd packages/app/src')).exitCode).toBe(0);
    expect(shell.complete('vi', 2)).toEqual({
      start: 0,
      end: 2,
      items: [
        { value: 'vite ', display: 'vite' },
        { value: 'vitest ', display: 'vitest' },
      ],
    });
  });

  it('completes a direct argv-0 path from the live cwd and filesystem', async () => {
    const fileSystem = new MemoryFsSync();
    fileSystem.loadFixture({
      '/workspace/packages/app/src/index.ts': 'export {};\n',
    });
    const shell = new Shell({ cwd: '/workspace', fileSystem });

    expect((await shell.run('cd packages/app')).exitCode).toBe(0);
    fileSystem.loadFixture({
      '/workspace/packages/app/scripts/tool.mjs': 'console.log("tool");\n',
    });

    expect(shell.complete('./scripts/to', 12)).toEqual({
      start: 0,
      end: 12,
      items: [{ value: './scripts/tool.mjs ', display: 'tool.mjs' }],
    });
  });
});

describe('shellLineHighlightSpans', () => {
  it('highlights command, string, and shell operators with raw offsets', () => {
    expect(shellLineHighlightSpans("grep 'a b' src/app.ts && echo ok")).toEqual([
      { start: 0, end: 4, foreground: '#7fb2ff' },
      { start: 5, end: 10, foreground: '#c4f042' },
      { start: 22, end: 24, foreground: '#98a1b6' },
      { start: 25, end: 29, foreground: '#7fb2ff' },
    ]);
  });

  it('keeps escaped quotes inside a double-quoted string span', () => {
    expect(shellLineHighlightSpans('echo "a \\" b"')).toEqual([
      { start: 0, end: 4, foreground: '#7fb2ff' },
      { start: 5, end: 13, foreground: '#c4f042' },
    ]);
  });
});

describe('validateShellInput', () => {
  it('treats closed commands as complete', () => {
    expect(validateShellInput('echo ok')).toBe('complete');
    expect(validateShellInput('echo \'ok\' && printf "x"')).toBe('complete');
    expect(validateShellInput('echo "("')).toBe('complete');
  });

  it('keeps unterminated quotes incomplete', () => {
    expect(validateShellInput("echo 'unterminated")).toBe('incomplete');
    expect(validateShellInput('echo "unterminated')).toBe('incomplete');
  });

  it('keeps trailing continuations and open shell brackets incomplete', () => {
    expect(validateShellInput('echo \\')).toBe('incomplete');
    expect(validateShellInput('echo {')).toBe('incomplete');
  });
});
