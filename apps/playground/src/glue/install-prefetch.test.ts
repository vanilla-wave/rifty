import { canonicalEddyRequestKey, eddyRequestFromPackageJson } from '@riftydev/npm-client';
import { describe, expect, it } from 'vitest';
import { startInstallPrefetch } from './install-prefetch.ts';

const PKG = JSON.stringify({
  name: 'app',
  dependencies: { vite: '^7.0.0' },
  devDependencies: { typescript: '^5.5.0' },
  overrides: { esbuild: 'npm:@riftydev/shadow-esbuild@0.21.5' },
});

function fetchSpy() {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), ...(init === undefined ? {} : { init }) });
    return Promise.resolve(new Response('x'));
  }) as typeof fetch;
  return { impl, calls };
}

describe('startInstallPrefetch (ADR-0195 owner-boot prefetch)', () => {
  it('returns a handle whose key matches the request install() derives from the SAME package.json', () => {
    const { impl, calls } = fetchSpy();
    const handle = startInstallPrefetch({
      packageJsonText: PKG,
      resolverUrl: 'http://eddy.test',
      fetchImpl: impl,
    });
    expect(handle).toBeDefined();
    expect(calls.length).toBe(1);
    expect(calls[0]?.init?.method).toBe('POST');
    const request = eddyRequestFromPackageJson(PKG);
    if (!request) throw new Error('setup');
    // The exact key install() computes for this manifest → the prefetch is consumable.
    expect(handle?.take(canonicalEddyRequestKey(request))).not.toBeNull();
  });

  it('GETs by pin when a closure hash is provided', () => {
    const { impl, calls } = fetchSpy();
    startInstallPrefetch({
      packageJsonText: PKG,
      resolverUrl: 'http://eddy.test',
      closureHash: 'sha256-abc',
      fetchImpl: impl,
    });
    expect(calls[0]?.input).toBe('http://eddy.test/bundle/sha256-abc');
  });

  it('is inert without a resolver URL and on a manifest the installer would reject', () => {
    const { impl, calls } = fetchSpy();
    expect(
      startInstallPrefetch({ packageJsonText: PKG, resolverUrl: undefined, fetchImpl: impl }),
    ).toBeUndefined();
    expect(
      startInstallPrefetch({
        packageJsonText: '{not json',
        resolverUrl: 'http://eddy.test',
        fetchImpl: impl,
      }),
    ).toBeUndefined();
    expect(calls.length).toBe(0);
  });
});
