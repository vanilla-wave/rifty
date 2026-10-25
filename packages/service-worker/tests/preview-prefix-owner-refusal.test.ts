/** I5/ADR-0160: configured addressing reaches the unchanged real owner bindings. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SW_FRAME_VERSION,
  SW_PREVIEW_READY,
  SW_ROUTING_VERSION,
  createPreviewInterceptor,
} from '../src/index.ts';

const prefix = '/sandbox/preview-a/';
const origin = 'https://host.test';
type Listener = (event: unknown) => void;

function browserClient(id: string, type: ClientTypes = 'window') {
  return { id, type, postMessage: vi.fn<(message: unknown, transfer: Transferable[]) => void>() };
}
type BrowserClient = ReturnType<typeof browserClient>;

function browserBoundary(clients: BrowserClient[]) {
  const listeners = new Map<string, Set<Listener>>();
  const scope = {
    location: new URL(`${origin}/sandbox/sw.js`),
    clients: {
      async matchAll(options: { type?: ClientTypes }) {
        return clients.filter(
          (client) => options.type === undefined || client.type === options.type,
        );
      },
      async get(id: string) {
        return clients.find((client) => client.id === id);
      },
    },
    addEventListener(type: string, listener: Listener) {
      const group = listeners.get(type) ?? new Set<Listener>();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  const interceptor = createPreviewInterceptor(scope as unknown as ServiceWorkerGlobalScope, {
    previewPrefix: prefix,
    timeoutMs: 30,
  });
  return {
    teardown: () => interceptor.teardown(),
    ready(
      client: BrowserClient,
      versions = { frame: SW_FRAME_VERSION, routing: SW_ROUTING_VERSION },
    ) {
      const event = {
        source: client,
        data: {
          type: SW_PREVIEW_READY,
          frameVersion: versions.frame,
          routingVersion: versions.routing,
          ports: [5173],
          ownerToken: client.id,
        },
      };
      for (const listener of listeners.get('message') ?? []) listener(event);
    },
    fetch(clientId = '', resultingClientId = '') {
      const request = new Request(`${origin}${prefix}5173/`);
      // Node cannot construct native navigation Requests; these are browser inputs.
      if (resultingClientId) {
        Object.defineProperties(request, {
          mode: { value: 'navigate' },
          destination: { value: 'document' },
        });
      }
      let response: Promise<Response> | undefined;
      const event = {
        request,
        clientId,
        resultingClientId,
        respondWith(result: Promise<Response>) {
          response = result;
        },
      };
      for (const listener of listeners.get('fetch') ?? []) listener(event);
      if (response === undefined) throw new Error('Configured preview was not intercepted');
      return response;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('configured preview retains owner refusal', () => {
  it.each(['window', 'worker'] as const)('refuses ambiguous %s owners', async (type) => {
    const clients = [browserClient('owner-a', type), browserClient('owner-b', type)];
    const browser = browserBoundary(clients);
    try {
      for (const client of clients) browser.ready(client);
      const response = await browser.fetch('', 'new-preview-document');
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('No client to serve preview port 5173');
      for (const client of clients) expect(client.postMessage).not.toHaveBeenCalled();
    } finally {
      browser.teardown();
    }
  });

  it('refuses an owner that never signals readiness within the existing deadline', async () => {
    vi.useFakeTimers();
    const owner = browserClient('unready-owner');
    const browser = browserBoundary([owner]);
    try {
      const response = browser.fetch(owner.id);
      await vi.advanceTimersByTimeAsync(31);
      expect((await response).status).toBe(503);
      expect(await (await response).text()).toBe('preview-bridge not ready within 30ms');
      expect(owner.postMessage).not.toHaveBeenCalled();
    } finally {
      browser.teardown();
    }
  });

  it.each(['frame', 'routing'] as const)(
    'refuses an owner with a mismatched %s version',
    async (axis) => {
      const owner = browserClient('mismatched-owner');
      const browser = browserBoundary([owner]);
      try {
        browser.ready(owner, {
          frame: SW_FRAME_VERSION,
          routing: SW_ROUTING_VERSION,
          [axis]: 'old',
        });
        const response = await browser.fetch(owner.id);
        expect(response.status).toBe(503);
        expect(await response.text()).toBe('protocol version mismatch');
        expect(owner.postMessage).not.toHaveBeenCalled();
      } finally {
        browser.teardown();
      }
    },
  );

  it('rejects readiness from a client served a configured preview document', async () => {
    vi.useFakeTimers();
    const previewClient = browserClient('preview-document');
    const browser = browserBoundary([previewClient]);
    try {
      const navigation = browser.fetch('', previewClient.id);
      await vi.advanceTimersByTimeAsync(31);
      expect((await navigation).status).toBe(503);
      browser.ready(previewClient);
      const next = browser.fetch('', 'another-preview-document');
      await vi.advanceTimersByTimeAsync(31);
      expect((await next).status).toBe(503);
      expect(await (await next).text()).toBe('preview-bridge not ready within 30ms');
      expect(previewClient.postMessage).not.toHaveBeenCalled();
    } finally {
      browser.teardown();
    }
  });
});
