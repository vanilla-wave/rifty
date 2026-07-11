import { describe, expect, it, vi } from 'vitest';
import { attachTsLspOwnerChannel } from './ts-lsp-owner-adapter.ts';

describe('page TS-LSP owner adapter', () => {
  it('stamps outbound requests and filters inbound responses by protocol and owner', async () => {
    const rawListeners = new Set<(message: unknown) => void>();
    const sendRawMessage = vi.fn(async () => {});
    const close = vi.fn();
    const owner = attachTsLspOwnerChannel({
      snapshotPort: 'owner:a',
      sendRawMessage,
      onRawMessage: (listener) => {
        rawListeners.add(listener);
        return () => rawListeners.delete(listener);
      },
      close,
    });

    const responses: unknown[] = [];
    owner.onTsLsp((message) => responses.push(message));
    owner.sendTsLsp({ type: 'rifty:ts-lsp', request: { id: 1, type: 'ts:init' } });
    await Promise.resolve();

    expect(sendRawMessage).toHaveBeenCalledWith({
      type: 'rifty:ts-lsp',
      request: { id: 1, type: 'ts:init' },
      ownerBridgeKey: 'owner:a',
    });

    for (const listener of rawListeners) {
      listener({
        type: 'rifty:ts-lsp',
        response: { id: 1, ok: true, kind: 'init', result: {} },
        ownerBridgeKey: 'owner:b',
      });
      listener({ type: 'host:other', ownerBridgeKey: 'owner:a' });
      listener({
        type: 'rifty:ts-lsp',
        response: { id: 1, ok: true, kind: 'init', result: {} },
        ownerBridgeKey: 'owner:a',
      });
    }
    expect(responses).toHaveLength(1);

    owner.close();
    expect(rawListeners.size).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
