/**
 * Body-carrier helpers for the preview bridge: transfer a response body as a
 * `ReadableStream` over `postMessage` (modern Chromium/Firefox/Safari 16.4+),
 * else drain it to a `Uint8Array` first (older Safari, some Workers). Frame
 * and routing version fields (ADR-0031/ADR-0040) are stamped onto the packed
 * message so the SW side can verify the peer protocol matches.
 */

import { NotImplementedError } from '@riftydev/io';
import { SW_FRAME_VERSION, SW_ROUTING_VERSION, type SerializedResponse } from './protocol.ts';

export type { SerializedResponse };

/**
 * Probe whether the host realm can transfer `ReadableStream` over
 * `postMessage` (Chromium ≥ 89, Firefox ≥ 103, Safari ≥ 16.4). When
 * unsupported, the bridge buffers the body and posts a `Uint8Array` instead.
 * Result is cached after the first call.
 */
let streamTransferSupported: boolean | null = null;
export function canTransferReadableStream(): boolean {
  if (streamTransferSupported !== null) return streamTransferSupported;
  if (typeof ReadableStream === 'undefined' || typeof MessageChannel === 'undefined') {
    streamTransferSupported = false;
    return false;
  }
  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const channel = new MessageChannel();
    channel.port1.postMessage(stream, [stream as unknown as Transferable]);
    channel.port1.close();
    channel.port2.close();
    streamTransferSupported = true;
  } catch {
    streamTransferSupported = false;
  }
  return streamTransferSupported;
}

/**
 * Pack a `SerializedResponse` for `postMessage`, returning the message and its
 * transfer list. A transferable `ReadableStream` body is a zero-copy hand-off;
 * otherwise the stream is drained to a `Uint8Array` (awaited here) and posted
 * as a regular structured-clone. Frame and routing versions are stamped on.
 */
export async function packSerializedResponse(resp: SerializedResponse): Promise<{
  message: SerializedResponse & { frameVersion: string; routingVersion: string };
  transfer: Transferable[];
}> {
  const stamp = { frameVersion: SW_FRAME_VERSION, routingVersion: SW_ROUTING_VERSION };
  const body = resp.body;
  if (body instanceof ReadableStream) {
    if (canTransferReadableStream()) {
      return {
        message: { ...resp, ...stamp },
        transfer: [body as unknown as Transferable],
      };
    }
    if (isEventStream(resp.headers)) {
      throw new NotImplementedError(
        'service-worker.preview.sse-drain-fallback',
        'text/event-stream requires transferable ReadableStream support',
      );
    }
    const buffered = await drainStream(body);
    return {
      message: { ...resp, body: buffered, ...stamp },
      transfer: [],
    };
  }
  return { message: { ...resp, ...stamp }, transfer: [] };
}

function isEventStream(headers: Record<string, string>): boolean {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'content-type') continue;
    return value.split(';', 1)[0]?.trim().toLowerCase() === 'text/event-stream';
  }
  return false;
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}
