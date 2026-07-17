import { afterEach, describe, expect, it, vi } from 'vitest';
import { SW_FRAME_VERSION, SW_PING, SW_PONG, SW_ROUTING_VERSION } from './protocol.ts';

type ScopeListener = (event: ExtendableMessageEvent) => void;

async function loadMessageListeners(): Promise<ScopeListener[]> {
  const messageListeners: ScopeListener[] = [];
  vi.stubGlobal('self', {
    addEventListener(type: string, listener: EventListener): void {
      if (type === 'message') messageListeners.push(listener as ScopeListener);
    },
    removeEventListener: vi.fn(),
    skipWaiting: vi.fn(async () => {}),
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => []),
    },
    location: { origin: 'https://workbench.invalid' },
    registration: { scope: 'https://workbench.invalid/' },
  });
  await import('./sw.ts');
  return messageListeners;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('service-worker control ping', () => {
  it('replies on the transferred port instead of the global source', async () => {
    const messageListeners = await loadMessageListeners();

    const source = { id: 'page', postMessage: vi.fn() };
    const replyPort = { postMessage: vi.fn(), close: vi.fn() };
    const event = {
      data: {
        type: SW_PING,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      source,
      ports: [replyPort],
    } as unknown as ExtendableMessageEvent;
    for (const listener of messageListeners) listener(event);

    expect(replyPort.postMessage).toHaveBeenCalledWith({
      type: SW_PONG,
      frameVersion: SW_FRAME_VERSION,
      routingVersion: SW_ROUTING_VERSION,
      from: 'service-worker',
    });
    expect(replyPort.close).toHaveBeenCalledTimes(1);
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it('keeps the legacy source reply for a zero-port PING', async () => {
    const messageListeners = await loadMessageListeners();
    const source = { id: 'legacy-page', postMessage: vi.fn() };
    const event = {
      data: {
        type: SW_PING,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      },
      source,
      ports: [],
    } as unknown as ExtendableMessageEvent;
    for (const listener of messageListeners) listener(event);

    expect(source.postMessage).toHaveBeenCalledWith({
      type: SW_PONG,
      frameVersion: SW_FRAME_VERSION,
      routingVersion: SW_ROUTING_VERSION,
      from: 'service-worker',
    });
  });
});
