import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it, vi } from 'vitest';

async function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown }
  | { status: 'pending' }
> {
  return Promise.race([
    promise.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    ),
    new Promise<{ status: 'pending' }>((resolve) => {
      setTimeout(() => resolve({ status: 'pending' }), ms);
    }),
  ]);
}

function withNoMessageChannel<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.MessageChannel;
  Object.defineProperty(globalThis, 'MessageChannel', {
    configurable: true,
    value: undefined,
  });
  return fn().finally(() => {
    Object.defineProperty(globalThis, 'MessageChannel', {
      configurable: true,
      value: original,
    });
    vi.resetModules();
  });
}

describe('packSerializedResponse body fallback', () => {
  it('refuses to drain text/event-stream when ReadableStream transfer is unavailable', async () => {
    await withNoMessageChannel(async () => {
      const { packSerializedResponse } = await import('./body-transport.ts');
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([100, 97, 116, 97, 58, 32, 49, 10, 10]));
        },
      });

      const settled = await settleWithin(
        packSerializedResponse({
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
          body,
        }),
        20,
      );

      expect(settled.status).toBe('rejected');
      if (settled.status !== 'rejected') return;
      expect(settled.reason).toBeInstanceOf(NotImplementedError);
      expect((settled.reason as NotImplementedError).feature).toBe(
        'service-worker.preview.sse-drain-fallback',
      );
    });
  });
});
