/**
 * Tests for the cross-realm preview-port bridge (ADR-0043).
 *
 * Both ends run in the same Node realm but talk over `BroadcastChannel`, the
 * same primitive the playground uses in production to cross page ↔ worker. A
 * single-realm `BroadcastChannel` distributes messages to other listeners on
 * the same channel name within the same JS realm too, which is exactly what
 * we need to drive both ends from one Vitest worker.
 *
 * Coverage:
 *   1. Round-trip — page-side dispatch reaches the worker handler and the
 *      response surfaces back as a `Response`.
 *   2. POST body bytes survive the hop.
 *   3. Worker handler throw → page-side sees a 502 with the message.
 *   4. No worker listening → page-side dispatch times out as a 502 within
 *      the configured `timeoutMs`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  bridgeCrossRealmPreview,
  previewPortChannelUrl,
  serveCrossRealmPreview,
} from './preview-port.ts';

interface Cleanup {
  add(teardown: () => void): void;
  runAll(): void;
}

function makeCleanup(): Cleanup {
  const teardowns: (() => void)[] = [];
  return {
    add(teardown) {
      teardowns.push(teardown);
    },
    runAll() {
      for (const t of teardowns.splice(0).reverse()) {
        try {
          t();
        } catch {
          /* best effort */
        }
      }
    },
  };
}

const cleanup = makeCleanup();
afterEach(() => cleanup.runAll());

describe('previewPortChannelUrl', () => {
  it('embeds the dev-server port number deterministically', () => {
    expect(previewPortChannelUrl(5174)).toContain('5174');
    expect(previewPortChannelUrl(3000)).toContain('3000');
    expect(previewPortChannelUrl(5174)).not.toEqual(previewPortChannelUrl(3000));
  });

  it('is a parseable URL so `channelNameFor` works on it', () => {
    expect(() => new URL(previewPortChannelUrl(7000))).not.toThrow();
  });
});

describe('cross-realm preview port — happy path', () => {
  it('round-trips a GET → Response across the BroadcastChannel hop', async () => {
    cleanup.add(
      serveCrossRealmPreview(5101, async (req) => {
        expect(req.method).toBe('GET');
        expect(new URL(req.url).pathname).toBe('/hello');
        return new Response('worker-was-here', {
          status: 200,
          headers: { 'X-From': 'worker' },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5101);
    cleanup.add(handler.dispose);

    const response = await handler(new Request('http://preview.local/hello'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-from')).toBe('worker');
    expect(await response.text()).toBe('worker-was-here');
  });

  it('preserves POST body bytes (4 KiB) across the hop', async () => {
    const payload = new Uint8Array(4096);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;

    cleanup.add(
      serveCrossRealmPreview(5102, async (req) => {
        const body = new Uint8Array(await req.arrayBuffer());
        // Echo with checksum so we can assert byte-for-byte.
        let sum = 0;
        for (const b of body) sum = (sum + b) & 0xff;
        return new Response(JSON.stringify({ length: body.length, checksum: sum }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const handler = bridgeCrossRealmPreview(5102);
    cleanup.add(handler.dispose);

    const response = await handler(
      new Request('http://preview.local/echo', { method: 'POST', body: payload }),
    );
    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { length: number; checksum: number };
    expect(parsed.length).toBe(4096);
    let expectedSum = 0;
    for (const b of payload) expectedSum = (expectedSum + b) & 0xff;
    expect(parsed.checksum).toBe(expectedSum);
  });
});

describe('cross-realm preview port — error paths', () => {
  it('surfaces a worker-side throw as a 502 carrying the message', async () => {
    cleanup.add(
      serveCrossRealmPreview(5103, async () => {
        throw new Error('worker-blew-up');
      }),
    );
    const handler = bridgeCrossRealmPreview(5103);
    cleanup.add(handler.dispose);

    const response = await handler(new Request('http://preview.local/'));
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('worker-blew-up');
  });

  it('times out with a 502 when no worker is listening', async () => {
    const handler = bridgeCrossRealmPreview(5104, { timeoutMs: 50 });
    cleanup.add(handler.dispose);

    const started = Date.now();
    const response = await handler(new Request('http://preview.local/'));
    const elapsed = Date.now() - started;
    expect(response.status).toBe(502);
    // Allow a generous upper bound to cover CI jitter without making the
    // test brittle, but verify we're actually using the configured timeout.
    expect(elapsed).toBeLessThan(2000);
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
