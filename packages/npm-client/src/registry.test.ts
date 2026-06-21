import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegistryClient, getRegistryBaseUrl } from './registry.ts';

interface RiftyGlobals {
  __RIFTY_REGISTRY_URL__?: string | undefined;
}

const g = globalThis as typeof globalThis & RiftyGlobals;

describe('getRegistryBaseUrl', () => {
  const savedGlobal = g.__RIFTY_REGISTRY_URL__;
  const savedEnv = process.env.REGISTRY_BASE_URL;

  beforeEach(() => {
    g.__RIFTY_REGISTRY_URL__ = undefined;
    // biome-ignore lint/performance/noDelete: process.env coerces assignments to strings; only delete truly unsets the key, which the getRegistryBaseUrl default-fallback test requires.
    delete process.env.REGISTRY_BASE_URL;
  });

  afterEach(() => {
    g.__RIFTY_REGISTRY_URL__ = savedGlobal;
    if (savedEnv === undefined) {
      // biome-ignore lint/performance/noDelete: restoring "not set" requires delete, not = undefined (which would leave the literal "undefined" string).
      delete process.env.REGISTRY_BASE_URL;
    } else {
      process.env.REGISTRY_BASE_URL = savedEnv;
    }
  });

  it('defaults to /npm-registry when no source set', () => {
    expect(getRegistryBaseUrl()).toBe('/npm-registry');
  });

  it('reads globalThis.__RIFTY_REGISTRY_URL__ (playground bootstrap path)', () => {
    g.__RIFTY_REGISTRY_URL__ = 'https://proxy.example.com/npm-registry';
    expect(getRegistryBaseUrl()).toBe('https://proxy.example.com/npm-registry');
  });

  it('reads process.env.REGISTRY_BASE_URL (Node-side test path)', () => {
    process.env.REGISTRY_BASE_URL = 'http://localhost:4873';
    expect(getRegistryBaseUrl()).toBe('http://localhost:4873');
  });

  it('global takes precedence over process.env (playground wins over harness)', () => {
    g.__RIFTY_REGISTRY_URL__ = 'https://global.example';
    process.env.REGISTRY_BASE_URL = 'http://env.example';
    expect(getRegistryBaseUrl()).toBe('https://global.example');
  });
});

describe('RegistryClient — uses getRegistryBaseUrl by default', () => {
  const savedGlobal = g.__RIFTY_REGISTRY_URL__;

  afterEach(() => {
    g.__RIFTY_REGISTRY_URL__ = savedGlobal;
  });

  it('honors __RIFTY_REGISTRY_URL__ in the constructed client', () => {
    g.__RIFTY_REGISTRY_URL__ = 'https://custom.example/r';
    const client = new RegistryClient({ fetch: async () => new Response('') });
    expect(client.baseUrl).toBe('https://custom.example/r');
  });

  it('falls back to /npm-registry when nothing is set', () => {
    g.__RIFTY_REGISTRY_URL__ = undefined;
    const client = new RegistryClient({ fetch: async () => new Response('') });
    expect(client.baseUrl).toBe('/npm-registry');
  });

  it('explicit baseUrl option still wins over global', () => {
    g.__RIFTY_REGISTRY_URL__ = 'https://global.example';
    const client = new RegistryClient({
      baseUrl: 'https://explicit.example',
      fetch: async () => new Response(''),
    });
    expect(client.baseUrl).toBe('https://explicit.example');
  });
});

