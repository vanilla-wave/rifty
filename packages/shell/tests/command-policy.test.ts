import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { Shell, type ShellOptions } from '../src/index.ts';

type PolicyOptions = ShellOptions & {
  assertCommand?: (name: string, args: readonly string[]) => void;
  allowBackground?: boolean;
};

describe('Shell dispatch policy', () => {
  it('checks expanded commands at dispatch, including pipes, without running rejected writes', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/work', {});
    const calls: [string, readonly string[]][] = [];
    const options: PolicyOptions = {
      cwd: '/work',
      env: { COMMAND: 'touch' },
      fileSystem: fs,
      assertCommand(name, args) {
        calls.push([name, args]);
        if (name === 'touch') throw new Error('command denied');
      },
    };
    const shell = new Shell(options);
    await expect(shell.run('false && touch skipped ; echo ok | $COMMAND denied')).rejects.toThrow(
      'command denied',
    );
    expect(calls).toEqual([
      ['false', []],
      ['echo', ['ok']],
      ['touch', ['denied']],
    ]);
    expect(fs.existsSync('/work/denied')).toBe(false);
  });

  it('rejects background operators before any segment starts, while quoted ampersands work', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/work', {});
    const options: PolicyOptions = { cwd: '/work', fileSystem: fs, allowBackground: false };
    const shell = new Shell(options);
    try {
      await expect(shell.run('touch foreground ; touch background &')).rejects.toThrow(
        'shell.background',
      );
      await expect(shell.run('touch foreground & touch background')).rejects.toThrow(
        'shell.background',
      );
      expect(fs.readdirSync('/work')).toEqual([]);
      expect((await shell.run('echo "&"')).stdout).toBe('&\n');
    } finally {
      await shell.dispose();
    }
  });

  it('inherits command policy into the existing background clone', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/work', {});
    const options: PolicyOptions = {
      cwd: '/work',
      fileSystem: fs,
      assertCommand() {
        throw new Error('command denied');
      },
    };
    const shell = new Shell(options);
    await shell.run('touch denied &');
    await shell.dispose();
    expect(fs.existsSync('/work/denied')).toBe(false);
  });
});
