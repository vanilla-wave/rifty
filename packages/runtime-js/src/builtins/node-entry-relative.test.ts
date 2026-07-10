import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { buildWorkerChildSpec } from './child_process-worker.ts';
import { runNodeEntry } from './node-entry.ts';

describe('Node entry cwd resolution', () => {
  it.each(['src/main.js', './src/main.js'])(
    'runs relative entry %s against cwd instead of as a bare package specifier',
    async (entryPath) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/scratch/src/main.js': 'globalThis.__relativeNodeEntry = "ran";\n',
      });
      (globalThis as Record<string, unknown>).__relativeNodeEntry = 'not-run';

      await runNodeEntry({ vfs, entryPath, cwd: '/scratch' });

      expect((globalThis as Record<string, unknown>).__relativeNodeEntry).toBe('ran');
    },
  );

  it.each([
    ['src/main.js', '/scratch/src/main.js'],
    ['./src/main.js', '/scratch/src/main.js'],
    ['../shared/main.js', '/shared/main.js'],
    ['/absolute/main.js', '/absolute/main.js'],
  ])('seeds an absolute child argv[1] for %s', (entryArg, expected) => {
    const built = buildWorkerChildSpec(
      { command: 'node', args: [entryArg, '--flag'], opts: { cwd: '/scratch' } },
      {
        bootstrapUrl: 'https://rifty.test/node-entry.js',
        parentCwd: '/parent',
        parentEnv: {},
      },
    );

    expect(built.spec.argv).toEqual(['rifty', expected, '--flag']);
  });

  it('resolves against the inherited parent cwd when spawn options omit cwd', () => {
    const built = buildWorkerChildSpec(
      { command: 'node', args: ['src/main.js'], opts: {} },
      {
        bootstrapUrl: 'https://rifty.test/node-entry.js',
        parentCwd: '/parent',
        parentEnv: {},
      },
    );

    expect(built.cwd).toBe('/parent');
    expect(built.spec.argv[1]).toBe('/parent/src/main.js');
  });

  it('reports a missing relative entry with its cwd-resolved absolute path', async () => {
    const vfs = new MemoryFsSync();
    vfs.mkdirSync('/scratch', { recursive: true });

    await expect(runNodeEntry({ vfs, entryPath: 'missing.js', cwd: '/scratch' })).rejects.toThrow(
      "Cannot find module '/scratch/missing.js'",
    );
  });
});