describe('RegistryClient — transient-failure retry (429/5xx/network)', () => {
  type Step = { status: number; body?: unknown; headers?: Record<string, string> } | 'throw';

  function makeFetch(steps: Step[]): { fetch: typeof fetch; count: () => number } {
    let i = 0;
    const fetcher = (async () => {
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      if (step === undefined) throw new Error('makeFetch: empty step list');
      if (step === 'throw') throw new TypeError('network down');
      return new Response(step.body === undefined ? '{}' : JSON.stringify(step.body), {
        status: step.status,
        headers: step.headers,
      });
    }) as unknown as typeof fetch;
    return { fetch: fetcher, count: () => i };
  }

  function sleepSpy(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
    const delays: number[] = [];
    return {
      sleep: async (ms: number) => {
        delays.push(ms);
      },
      delays,
    };
  }

  it('retries a 429 then succeeds (exponential backoff)', async () => {
    const { fetch, count } = makeFetch([
      { status: 429 },
      { status: 429 },
      { status: 200, body: { name: 'x', versions: {} } },
    ]);
    const s = sleepSpy();
    const client = new RegistryClient({ baseUrl: 'https://r', fetch, sleep: s.sleep });
    const pack = await client.getPackument('x');
    expect(pack.name).toBe('x');
    expect(count()).toBe(3); // two retries + the success
    expect(s.delays).toEqual([300, 600]);
  });

  it('honors a numeric Retry-After header', async () => {
    const { fetch } = makeFetch([
      { status: 429, headers: { 'retry-after': '2' } },
      { status: 200, body: { name: 'x', versions: {} } },
    ]);
    const s = sleepSpy();
    const client = new RegistryClient({ baseUrl: 'https://r', fetch, sleep: s.sleep });
    await client.getPackument('x');
    expect(s.delays).toEqual([2000]);
  });

  it('honors an HTTP-date Retry-After header (clamped to the cap; past dates → 0)', async () => {
    // A far-future date clamps to MAX_RETRY_DELAY_MS (8s); a past date floors to 0.
    // Both are deterministic regardless of the current wall clock.
    const future = makeFetch([
      { status: 429, headers: { 'retry-after': 'Wed, 01 Jan 2099 00:00:00 GMT' } },
      { status: 200, body: { name: 'x', versions: {} } },
    ]);
    const sFuture = sleepSpy();
    await new RegistryClient({
      baseUrl: 'https://r',
      fetch: future.fetch,
      sleep: sFuture.sleep,
    }).getPackument('x');
    expect(sFuture.delays).toEqual([8000]);

    const past = makeFetch([
      { status: 429, headers: { 'retry-after': 'Thu, 01 Jan 1970 00:00:00 GMT' } },
      { status: 200, body: { name: 'x', versions: {} } },
    ]);
    const sPast = sleepSpy();
    await new RegistryClient({
      baseUrl: 'https://r',
      fetch: past.fetch,
      sleep: sPast.sleep,
    }).getPackument('x');
    expect(sPast.delays).toEqual([0]);
  });

  it('maxRetries: 0 disables retry — a 429 throws immediately, no sleep', async () => {
    const { fetch, count } = makeFetch([{ status: 429 }]);
    const s = sleepSpy();
    const client = new RegistryClient({
      baseUrl: 'https://r',
      fetch,
      sleep: s.sleep,
      maxRetries: 0,
    });
    await expect(client.getPackument('x')).rejects.toThrow('Failed to fetch packument x: 429');
    expect(count()).toBe(1);
    expect(s.delays).toEqual([]);
  });

  it('gives up after maxRetries and throws the status-shaped error', async () => {
    const { fetch, count } = makeFetch([{ status: 429 }]);
    const s = sleepSpy();
    const client = new RegistryClient({
      baseUrl: 'https://r',
      fetch,
      sleep: s.sleep,
      maxRetries: 2,
    });
    await expect(client.getPackument('left-pad')).rejects.toThrow(
      'Failed to fetch packument left-pad: 429',
    );
    expect(count()).toBe(3); // 1 + maxRetries
    expect(s.delays).toEqual([300, 600]);
  });

  it('does NOT retry a permanent 4xx (404)', async () => {
    const { fetch, count } = makeFetch([{ status: 404 }]);
    const s = sleepSpy();
    const client = new RegistryClient({ baseUrl: 'https://r', fetch, sleep: s.sleep });
    await expect(client.getPackument('nope')).rejects.toThrow(
      'Failed to fetch packument nope: 404',
    );
    expect(count()).toBe(1);
    expect(s.delays).toEqual([]);
  });

  it('retries a 5xx then succeeds', async () => {
    const { fetch, count } = makeFetch([
      { status: 503 },
      { status: 200, body: { name: 'x', versions: {} } },
    ]);
    const client = new RegistryClient({ baseUrl: 'https://r', fetch, sleep: async () => {} });
    await client.getPackument('x');
    expect(count()).toBe(2);
  });

  it('retries a thrown network error then succeeds', async () => {
    const { fetch, count } = makeFetch([
      'throw',
      { status: 200, body: { name: 'x', versions: {} } },
    ]);
    const client = new RegistryClient({ baseUrl: 'https://r', fetch, sleep: async () => {} });
    await client.getPackument('x');
    expect(count()).toBe(2);
  });

  it('rethrows a persistent network error after exhausting retries', async () => {
    const { fetch } = makeFetch(['throw']);
    const client = new RegistryClient({
      baseUrl: 'https://r',
      fetch,
      sleep: async () => {},
      maxRetries: 1,
    });
    await expect(client.getPackument('x')).rejects.toThrow('network down');
  });

  it('getTarball retries a 429 then returns the bytes', async () => {
    let i = 0;
    const fetch = (async () => {
      i += 1;
      if (i === 1) return new Response('', { status: 429 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const client = new RegistryClient({ baseUrl: 'https://r', fetch, sleep: async () => {} });
    const bytes = await client.getTarball('https://r/x/-/x-1.tgz');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(i).toBe(2);
  });
});
