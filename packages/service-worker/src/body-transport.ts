/**
 * Body-carrier helpers for the preview bridge. Decides whether a response
 * body can be transferred as a `ReadableStream` over `postMessage` (modern
 * Chromium/Firefox/Safari 16.4+) or must be drained into a `Uint8Array`
 * first (older Safari, some Workers). The version field is stamped onto the
 * packed message so the SW side can verify the peer protocol matches —
 * ADR-0016.
 */

import { SW_PROTOCOL_VERSION, type SerializedResponse } from './protocol.ts';

export type { SerializedResponse };

/**
 * Probe whether the host realm can transfer `ReadableStream` over
 * `postMessage`. Browsers that do: Chromium ≥ 89, Firefox ≥ 103. Safari
 * historically lagged (added in 16.4). When unsupported, the bridge buffers
 * the body and posts a `Uint8Array` instead.
 *
 * The probe is cached after the first call.
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
 * Pack a `SerializedResponse` for `postMessage`, returning the message and
 * any transfer list. If `body` is a `ReadableStream` and the host supports
 * transferring it, this is a zero-copy hand-off. Otherwise the stream is
 * drained into a `Uint8Array` synchronously *before* this returns (so the
 * caller awaits it) and posted as a regular structured-clone.
 *
 * The version field is stamped onto the message.
 */
export async function packSerializedResponse(
  resp: SerializedResponse,
): Promise<{ message: SerializedResponse & { version: string }; transfer: Transferable[] }> {
  const body = resp.body;
  if (body instanceof ReadableStream) {
    if (canTransferReadableStream()) {
      return {
        message: { ...resp, version: SW_PROTOCOL_VERSION },
        transfer: [body as unknown as Transferable],
      };
    }
    const buffered = await drainStream(body);
    return {
      message: { ...resp, body: buffered, version: SW_PROTOCOL_VERSION },
      transfer: [],
    };
  }
  return { message: { ...resp, version: SW_PROTOCOL_VERSION }, transfer: [] };
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
