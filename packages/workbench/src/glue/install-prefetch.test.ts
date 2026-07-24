import { canonicalEddyRequestKey, eddyRequestFromPackageJson } from '@riftydev/npm-client';
import { describe, expect, it, vi } from 'vitest';
import { decideInstallPrefetch, startInstallPrefetch } from './install-prefetch.ts';

const PKG = JSON.stringify({
  name: 'app',
  dependencies: { vite: '^7.0.0' },
  devDependencies: { typescript: '^5.5.0' },
  overrides: { picocolors: '1.1.1' },
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

describe('decideInstallPrefetch (owner-boot composition policy)', () => {
  const base = {
    devFromScratch: true,
    resolverUrl: 'http://eddy.test',
    config: 'cfg-A',
    hasHandle: false,
    prevConfig: undefined as string | undefined,
    isStamped: () => false,
    pinFor: () => undefined as string | undefined,
  };

  it('CLEARS when not from-scratch or the resolver is off — a reload never prefetches', () => {
    expect(decideInstallPrefetch({ ...base, devFromScratch: false })).toEqual({ kind: 'clear' });
    expect(decideInstallPrefetch({ ...base, resolverUrl: undefined })).toEqual({ kind: 'clear' });
  });

  it('KEEPS an in-flight handle for the SAME config — never fires a duplicate POST', () => {
    const isStamped = vi.fn(() => false);
    const pinFor = vi.fn(() => undefined);
    const d = decideInstallPrefetch({
      ...base,
      hasHandle: true,
      prevConfig: 'cfg-A',
      config: 'cfg-A',
      isStamped,
      pinFor,
    });
    expect(d).toEqual({ kind: 'keep' });
    expect(isStamped).not.toHaveBeenCalled(); // dedupe gates BEFORE the stamp read
    expect(pinFor).not.toHaveBeenCalled();
  });

  it('re-primes when the config CHANGED even with a handle in flight', () => {
    const d = decideInstallPrefetch({
      ...base,
      hasHandle: true,
      prevConfig: 'cfg-OLD',
      config: 'cfg-A',
    });
    expect(d).toEqual({ kind: 'start', config: 'cfg-A', closureHash: undefined });
  });

  it('SKIPS the prefetch when a stamp will suppress the install (records the config)', () => {
    const pinFor = vi.fn(() => 'sha256-x');
    const d = decideInstallPrefetch({ ...base, isStamped: () => true, pinFor });
    expect(d).toEqual({ kind: 'skip', config: 'cfg-A' });
    expect(pinFor).not.toHaveBeenCalled(); // no pin read when nothing starts
  });

  it('STARTS pinned by the LEARNED pin over the env pin (ADR-0194)', () => {
    const d = decideInstallPrefetch({
      ...base,
      pinFor: () => 'sha256-learned', // learnedPin ?? envPin resolved by the caller
    });
    expect(d).toEqual({ kind: 'start', config: 'cfg-A', closureHash: 'sha256-learned' });
  });

  it('STARTS unpinned (first boot, no learned/env pin) → the handle POSTs', () => {
    expect(decideInstallPrefetch(base)).toEqual({
      kind: 'start',
      config: 'cfg-A',
      closureHash: undefined,
    });
  });
});
