/**
 * Tests for the CLIENT side of cross-realm http.request loopback (ADR-0180).
 *
 * `dispatchCrossRealmLoopback` is what `routeClientRequest`'s `{kind:'refused'}`
 * branch calls before deciding `ECONNREFUSED`: it probes the per-port preview
 * `BroadcastChannel`, and a realm that OWNS the port emits an `accept` frame +
 * serves the reply. No `accept` within the probe window → resolves `null` (the
 * caller emits Node-shaped `ECONNREFUSED`).
 *
 * Both ends run in one Node realm over `BroadcastChannel` (same primitive the
 * playground uses page↔worker), exactly like preview-port.test.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { channelNameFor } from '../ws/bridge.ts';
import {
  dispatchCrossRealmLoopback,
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

const decoder = new TextDecoder();

describe('cross-realm loopback client — ownership accept + refuse (ADR-0180)', () => {
  it('resolves the owning realm Response for a GET round-trip', async () => {
    cleanup.add(
      serveCrossRealmPreview(6001, async (req) => {
        expect(req.method).toBe('GET');
        expect(new URL(req.url).pathname).toBe('/users');
        return new Response('remote-users', { status: 200, headers: { 'X-From': 'api' } });
      }),
    );

    const res = await dispatchCrossRealmLoopback(6001, {
      url: 'http://localhost:6001/users',
      method: 'GET',
      headers: {},
      body: null,
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    expect(res?.headers.get('x-from')).toBe('api');
    expect(await res?.text()).toBe('remote-users');
  });

  it('resolves null (→ ECONNREFUSED) when no realm owns the port, within the probe window', async () => {
    const started = Date.now();
    const res = await dispatchCrossRealmLoopback(
      6002,
      { url: 'http://localhost:6002/x', method: 'GET', headers: {}, body: null },
      { probeTimeoutMs: 80 },
    );
    const elapsed = Date.now() - started;

    expect(res).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(elapsed).toBeLessThan(2000);
  });

  it('emits an accept frame IMMEDIATELY on a request, before the (slow) reply', async () => {
    // A realm whose handler is slow must still be recognised as the owner at
    // once — the accept frame is what separates "no listener" from "slow app".
    const order: string[] = [];
    cleanup.add(
      serveCrossRealmPreview(6003, async () => {
        await new Promise((r) => setTimeout(r, 60));
        return new Response('slow', { status: 200 });
      }),
    );

    const channel = new BroadcastChannel(channelNameFor(previewPortChannelUrl(6003)));
    cleanup.add(() => channel.close());
    channel.addEventListener('message', (e: MessageEvent) => {
      const f = e.data as { type?: string };
      if (f?.type === 'accept') order.push('accept');
      if (f?.type === 'reply' || f?.type === 'reply-stream-start') order.push('reply');
    });

    const res = await dispatchCrossRealmLoopback(
      6003,
      { url: 'http://localhost:6003/', method: 'GET', headers: {}, body: null },
      { probeTimeoutMs: 30, idleTimeoutMs: 1000 },
    );

    // accept arrived first (well under probeTimeoutMs) and the slow reply still
    // resolved — proving the probe window did not refuse a live-but-slow owner.
    expect(res?.status).toBe(200);
    expect(order[0]).toBe('accept');
    expect(order).toContain('reply');
  });

  it('round-trips a POST body intact to the owning realm', async () => {
    const payload = new Uint8Array(2048);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff;

    cleanup.add(
      serveCrossRealmPreview(6004, async (req) => {
        const body = new Uint8Array(await req.arrayBuffer());
        let sum = 0;
        for (const b of body) sum = (sum + b) & 0xff;
        return new Response(JSON.stringify({ length: body.length, checksum: sum }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const res = await dispatchCrossRealmLoopback(6004, {
      url: 'http://localhost:6004/upload',
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: payload,
    });

    expect(res?.status).toBe(200);
    const parsed = (await res?.json()) as { length: number; checksum: number };
    expect(parsed.length).toBe(2048);
    let expectedSum = 0;
    for (const b of payload) expectedSum = (expectedSum + b) & 0xff;
    expect(parsed.checksum).toBe(expectedSum);
  });

  it('delivers a streamed SSE body chunk-by-chunk (readable before the server ends)', async () => {
    cleanup.add(
      serveCrossRealmPreview(6005, async () => {
        let i = 0;
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (i >= 3) {
              controller.close();
              return;
            }
            await new Promise((r) => setTimeout(r, 20));
            controller.enqueue(new TextEncoder().encode(`data: ${i++}\n\n`));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const res = await dispatchCrossRealmLoopback(6005, {
      url: 'http://localhost:6005/events',
      method: 'GET',
      headers: {},
      body: null,
    });
    expect(res?.status).toBe(200);
    expect(res?.body).toBeInstanceOf(ReadableStream);

    // Read events one at a time; each must arrive before the stream ends.
    const reader = res!.body!.getReader();
    const events: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) events.push(decoder.decode(value));
    }
    expect(events.join('')).toBe('data: 0\n\ndata: 1\n\ndata: 2\n\n');
    // More than one frame => it was NOT buffered-until-end into a single chunk.
    expect(events.length).toBeGreaterThan(1);
  });
});
