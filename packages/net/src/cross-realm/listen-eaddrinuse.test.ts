/**
 * Cross-realm `EADDRINUSE` at `listen()` (ADR-0186) — the LISTEN integration,
 * in-process. A sibling realm is simulated by a raw `BroadcastChannel` that
 * answers any `claim` for the port with `claim-deny` (exactly what a real
 * owner's answerer does). The two-real-realm hop is the browser e2e
 * (`tests/e2e/cross-realm-listen-eaddrinuse.spec.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../http/server.ts';
import { channelNameFor } from '../ws/channel.ts';
import { __resetPortClaims } from './port-claim.ts';
import { PREVIEW_PORT_FRAME_VERSION, previewPortChannelUrl } from './preview-port.ts';

/** A raw deny-answerer standing in for a sibling realm that already owns `port`. */
function siblingOwner(port: number): BroadcastChannel {
  const channel = new BroadcastChannel(channelNameFor(previewPortChannelUrl(port)));
  channel.addEventListener('message', (event) => {
    const frame = (event as MessageEvent).data as { type?: string; port?: number; id?: string };
    if (frame.type === 'claim' && frame.port === port) {
      channel.postMessage({
        type: 'claim-deny',
        v: PREVIEW_PORT_FRAME_VERSION,
        port,
        id: frame.id,
      });
    }
  });
  return channel;
}

afterEach(() => {
  __resetPortClaims();
});

describe('listen() cross-realm EADDRINUSE (ADR-0186)', () => {
  it('emits a Node-shaped EADDRINUSE and does not keep the port when a sibling realm owns it', async () => {
    const port = 7411;
    const sibling = siblingOwner(port);
    const s = createServer();
    let listened = false;
    s.on('listening', () => {
      listened = true;
    });

    const err = await new Promise<Error & Record<string, unknown>>((resolve) => {
      s.on('error', (...args: unknown[]) => resolve(args[0] as Error & Record<string, unknown>));
      s.listen({ port });
    });

    expect(err.code).toBe('EADDRINUSE');
    expect(err.errno).toBe(-98);
    expect(err.syscall).toBe('listen');
    expect(err.port).toBe(port);
    expect(listened).toBe(false); // never fired 'listening' for the failed bind
    expect(s.address()).toBeNull(); // unregistered on loss
    sibling.close();
  });

  it('binds + fires listening on a free port (no sibling owner)', async () => {
    const port = 7412;
    const s = createServer();
    let errored: unknown = null;
    s.on('error', (...args: unknown[]) => {
      errored = args[0];
    });
    await new Promise<void>((resolve) => s.listen({ port }, () => resolve()));
    expect(errored).toBeNull();
    expect(s.address()).toEqual({ port });
    s.close();
  });
});
