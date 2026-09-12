/** I5 Contract+RED. Native query/restart oracle: PR316 configuration probe. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as serviceWorker from '../src/index.ts';
import { SW_FRAME_VERSION, SW_PING, SW_ROUTING_VERSION } from '../src/protocol.ts';

interface ConfigurationApi {
  configurePreviewServiceWorkerUrl?(url: string, previewPrefix?: string): string;
  previewPrefixFromServiceWorkerUrl?(url: string): string;
}
const api = serviceWorker as unknown as ConfigurationApi;
const origin = 'https://host.test';
const opaque = 'token=a%20b~c&dup=one&dup=two&blank=&bare&encoded=%2f%2F';
const prefix = '/sandbox/preview-a/';
const configured = `${origin}/sandbox/sw.js?${opaque}&__rifty_preview_prefix=%2Fsandbox%2Fpreview-a%2F`;

type Listener = (event: unknown) => void;
async function loadStaticEntry(scriptUrl: string) {
  const listeners = new Map<string, Set<Listener>>();
  const scope = {
    location: new URL(scriptUrl),
    registration: { scope: `${origin}/sandbox/` },
    clients: { matchAll: async () => [], get: async () => null, claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener(type: string, listener: Listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  vi.resetModules();
  vi.stubGlobal('self', scope);
  await import('../src/sw.ts');
  return {
    async pong() {
      const channel = new MessageChannel();
      const reply = new Promise<Record<string, unknown>>((resolve) => {
        channel.port1.onmessage = (event) => resolve(event.data as Record<string, unknown>);
      });
      try {
        const event = {
          data: {
            type: SW_PING,
            frameVersion: SW_FRAME_VERSION,
            routingVersion: SW_ROUTING_VERSION,
          },
          ports: [channel.port2],
          source: { id: 'host-client' },
        };
        for (const listener of listeners.get('message') ?? []) listener(event);
        return await reply;
      } finally {
        channel.port1.close();
        channel.port2.close();
      }
    },
    async request(path: string, referrer?: string) {
      let routed: Promise<Response> | undefined;
      const event = {
        request: new Request(`${origin}${path}`, {
          ...(referrer === undefined ? {} : { referrer: `${origin}${referrer}` }),
        }),
        clientId: '',
        resultingClientId: '',
        respondWith(response: Promise<Response>) {
          routed = response;
        },
      };
      for (const listener of listeners.get('fetch') ?? []) listener(event);
      return routed === undefined
        ? { intercepted: false }
        : { intercepted: true, status: (await routed).status };
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('I5 immutable static Service Worker configuration', () => {
  it('appends configuration without rewriting the opaque caller query', () => {
    const input = `${origin}/sandbox/sw.js?${opaque}`;
    expect(api.configurePreviewServiceWorkerUrl?.(input, prefix)).toBe(configured);
    expect(api.configurePreviewServiceWorkerUrl?.(input)).toBe(input);
    expect(api.previewPrefixFromServiceWorkerUrl?.(configured)).toBe(prefix);
    expect(api.previewPrefixFromServiceWorkerUrl?.(input)).toBe('/preview/');
  });

  it.each(['', '?', '?x=1&'])('preserves the caller URL delimiter form %s', (suffix) => {
    const input = `${origin}/sandbox/sw.js${suffix}`;
    expect(api.configurePreviewServiceWorkerUrl?.(input)).toBe(input);
    expect(api.configurePreviewServiceWorkerUrl?.(input, prefix)).toBe(
      `${input}${input.includes('?') ? '&' : '?'}__rifty_preview_prefix=%2Fsandbox%2Fpreview-a%2F`,
    );
  });

  it('rejects reserved-key collision, duplicate fields and malformed prefix', () => {
    expect(api.configurePreviewServiceWorkerUrl).toBeTypeOf('function');
    expect(api.previewPrefixFromServiceWorkerUrl).toBeTypeOf('function');
    expect(() => api.configurePreviewServiceWorkerUrl?.(configured, prefix)).toThrow(TypeError);
    for (const query of [
      '__rifty_preview_prefix=%2Fsandbox%2Fp%2F&__rifty_preview_prefix=%2Fsandbox%2Fq%2F',
      '__rifty_preview_prefix=relative',
      '__rifty_preview_prefix=%2Fsandbox%2Fp%3Fquery',
    ])
      expect(() =>
        api.previewPrefixFromServiceWorkerUrl?.(`${origin}/sandbox/sw.js?${query}`),
      ).toThrow(TypeError);
  });

  it('the unchanged static entry reports its captured query prefix and uses it for interception', async () => {
    const first = await loadStaticEntry(configured);
    expect((await first.pong()).previewPrefix).toBe(prefix);
    expect(await first.request(`${prefix}5173/`)).toEqual({ intercepted: true, status: 503 });
    expect(await first.request('/preview/5173/')).toEqual({ intercepted: false });
    expect(await first.request('/sandbox/unrelated.js')).toEqual({ intercepted: false });
  });

  it('a fresh static-entry realm derives the same prefix without a page configuration message', async () => {
    const first = await loadStaticEntry(configured);
    const before = await first.pong();
    const fresh = await loadStaticEntry(configured);
    const after = await fresh.pong();
    expect(before.previewPrefix).toBe(prefix);
    expect(after.previewPrefix).toBe(prefix);
  });

  it('recovers only the configured preview referrer for root-absolute guest requests', async () => {
    const entry = await loadStaticEntry(configured);
    expect(await entry.request('/src/main.ts', `${prefix}5173/`)).toEqual({
      intercepted: true,
      status: 503,
    });
    expect(await entry.request('/src/main.ts', '/preview/5173/')).toEqual({ intercepted: false });
    expect(await entry.request('/src/main.ts', '/sandbox/index.html')).toEqual({
      intercepted: false,
    });
  });

  it('absence retains the old route even under a narrow non-preview scope', async () => {
    const entry = await loadStaticEntry(`${origin}/sandbox/sw.js?${opaque}`);
    expect((await entry.pong()).previewPrefix ?? '/preview/').toBe('/preview/');
    expect(await entry.request('/preview/5173/')).toEqual({ intercepted: true, status: 503 });
  });

  it('rejects invalid static configuration instead of silently installing the default', async () => {
    await expect(
      loadStaticEntry(`${configured}&__rifty_preview_prefix=%2Fother%2F`),
    ).rejects.toThrow();
  });

  it('keeps additive frame compatibility and increments addressing compatibility', () => {
    expect(SW_FRAME_VERSION).toBe('1');
    expect(SW_ROUTING_VERSION).toBe('7');
  });
});
