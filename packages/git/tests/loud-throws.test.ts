/**
 * Network-verb transport guards — the browser ceiling made LOUD. Smart-HTTP is
 * the ONLY supported git transport (ssh/git/ftp/... → NotImplementedError); a
 * cross-origin smart-HTTP target with no CORS proxy is unreachable in a browser
 * and throws a directed error BEFORE any network call. The CORS guard is INERT
 * in Node (no `globalThis.location`) so real-server integration tests proceed.
 *
 * All guards fire before the network, so these run over a real MemoryVfs with no
 * server. The "corsProxy present → guard passes" case injects an http plugin
 * whose request immediately rejects with a sentinel: observing that sentinel
 * proves the guard was cleared and the real isomorphic-git path was entered.
 */
import { NotImplementedError } from '@riftydev/io';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, describe, expect, it } from 'vitest';
import { mapGitNetworkError } from '../src/errors.ts';
import { vfsToGitFs } from '../src/fs-adapter.ts';
import { makeGit } from '../src/git.ts';

const g = globalThis as { location?: { origin?: string } };

async function freshGit(over: Parameters<typeof makeGit>[0] | Record<string, unknown> = {}) {
  const vfs = new MemoryVfs();
  await vfs.mkdir('/repo', { recursive: true });
  return makeGit({
    fs: vfsToGitFs(vfs),
    dir: '/repo',
    corsProxy: '',
    ...(over as object),
  });
}

describe('transport guard (clone)', () => {
  it('ssh:// → Not implemented: git.transport.ssh', async () => {
    const git = await freshGit();
    await expect(git.clone({ url: 'ssh://github.com/x/y.git' })).rejects.toThrow(
      /Not implemented: git\.transport\.ssh/,
    );
  });

  it('git:// → Not implemented: git.transport.git', async () => {
    const git = await freshGit();
    await expect(git.clone({ url: 'git://host/x' })).rejects.toThrow(
      /Not implemented: git\.transport\.git/,
    );
  });

  it('scp-like git@host:path → git.transport.ssh', async () => {
    const git = await freshGit();
    await expect(git.clone({ url: 'git@github.com:x/y.git' })).rejects.toThrow(
      /Not implemented: git\.transport\.ssh/,
    );
  });

  it('ftp:// → git.transport.ftp', async () => {
    const git = await freshGit();
    await expect(git.clone({ url: 'ftp://host/x' })).rejects.toThrow(
      /Not implemented: git\.transport\.ftp/,
    );
  });

  it('the rejection is a real NotImplementedError instance', async () => {
    const git = await freshGit();
    await expect(git.clone({ url: 'ssh://github.com/x/y.git' })).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});

describe('browser CORS guard (clone)', () => {
  const savedLocation = g.location;
  afterEach(() => {
    // Restore: undefined ⇒ guard inert (Node), matching the pre-test state.
    g.location = savedLocation;
  });

  it('cross-origin + no corsProxy → Not implemented: git.cors', async () => {
    g.location = { origin: 'https://app.example' };
    const git = await freshGit({ corsProxy: '' });
    await expect(git.clone({ url: 'https://github.com/x/y.git' })).rejects.toThrow(
      /Not implemented: git\.cors/,
    );
  });

  it('corsProxy present → guard passes, real path entered (sentinel surfaces)', async () => {
    g.location = { origin: 'https://app.example' };
    const sentinel = new Error('SENTINEL_NET_BOUNDARY');
    // Inject an http plugin whose request rejects immediately: reaching it proves
    // the CORS guard was cleared (cross-origin + proxy present → reachable).
    const http = {
      request: () => Promise.reject(sentinel),
    } as unknown as Parameters<typeof makeGit>[0]['http'];
    const git = await freshGit({ http, corsProxy: 'https://proxy.example' });
    await expect(git.clone({ url: 'https://github.com/x/y.git' })).rejects.toThrow(
      /SENTINEL_NET_BOUNDARY/,
    );
  });

  it('same-origin + no corsProxy → guard passes (sentinel surfaces, not git.cors)', async () => {
    g.location = { origin: 'https://github.com' };
    const sentinel = new Error('SENTINEL_SAME_ORIGIN');
    const http = {
      request: () => Promise.reject(sentinel),
    } as unknown as Parameters<typeof makeGit>[0]['http'];
    const git = await freshGit({ http, corsProxy: '' });
    await expect(git.clone({ url: 'https://github.com/x/y.git' })).rejects.toThrow(
      /SENTINEL_SAME_ORIGIN/,
    );
  });
});

describe('mapGitNetworkError', () => {
  it('a shallow push error rethrows as a directed message (mentions shallow)', () => {
    const shallowErr = { code: 'GitPushError', message: 'shallow push not allowed' };
    expect(() => mapGitNetworkError(shallowErr)).toThrow(/shallow/i);
  });

  it('an error whose message mentions shallow is enriched (mentions push/shallow)', () => {
    const err = new Error('Cannot push from a shallow clone');
    let caught: unknown;
    try {
      mapGitNetworkError(err);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/shallow/i);
    expect((caught as Error).message).toMatch(/push/i);
  });

  it('a generic error rethrows unchanged (same instance, not swallowed)', () => {
    const generic = new Error('ECONNREFUSED 127.0.0.1:443');
    let caught: unknown;
    try {
      mapGitNetworkError(generic);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(generic);
  });

  it('never returns — always throws (never swallows)', () => {
    expect(() => mapGitNetworkError(new Error('anything'))).toThrow();
    expect(() => mapGitNetworkError('plain string')).toThrow();
  });
});
