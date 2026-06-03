/**
 * Cross-realm preview-port bridge (ADR-0043, supersedes ADR-0025 for the
 * Real Vite path; streaming wire-frame added by ADR-0048).
 *
 * Bridges the page-realm `dispatchToPort()` to a Worker-realm HTTP-shape
 * listener over `BroadcastChannel`. Used when Real Vite runs in its own
 * kernel-spawned Worker (ADR-0011 phase 2+): the Service Worker still
 * forwards `/preview/<port>/*` fetches to the page; the page registers a port
 * handler that forwards over this bridge to the Worker.
 *
 * Transport choice: `BroadcastChannel` keeps the kernel API unchanged and
 * matches the HMR bridge's existing choice (ADR-0017 phase 1). The M12
 * rewrite (ADR-0017) will swap both this bridge and the HMR bridge to
 * dedicated `MessagePort`s with true pull-based backpressure.
 *
 * Scope today (ADR-0048):
 *  - Streaming responses: the worker drains `response.body` and posts ordered
 *    `reply-stream-{start,chunk,end,error}` frames; the page reassembles them.
 *    This is a worker-side memory + latency win — the page still accumulates
 *    and concatenates on `end` (true end-to-end `ReadableStream` is M12,
 *    ADR-0017). The buffered `reply` frame is retained as the negotiated
 *    fallback for un-bumped peers and the null-body fast path.
 *  - No true cross-realm backpressure (M12).
 *  - Same-origin only (BroadcastChannel limit).
 *
 * Versioning (ADR-0048, applying ADR-0040's split one layer down): the
 * page↔worker hop has its OWN version pin, {@link PREVIEW_PORT_FRAME_VERSION},
 * NOT `SW_FRAME_VERSION`. `SW_FRAME_VERSION` (owned by `@riftydev/service-worker`)
 * pins the SW↔page `SerializedResponse` hop; importing it here would be a
 * sibling/reverse import (CLAUDE.md hard rule) and would wrongly invalidate
 * every SW↔page peer for a change to a different hop.
 */

import type { PortHandler } from '../registry.ts';
import { channelNameFor } from '../ws/bridge.ts';

/**
 * Version of the page↔worker preview-port wire-frame. Net-local — see the
 * module header. Bump when the {@link PreviewPortFrame} union changes shape in
 * a non-additive way. '1' = buffered request/reply only (pre-ADR-0048); '2' =
 * streaming `reply-stream-*` frames added.
 *
 * Negotiation: the page stamps this on every `request` frame. The worker reads
 * it PER REQUEST (never pins a channel) and only emits streaming frames when
 * the request declared `'2'`; a missing/older `v` gets the buffered `reply`.
 * The page validates the `v` on every `reply-stream-start` and resolves 503 on
 * mismatch.
 */
export const PREVIEW_PORT_FRAME_VERSION = '2';

/** Max bytes per `reply-stream-chunk` — bounds a single structured clone. */
const MAX_CHUNK_BYTES = 64 * 1024;

/**
 * Synthetic URL used as the keyed input to {@link channelNameFor} for the
 * preview-port bridge. The dev-server port number is embedded so multiple
 * Real-Vite workers on the same page (future work) don't cross-talk.
 */
export function previewPortChannelUrl(port: number): string {
  return `ws://preview-port.local:${port}/__rfv`;
}

/**
 * Frame shape of every message on the preview-port channel. Discriminated
 * union on `type`. `requestId` matches replies to their originating `request`;
 * streaming replies additionally carry a monotonic `seq` (0-based, +1 per
 * chunk) so the receiver can detect frame loss.
 *
 * `v` is the {@link PREVIEW_PORT_FRAME_VERSION} the sender speaks. It is
 * required on the streaming members (the new contract) and present on
 * `request`/`reply`/`error` from a current sender; a missing `v` on those is
 * decoded as `'1'` (a pre-ADR-0048 peer). `headers` is a plain object because
 * `BroadcastChannel` structured-clones and `Headers` isn't cloneable
 * everywhere.
 */
