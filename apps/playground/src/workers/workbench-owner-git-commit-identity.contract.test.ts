import { makeGit, vfsToGitFs } from '@riftydev/git';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOwnerGitCommitIdentity } from '../glue/git-owner-port.ts';

const CLOCK_MS = 1_700_000_123_987;

afterEach(() => vi.useRealTimers());

async function gitWithConfig(name?: string, email?: string): Promise<ReturnType<typeof makeGit>> {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  const git = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
  await git.init();
  if (name !== undefined) await git.setConfig('user.name', name);
  if (email !== undefined) await git.setConfig('user.email', email);
  return git;
}

function freezeClock(): void {
  vi.useFakeTimers();
  vi.setSystemTime(CLOCK_MS);
}

describe('Workbench owner Git commit identity', () => {
  it('prefers author environment over Git config and accepts decimal seconds', async () => {
    const git = await gitWithConfig('Configured User', 'configured@example.test');

    await expect(
      resolveOwnerGitCommitIdentity(git, {
        GIT_AUTHOR_NAME: 'Environment User',
        GIT_AUTHOR_EMAIL: 'environment@example.test',
        GIT_AUTHOR_DATE: '1700000007',
      }),
    ).resolves.toEqual({
      name: 'Environment User',
      email: 'environment@example.test',
      timestamp: 1_700_000_007,
      timezoneOffset: 0,
    });
  });

  it('preserves empty environment values as present and decimal zero-padding', async () => {
    const git = await gitWithConfig('Configured User', 'configured@example.test');

    await expect(
      resolveOwnerGitCommitIdentity(git, {
        GIT_AUTHOR_NAME: '',
        GIT_AUTHOR_EMAIL: '',
        GIT_AUTHOR_DATE: '0000000007',
      }),
    ).resolves.toEqual({ name: '', email: '', timestamp: 7, timezoneOffset: 0 });
  });

  it('falls back to Git config and whole clock seconds for an invalid date', async () => {
    const git = await gitWithConfig('Configured User', 'configured@example.test');
    freezeClock();

    await expect(
      resolveOwnerGitCommitIdentity(git, { GIT_AUTHOR_DATE: '1700000007Z' }),
    ).resolves.toEqual({
      name: 'Configured User',
      email: 'configured@example.test',
      timestamp: Math.floor(CLOCK_MS / 1_000),
      timezoneOffset: 0,
    });
  });

  it.each(['', '-1', '+1', '1.5', ' 1', '1 ', '0x10'])(
    'rejects %j as a decimal timestamp and uses the clock',
    async (date) => {
      const git = await gitWithConfig();
      freezeClock();

      await expect(resolveOwnerGitCommitIdentity(git, { GIT_AUTHOR_DATE: date })).resolves.toEqual({
        name: 'rifty',
        email: 'rifty@localhost',
        timestamp: Math.floor(CLOCK_MS / 1_000),
        timezoneOffset: 0,
      });
    },
  );
});
