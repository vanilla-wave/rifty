import { describe, expect, it } from 'vitest';
import { startEddyPrefetch } from './eddy-prefetch.ts';
import { canonicalEddyRequestKey } from './eddy-request.ts';

const REQUEST = { dependencies: { debug: '^4.4.1' }, optionalDependencies: {} };
const KEY = canonicalEddyRequestKey(REQUEST, 'cached');

function fetchSpy(response: () => Promise<Response>) {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), ...(init === undefined ? {} : { init }) });
    return response();
  }) as typeof fetch;
  return { impl, calls };
}

describe('startEddyPrefetch', () => {
  it('POSTs the dep-set (CORS-simple, no content-type) when no closure hash is pinned', () => {
    const { impl, calls } = fetchSpy(async () => new Response('x'));
    startEddyPrefetch({ resolverUrl: 'http://eddy.test', request: REQUEST, fetchImpl: impl });
    expect(calls.length).toBe(1);
    expect(calls[0]?.input).toBe('http://eddy.test');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toBeUndefined();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(REQUEST);
  });

  it('GETs /bundle/<hash> when a closure hash is pinned, and exposes the hash', () => {
    const { impl, calls } = fetchSpy(async () => new Response('x'));
    const handle = startEddyPrefetch({
      resolverUrl: 'http://eddy.test/',
      request: REQUEST,
      closureHash: 'sha256-ab/cd=',
      fetchImpl: impl,
    });
    expect(calls[0]?.input).toBe('http://eddy.test/bundle/sha256-ab%2Fcd%3D');
    expect(calls[0]?.init).toBeUndefined();
    expect(handle.closureHash).toBe('sha256-ab/cd=');
  });

  it('take() is one-shot and requires a matching canonical key', async () => {
    const { impl } = fetchSpy(async () => new Response('bundle-bytes'));
    const handle = startEddyPrefetch({
      resolverUrl: 'http://eddy.test',
      request: REQUEST,
      fetchImpl: impl,
    });
    expect(handle.take(canonicalEddyRequestKey({ ...REQUEST, dependencies: { other: '1' } }))).toBeNull();
    const hit = handle.take(KEY);
    expect(hit).not.toBeNull();
    expect(await (hit as Promise<Response>).then((r) => r.text())).toBe('bundle-bytes');
    expect(handle.take(KEY)).toBeNull(); // consumed
  });

  it('a prefer mismatch is a key mismatch', () => {
    const { impl } = fetchSpy(async () => new Response('x'));
    const handle = startEddyPrefetch({
      resolverUrl: 'http://eddy.test',
      request: REQUEST,
      prefer: 'online',
      fetchImpl: impl,
    });
    expect(handle.take(KEY)).toBeNull(); // KEY is the 'cached' key
    expect(handle.take(canonicalEddyRequestKey(REQUEST, 'online'))).not.toBeNull();
  });

  it('an untaken failed prefetch is not an unhandled rejection; a taken one still rejects', async () => {
    const { impl } = fetchSpy(async () => {
      throw new Error('network down');
    });
    // Untaken: constructing + dropping must not blow up the process (vitest
    // fails the run on unhandled rejections).
    startEddyPrefetch({ resolverUrl: 'http://eddy.test', request: REQUEST, fetchImpl: impl });
    await new Promise((r) => setTimeout(r, 10));
    // Taken: the consumer sees the original rejection.
    const handle = startEddyPrefetch({
      resolverUrl: 'http://eddy.test',
      request: REQUEST,
      fetchImpl: impl,
    });
    await expect(handle.take(KEY)).rejects.toThrow('network down');
  });
});