type PreviewPortFrame =
  | {
      readonly type: 'request';
      readonly v?: string;
      readonly requestId: string;
      readonly method: string;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: Uint8Array | null;
    }
  | {
      readonly type: 'reply';
      readonly v?: string;
      readonly requestId: string;
      readonly status: number;
      readonly statusText: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: Uint8Array | null;
    }
  | {
      readonly type: 'error';
      readonly v?: string;
      readonly requestId: string;
      readonly message: string;
    }
  | {
      readonly type: 'reply-stream-start';
      readonly v: string;
      readonly requestId: string;
      readonly status: number;
      readonly statusText: string;
      readonly headers: Readonly<Record<string, string>>;
    }
  | {
      readonly type: 'reply-stream-chunk';
      readonly v: string;
      readonly requestId: string;
      readonly seq: number;
      readonly data: Uint8Array;
    }
  | {
      readonly type: 'reply-stream-end';
      readonly v: string;
      readonly requestId: string;
      readonly seq: number;
    }
  | {
      readonly type: 'reply-stream-error';
      readonly v: string;
      readonly requestId: string;
      readonly seq: number;
      readonly message: string;
    };

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

let counter = 0;
function nextRequestId(): string {
  // Monotonic + random suffix so concurrent dispatches on the same channel
  // don't collide. The counter resets per realm; the random tail guards
  // collisions across realms (e.g. an old + new page briefly sharing a
  // channel name during a reload). See ADR-0048 §Risks.
  return `r${++counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Worker side. Open the bridge channel and serve every `request` frame through
 * `dispatch`. Per ADR-0048 the reply mode is chosen PER REQUEST from the
 * request's `v`: a `'2'` request with a non-null body streams; everything else
 * (missing/older `v`, or a null body) takes the buffered `reply` fast path.
 * This never pins the channel — the worker outlives page reloads, so a stale
 * pin would deliver streaming frames to a freshly-connected old page (a silent
 * wrong-answer, not just a hang).
 *
 * Returns an idempotent teardown function.
 */
export function serveCrossRealmPreview(
  port: number,
  dispatch: (request: Request) => Promise<Response>,
): () => void {
  const channelName = channelNameFor(previewPortChannelUrl(port));
  const channel = new BroadcastChannel(channelName);

  const onMessage = async (event: MessageEvent): Promise<void> => {
    const frame = event.data as PreviewPortFrame;
    if (frame.type !== 'request') return;
    const requestId = frame.requestId;
    const wantsStream = frame.v === PREVIEW_PORT_FRAME_VERSION;

    const requestInit: RequestInit = { method: frame.method, headers: frame.headers };
    if (frame.body !== null && frame.method !== 'GET' && frame.method !== 'HEAD') {
      const copy = new ArrayBuffer(frame.body.byteLength);
      new Uint8Array(copy).set(frame.body);
      requestInit.body = copy;
    }

    let response: Response;
    try {
      response = await dispatch(new Request(frame.url, requestInit));
    } catch (err) {
      // Synchronous-dispatch failure: report on the legacy (version-unvalidated)
      // `error` frame so even a pre-ADR-0048 page understands it.
      channel.postMessage({
        type: 'error',
        requestId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies PreviewPortFrame);
      return;
    }

    // Buffered path: null body, or a peer that didn't request streaming.
    if (!wantsStream || response.body === null) {
      const bodyBytes =
        response.body === null ? null : new Uint8Array(await response.arrayBuffer());
      channel.postMessage({
        type: 'reply',
        v: PREVIEW_PORT_FRAME_VERSION,
        requestId,
        status: response.status,
        statusText: response.statusText,
        headers: headersToObject(response.headers),
        body: bodyBytes,
      } satisfies PreviewPortFrame);
      return;
    }

    // Streaming path: start → ordered chunks (≤64 KiB) → end; error mid-stream
    // surfaces on `reply-stream-error` carrying the chunks-sent count.
    channel.postMessage({
      type: 'reply-stream-start',
      v: PREVIEW_PORT_FRAME_VERSION,
      requestId,
      status: response.status,
      statusText: response.statusText,
      headers: headersToObject(response.headers),
    } satisfies PreviewPortFrame);

    const reader = response.body.getReader();
    let seq = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        for (let off = 0; off < value.byteLength; off += MAX_CHUNK_BYTES) {
          // `subarray` is a view; structured clone on postMessage copies the
          // covered bytes (honours byteOffset/byteLength), so reuse is safe.
          const part = value.subarray(off, Math.min(off + MAX_CHUNK_BYTES, value.byteLength));
          channel.postMessage({
            type: 'reply-stream-chunk',
            v: PREVIEW_PORT_FRAME_VERSION,
            requestId,
            seq: seq++,
            data: part,
          } satisfies PreviewPortFrame);
        }
      }
      channel.postMessage({
        type: 'reply-stream-end',
        v: PREVIEW_PORT_FRAME_VERSION,
        requestId,
        seq,
      } satisfies PreviewPortFrame);
    } catch (err) {
      channel.postMessage({
        type: 'reply-stream-error',
        v: PREVIEW_PORT_FRAME_VERSION,
        requestId,
        seq,
        message: err instanceof Error ? err.message : String(err),
      } satisfies PreviewPortFrame);
    } finally {
      reader.releaseLock();
    }
  };

  channel.addEventListener('message', onMessage as unknown as EventListener);

  let torn = false;
  return (): void => {
    if (torn) return;
    torn = true;
    channel.removeEventListener('message', onMessage as unknown as EventListener);
    channel.close();
  };
}

/**
 * Page side. Returns a {@link PortHandler} that forwards each incoming
 * `Request` to whichever worker is serving the matching preview-port channel
 * and resolves with the reassembled `reply`. The handler exposes `.dispose()`
 * to close the channel and reject in-flight requests (including mid-stream
 * accumulators) with a `502`.
 *
 * Idle timeout (ADR-0048 D4): the per-request timer is a no-progress timer —
 * armed on dispatch and re-armed on every `reply-stream-{start,chunk}` — so a
 * live stream never trips it, but a worker that dies mid-stream (no `pagehide`
 * on a worker, per ADR-0046) is reaped after `timeoutMs` and its accumulator
 * freed. All terminal paths (end/error/seq-gap/timeout/dispose) clear the
 * single `pending` entry, so there is no separate accumulator map to leak.
 */
export interface CrossRealmPortHandler extends PortHandler {
  dispose(): void;
}

interface StreamAccumulator {
  status: number;
  statusText: string;
  headers: Readonly<Record<string, string>>;
  chunks: Uint8Array[];
  nextSeq: number;
}

interface Waiter {
  resolve(response: Response): void;
  timer: ReturnType<typeof setTimeout>;
  accum?: StreamAccumulator;
}

export function bridgeCrossRealmPreview(
  port: number,
  opts: { readonly timeoutMs?: number } = {},
): CrossRealmPortHandler {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const channelName = channelNameFor(previewPortChannelUrl(port));
  const channel = new BroadcastChannel(channelName);
  const pending = new Map<string, Waiter>();

  const plain = (text: string, status: number): Response =>
    new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  /** (Re)arm the no-progress idle timer for a request. */
  const arm = (requestId: string): void => {
    const w = pending.get(requestId);
    if (!w) return;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      pending.delete(requestId);
      w.resolve(plain(`preview-port bridge timeout after ${timeoutMs}ms`, 502));
    }, timeoutMs);
  };

  /** Resolve + remove a waiter (clears its timer and accumulator together). */
  const settle = (requestId: string, w: Waiter, response: Response): void => {
    pending.delete(requestId);
    clearTimeout(w.timer);
    w.resolve(response);
  };

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as PreviewPortFrame;
    if (frame.type === 'request') return; // not ours
    const waiter = pending.get(frame.requestId);
    if (!waiter) return; // unknown/late frame, or another bridge instance's

    switch (frame.type) {
      case 'reply': {
        const body: BodyInit | null = frame.body
          ? (() => {
              const copy = new ArrayBuffer(frame.body.byteLength);
              new Uint8Array(copy).set(frame.body);
              return copy;
            })()
          : null;
        settle(
          frame.requestId,
          waiter,
          new Response(body, {
            status: frame.status,
            statusText: frame.statusText,
            headers: frame.headers,
          }),
        );
        return;
      }
      case 'error':
        settle(frame.requestId, waiter, plain(frame.message, 502));
        return;
      case 'reply-stream-start': {
        if (frame.v !== PREVIEW_PORT_FRAME_VERSION) {
          console.error('[rifty/net] preview-port frame version mismatch', {
            expected: PREVIEW_PORT_FRAME_VERSION,
            got: frame.v,
          });
          settle(frame.requestId, waiter, plain('preview-port frame version mismatch', 503));
          return;
        }
        waiter.accum = {
          status: frame.status,
          statusText: frame.statusText,
          headers: frame.headers,
          chunks: [],
          nextSeq: 0,
        };
        arm(frame.requestId);
        return;
      }
      case 'reply-stream-chunk': {
        const accum = waiter.accum;
        if (!accum || frame.seq !== accum.nextSeq) {
          settle(frame.requestId, waiter, plain('preview-port frame loss detected', 502));
          return;
        }
        const copy = new Uint8Array(frame.data.byteLength);
        copy.set(frame.data);
        accum.chunks.push(copy);
        accum.nextSeq++;
        arm(frame.requestId);
        return;
      }
      case 'reply-stream-end': {
        const accum = waiter.accum;
        if (!accum || frame.seq !== accum.nextSeq) {
          settle(frame.requestId, waiter, plain('preview-port frame loss detected', 502));
          return;
        }
        const total = accum.chunks.reduce((n, c) => n + c.byteLength, 0);
        const body = new Uint8Array(total);
        let off = 0;
        for (const c of accum.chunks) {
          body.set(c, off);
          off += c.byteLength;
        }
        settle(
          frame.requestId,
          waiter,
          new Response(total === 0 ? null : body, {
            status: accum.status,
            statusText: accum.statusText,
            headers: accum.headers,
          }),
        );
        return;
      }
      case 'reply-stream-error':
        settle(frame.requestId, waiter, plain(frame.message, 502));
        return;
    }
  };

  channel.addEventListener('message', onMessage as unknown as EventListener);

  let torn = false;

  const handler = (async (request: Request): Promise<Response> => {
    if (torn) return new Response('preview-port bridge disposed', { status: 502 });
    const requestId = nextRequestId();
    const bodyBytes =
      request.method === 'GET' || request.method === 'HEAD'
        ? null
        : new Uint8Array(await request.arrayBuffer());
    const frame: PreviewPortFrame = {
      type: 'request',
      v: PREVIEW_PORT_FRAME_VERSION,
      requestId,
      method: request.method,
      url: request.url,
      headers: headersToObject(request.headers),
      body: bodyBytes,
    };
    const promise = new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve(plain(`preview-port bridge timeout after ${timeoutMs}ms`, 502));
      }, timeoutMs);
      pending.set(requestId, { resolve, timer });
    });
    channel.postMessage(frame);
    return promise;
  }) as CrossRealmPortHandler;

  handler.dispose = (): void => {
    if (torn) return;
    torn = true;
    for (const [, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.resolve(new Response('preview-port bridge disposed', { status: 502 }));
    }
    pending.clear();
    channel.removeEventListener('message', onMessage as unknown as EventListener);
    channel.close();
  };

  return handler;
}
