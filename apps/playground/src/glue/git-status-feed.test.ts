import { makeGit, vfsToGitFs } from '@riftydev/git';
import type { GitIdentity } from '@riftydev/git';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyGitStatusFrame,
  createGitStatusPublisher,
  createGitStatusStore,
  serveGitStatusFeed,
  subscribeGitStatus,
} from './git-status-feed.ts';

const AUTHOR: GitIdentity = {
  name: 'Test',
  email: 't@example.com',
  timestamp: 1_600_000_000,
  timezoneOffset: 0,
};

const teardowns: Array<() => void> = [];

afterEach(() => {
  vi.useRealTimers();
  for (const teardown of teardowns.splice(0)) teardown();
});

async function waitFor(assertion: () => void, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  assertion();
}

describe('git status publisher', () => {
  it('coalesces a save burst into one recompute and skips unchanged deltas', async () => {
    vi.useFakeTimers();
    const status = vi
      .fn()
      .mockResolvedValueOnce([{ filepath: 'a.txt', status: '121' }])
      .mockResolvedValueOnce([{ filepath: 'a.txt', status: '121' }])
      .mockResolvedValueOnce([{ filepath: 'a.txt', status: '122' }]);
    const frames: unknown[] = [];
    const publisher = createGitStatusPublisher({ status }, (frame) => frames.push(frame), {
      debounceMs: 200,
    });

    publisher.schedule();
    publisher.schedule();
    publisher.schedule();
    await vi.advanceTimersByTimeAsync(199);
    expect(status).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(status).toHaveBeenCalledTimes(1);
    expect(frames).toEqual([
      {
        type: 'git-status',
        label: 'rifty-git status',
        entries: [{ path: 'a.txt', code: ' M' }],
      },
    ]);

    publisher.schedule();
    await vi.advanceTimersByTimeAsync(200);
    expect(status).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(1);

    publisher.schedule();
    await vi.advanceTimersByTimeAsync(200);
    expect(status).toHaveBeenCalledTimes(3);
    expect(frames).toHaveLength(2);
    expect(frames.at(-1)).toMatchObject({ entries: [{ path: 'a.txt', code: 'M ' }] });

    publisher.dispose();
  });

  it('does not publish ignored node_modules entries', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/repo', { recursive: true });
    const g = makeGit({ fs: vfsToGitFs(vfs), dir: '/repo' });
    await g.init();
    await vfs.writeFile('/repo/.gitignore', 'node_modules/**\n');
    await g.add('.gitignore');
    await g.commit({ message: 'ignore deps', author: AUTHOR, committer: AUTHOR });
    await vfs.mkdir('/repo/node_modules/pkg', { recursive: true });
    await vfs.writeFile('/repo/node_modules/pkg/index.js', 'ignored\n');
    await vfs.writeFile('/repo/src.js', 'tracked\n');

    const frames: unknown[] = [];
    const publisher = createGitStatusPublisher(g, (frame) => frames.push(frame), {
      debounceMs: 1,
    });
    await publisher.publishNow();

    expect(frames).toEqual([
      {
        type: 'git-status',
        label: 'rifty-git status',
        entries: [{ path: 'src.js', code: '??' }],
      },
    ]);
    publisher.dispose();
  });
});

describe('git status page channel/cache', () => {
  it('serves current status on subscribe and applies frames as a path→code cache', async () => {
    const source = { status: vi.fn().mockResolvedValue([{ filepath: 'a.txt', status: '121' }]) };
    const server = serveGitStatusFeed('git-status-channel', source, { debounceMs: 10 });
    teardowns.push(() => server.dispose());
    const frames: Parameters<typeof applyGitStatusFrame>[1][] = [];
    teardowns.push(subscribeGitStatus('git-status-channel', (frame) => frames.push(frame)));

    await waitFor(() => expect(frames).toHaveLength(1));

    const cache = new Map<string, string>();
    const first = frames[0];
    if (first === undefined) throw new Error('expected status frame');
    applyGitStatusFrame(cache, first);
    expect([...cache.entries()]).toEqual([['a.txt', ' M']]);

    applyGitStatusFrame(cache, {
      type: 'git-status',
      label: 'rifty-git status',
      entries: [{ path: 'b.txt', code: '??' }],
    });
    expect([...cache.entries()]).toEqual([['b.txt', '??']]);
  });

  it('creates a page cache that clears independently of owner updates', async () => {
    const source = { status: vi.fn().mockResolvedValue([{ filepath: 'a.txt', status: '121' }]) };
    const server = serveGitStatusFeed('git-status-store', source, { debounceMs: 10 });
    teardowns.push(() => server.dispose());
    const store = createGitStatusStore('git-status-store');
    teardowns.push(() => store.dispose());

    await waitFor(() => expect([...store.map.entries()]).toEqual([['a.txt', ' M']]));

    store.clear();
    expect([...store.map.entries()]).toEqual([]);
  });
});
