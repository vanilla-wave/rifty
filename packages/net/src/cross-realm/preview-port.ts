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

import { NotImplementedError } from '@riftydev/io';
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
const DEFAULT_STREAM_DRAIN_TIMEOUT_MS = 30_000;
const STREAM_DRAIN_TIMEOUT = Symbol('preview-port-stream-drain-timeout');
type PreviewRequestBody = Uint8Array | readonly Uint8Array[] | null;

export interface PreviewPortScopeOptions {
  /**
   * Optional run-scoped discriminator. A page bridge only talks to worker
   * responders carrying the same scope, preventing stale same-port dev-server
   * workers from racing replies on the shared BroadcastChannel.
   */
  readonly scope?: string;
}

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
export type PreviewPortFrame =
  | {
      readonly type: 'request';
      readonly v?: string;
      readonly requestId: string;
      readonly method: string;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: PreviewRequestBody;
      // ADR-0180: a service-to-service client consumes chunks LIVE (pushes them
      // into its IncomingMessage as they arrive). When set, the server streams
      // all non-null bodies including SSE — no SSE refusal, no buffered-drain
      // deadline (those protect the page consumer, which buffers until end).
      readonly live?: boolean;
      // Run-scoped discriminator (origin/main): a page bridge only talks to
      // worker responders carrying the same scope — stale same-port dev-server
      // workers can't race replies on the shared channel.
      readonly scope?: string;
    }
  | {
      // ADR-0180: ownership probe. A realm receiving a `request` for a port it
      // OWNS emits this IMMEDIATELY (before running the handler), so the client
      // separates "no realm owns the port" (→ ECONNREFUSED) from "slow handler".
      readonly type: 'accept';
      readonly v: string;
      readonly requestId: string;
    }
  | {
      // ADR-0186: cross-realm bind-claim. A realm broadcasts this at `listen(port)`
      // before registering; an existing owner replies `claim-deny`, a concurrent
      // claimant tie-breaks by `id` (lower wins). Additive (ADR-0031): a pre-0186
      // peer never sends/answers it, so it just never participates. `id` is a
      // per-claim, lexicographically-orderable unique string.
      readonly type: 'claim';
      readonly v: string;
      readonly port: number;
      readonly id: string;
    }
  | {
      // ADR-0186: the owner's (or a winning concurrent claimant's) refusal of a
      // `claim`, echoing the loser's `id` so only that claimant backs off.
      readonly type: 'claim-deny';
      readonly v: string;
      readonly port: number;
      readonly id: string;
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

/** True when the response media type is `text/event-stream` (ignoring params). */
function isEventStream(headers: Headers): boolean {
  const ct = headers.get('content-type');
  if (ct === null) return false;
  return ct.split(';', 1)[0]?.trim().toLowerCase() === 'text/event-stream';
}

let counter = 0;
function nextRequestId(): string {
  // Counter resets per realm; random tail guards cross-realm collisions (old +
  // new page briefly sharing a channel name during reload). ADR-0048 §Risks.
  return `r${++counter}-${Math.random().toString(36).slice(2, 8)}`;
}

function plainResponse(text: string, status: number): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
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
  opts: PreviewPortScopeOptions & { readonly streamDrainTimeoutMs?: number } = {},
): () => void {
  const channelName = channelNameFor(previewPortChannelUrl(port));
  const channel = new BroadcastChannel(channelName);
  const streamDrainTimeoutMs = opts.streamDrainTimeoutMs ?? DEFAULT_STREAM_DRAIN_TIMEOUT_MS;

  const onMessage = async (event: MessageEvent): Promise<void> => {
    const frame = event.data as PreviewPortFrame;
    if (frame.type !== 'request') return;
    if ((opts.scope !== undefined || frame.scope !== undefined) && frame.scope !== opts.scope)
      return;
    const requestId = frame.requestId;
    const wantsStream = frame.v === PREVIEW_PORT_FRAME_VERSION;
    const live = frame.live === true;

    // ADR-0180 ownership signal: emitted BEFORE dispatch so a slow handler is
    // still recognised as the port owner at once (separates no-listener from
    // slow-app on the client). Harmlessly ignored by the page preview consumer.
    channel.postMessage({
      type: 'accept',
      v: PREVIEW_PORT_FRAME_VERSION,
      requestId,
    } satisfies PreviewPortFrame);

    const headers = Object.fromEntries(
      Object.entries(frame.headers).filter(([key]) => key !== 'accept-encoding'),
    );
    const requestInit: RequestInit = { method: frame.method, headers };
    if (frame.body !== null && frame.method !== 'GET' && frame.method !== 'HEAD') {
      requestInit.body = bodyStreamFromChunks(frame.body);
      (requestInit as RequestInit & { duplex?: 'half' }).duplex = 'half';
    }

    let response: Response;
    try {
      response = await dispatch(new Request(frame.url, requestInit));
    } catch (err) {
      // Report on the legacy (version-unvalidated) `error` frame so even a
      // pre-ADR-0048 page understands it.
      channel.postMessage({
        type: 'error',
        requestId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies PreviewPortFrame);
      return;
    }

    // Unbounded-body ceiling (ADR-0048): this hop is buffered-until-`end` — the page concats
    // chunks on `reply-stream-end` (true end-to-end `ReadableStream` is M12,
    // ADR-0017), and the buffered path below drains the body too. A known
    // unending media type is refused immediately; every other body is bounded by
    // `streamDrainTimeoutMs` so a chunked log tail / NDJSON feed fails loud
    // instead of keeping the page accumulator alive forever.
    // A buffering consumer (the page preview) would accumulate an unending SSE
    // body until `end` that never comes — refuse it loud. A `live` consumer
    // (ADR-0180 service-to-service) reads chunks as they arrive, so SSE streams
    // fine and is NOT refused.
    if (response.body !== null && isEventStream(response.headers) && !live) {
      const ceiling = new NotImplementedError(
        'net.preview.cross-realm-sse-drain',
        'text/event-stream needs true end-to-end streaming (M12, ADR-0017); the cross-realm preview bridge buffers until end',
      );
      console.error('[rifty/net] cross-realm preview refusing to drain SSE body', {
        feature: ceiling.feature,
      });
      channel.postMessage({
        type: 'error',
        requestId,
        message: ceiling.message,
      } satisfies PreviewPortFrame);
      return;
    }

    // Buffered path: null body, or a peer that didn't request streaming.
    if (!wantsStream || response.body === null) {
      let bodyBytes: Uint8Array | null;
      try {
        bodyBytes =
          response.body === null
            ? null
            : await drainBodyWithDeadline(response.body, streamDrainTimeoutMs);
      } catch (err) {
        channel.postMessage({
          type: 'error',
          requestId,
          message: err instanceof Error ? err.message : String(err),
        } satisfies PreviewPortFrame);
        return;
      }
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
    // Live (service-to-service) consumers read chunks as they arrive, so there
    // is no buffered-until-end accumulator to bound — skip the drain deadline so
    // a long-lived SSE/NDJSON feed streams indefinitely (the client's own
    // no-progress timer reaps a dead peer).
    const deadline = live ? null : createDrainDeadline(streamDrainTimeoutMs);
    let seq = 0;
    try {
      for (;;) {
        const read = deadline
          ? await Promise.race([reader.read(), deadline.promise])
          : await reader.read();
        if (read === STREAM_DRAIN_TIMEOUT) {
          const ceiling = unboundedBodyError(streamDrainTimeoutMs);
          await reader.cancel(ceiling).catch(() => {});
          throw ceiling;
        }
        const { done, value } = read;
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        for (let off = 0; off < value.byteLength; off += MAX_CHUNK_BYTES) {
          // `subarray` is a view; postMessage's structured clone copies only
          // the covered bytes (honours byteOffset/byteLength), so reuse is safe.
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
      deadline?.clear();
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

async function drainBodyWithDeadline(
  body: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const deadline = createDrainDeadline(timeoutMs);
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const read = await Promise.race([reader.read(), deadline.promise]);
      if (read === STREAM_DRAIN_TIMEOUT) {
        const ceiling = unboundedBodyError(timeoutMs);
        await reader.cancel(ceiling).catch(() => {});
        throw ceiling;
      }
      const { done, value } = read;
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      parts.push(value);
      total += value.byteLength;
    }
  } finally {
    deadline.clear();
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.byteLength;
  }
  return out;
}

function createDrainDeadline(timeoutMs: number): {
  readonly promise: Promise<typeof STREAM_DRAIN_TIMEOUT>;
  clear(): void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof STREAM_DRAIN_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(STREAM_DRAIN_TIMEOUT), timeoutMs);
  });
  return {
    promise,
    clear(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

function unboundedBodyError(timeoutMs: number): NotImplementedError {
  return new NotImplementedError(
    'net.preview.cross-realm-unbounded-body',
    `cross-realm preview buffers response bodies until end; body did not finish within ${timeoutMs}ms`,
  );
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
/** Decoded request fields for the {@link CrossRealmPortHandler.dispatchStruct} fast-path. */
export interface PreviewDispatchStruct {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: PreviewRequestBody;
}

export interface CrossRealmPortHandler extends PortHandler {
  dispose(): void;
  /**
   * Struct fast-path (ADR-0086). Same page→worker wire frame as
   * `handler(Request)`, but the caller already holds the decoded
   * `{url,method,headers,body}` (from a `SerializedRequest`), so this skips
   * building a `Request` and re-draining it via `arrayBuffer()`. Byte-identical
   * to the `Request` path; a non-null body on a GET/HEAD is dropped (matching
   * the `Request` path, which never carries a GET/HEAD body).
   */
  dispatchStruct(req: PreviewDispatchStruct): Promise<Response>;
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
  opts: PreviewPortScopeOptions & { readonly timeoutMs?: number } = {},
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
    // `request` is inbound to the worker; `claim`/`claim-deny` are the bind-claim
    // protocol (ADR-0186) on the same channel — none is a reply this bridge awaits.
    if (frame.type === 'request' || frame.type === 'claim' || frame.type === 'claim-deny') return;
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
        // #22a: BroadcastChannel already structured-cloned frame.data into a
        // fresh page-realm-owned buffer (exclusive, read once here, never
        // mutated after), so the manual re-copy duplicated a buffer nobody
        // aliases. Push directly — the final concat honours byteLength either way.
        accum.chunks.push(frame.data);
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

  // Post-frame-and-await core shared by both entrypoints (the public
  // `handler(Request)` path and the ADR-0086 `dispatchStruct` fast-path). Takes
  // already-decoded struct fields; GET/HEAD body MUST already be null.
  const post = (
    method: string,
    url: string,
    headers: Readonly<Record<string, string>>,
    bodyBytes: PreviewRequestBody,
  ): Promise<Response> => {
    const requestId = nextRequestId();
    const frame: PreviewPortFrame = {
      type: 'request',
      v: PREVIEW_PORT_FRAME_VERSION,
      requestId,
      method,
      url,
      headers,
      body: bodyBytes,
      ...(opts.scope === undefined ? {} : { scope: opts.scope }),
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
  };

  const handler = (async (request: Request): Promise<Response> => {
    if (torn) return new Response('preview-port bridge disposed', { status: 502 });
    const bodyBytes =
      request.method === 'GET' || request.method === 'HEAD'
        ? null
        : [new Uint8Array(await request.arrayBuffer())];
    return post(request.method, request.url, headersToObject(request.headers), bodyBytes);
  }) as CrossRealmPortHandler;

  handler.dispatchStruct = (req: PreviewDispatchStruct): Promise<Response> => {
    if (torn) {
      return Promise.resolve(new Response('preview-port bridge disposed', { status: 502 }));
    }
    // No Request rebuild, no arrayBuffer() drain — the caller already decoded.
    const bodyBytes = req.method === 'GET' || req.method === 'HEAD' ? null : req.body;
    return post(req.method, req.url, req.headers, bodyBytes);
  };

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

/**
 * CLIENT side of cross-realm `http.request`/`get` loopback (ADR-0180). Called by
 * `routeClientRequest`'s `{kind:'refused'}` branch (a loopback port with no
 * LOCAL handler) BEFORE it decides `ECONNREFUSED`. Posts a `request` frame
 * declaring `live` consumption and resolves:
 *
 *  - the owning realm's `Response` — once an `accept` frame confirms a realm
 *    owns the port and the reply lands. A streamed reply's body is a LIVE
 *    `ReadableStream` fed from `reply-stream-*` frames AS THEY ARRIVE, so an
 *    SSE/NDJSON service-to-service feed reaches the caller chunk-by-chunk
 *    (the caller wraps it in `IncomingMessageFromFetch`, which pushes each
 *    chunk to the Node `Readable`); or
 *  - `null` when NO realm emits `accept` within `probeTimeoutMs` — the caller
 *    then emits Node-shaped `ECONNREFUSED` (the realm-local registry IS the
 *    whole namespace; an unowned port is a dead end).
 *
 * The caller MUST consult the local registry first (`{kind:'local'}`); this
 * fires only on a local miss (ADR-0180 D4). Same-origin only (BroadcastChannel).
 *
 * Note (M12, ADR-0017): no cross-realm backpressure/cancel yet — if the caller
 * cancels mid-stream the client stops listening, but the owning realm keeps
 * draining its body until it ends.
 */
export function dispatchCrossRealmLoopback(
  port: number,
  req: PreviewDispatchStruct,
  opts: { readonly probeTimeoutMs?: number; readonly idleTimeoutMs?: number } = {},
): Promise<Response | null> {
  const probeTimeoutMs = opts.probeTimeoutMs ?? 1000;
  const idleTimeoutMs = opts.idleTimeoutMs ?? 30_000;
  const channel = new BroadcastChannel(channelNameFor(previewPortChannelUrl(port)));
  const requestId = nextRequestId();
  const bodyBytes = req.method === 'GET' || req.method === 'HEAD' ? null : req.body;

  return new Promise<Response | null>((resolve) => {
    let settled = false;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let nextSeq = 0;
    // One timer across two phases: the bounded ownership probe (no accept →
    // refuse) and, once accepted, the no-progress idle timer (re-armed per frame).
    let timer: ReturnType<typeof setTimeout> | undefined;

    const teardown = (): void => {
      if (timer) clearTimeout(timer);
      channel.removeEventListener('message', onMessage as unknown as EventListener);
      channel.close();
    };
    const settleWith = (value: Response | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // No-progress timer (ADR-0048 D4): re-armed on accept + every stream frame,
    // so a live stream never trips it, but a peer that dies after accepting is
    // reaped. Mid-stream death errors the open body; a stall before any reply
    // surfaces a 502 (owner accepted but produced nothing).
    const armIdle = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (streamController) {
          streamController.error(new Error('cross-realm loopback stream stalled'));
          streamController = null;
        } else if (!settled) {
          settleWith(plainResponse('cross-realm loopback accepted but no reply', 502));
        }
        teardown();
      }, idleTimeoutMs);
    };

    const onMessage = (event: MessageEvent): void => {
      const frame = event.data as PreviewPortFrame;
      // `request` is the outbound probe; `claim`/`claim-deny` belong to the
      // bind-claim protocol (ADR-0186) on the same channel — neither is ours.
      if (frame.type === 'request' || frame.type === 'claim' || frame.type === 'claim-deny') return;
      if (frame.requestId !== requestId) return; // another request / bridge instance

      switch (frame.type) {
        case 'accept':
          // Owner confirmed — switch the probe timer to the no-progress idle timer.
          armIdle();
          return;
        case 'reply': {
          const body: BodyInit | null = frame.body
            ? (() => {
                const copy = new ArrayBuffer(frame.body.byteLength);
                new Uint8Array(copy).set(frame.body);
                return copy;
              })()
            : null;
          settleWith(
            new Response(body, {
              status: frame.status,
              statusText: frame.statusText,
              headers: frame.headers,
            }),
          );
          teardown();
          return;
        }
        case 'error':
          if (streamController) {
            streamController.error(new Error(frame.message));
            streamController = null;
          } else {
            settleWith(plainResponse(frame.message, 502));
          }
          teardown();
          return;
        case 'reply-stream-start': {
          if (frame.v !== PREVIEW_PORT_FRAME_VERSION) {
            settleWith(plainResponse('cross-realm loopback frame version mismatch', 503));
            teardown();
            return;
          }
          nextSeq = 0;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              streamController = controller;
            },
            cancel() {
              // Caller cancelled — stop listening (no cross-realm cancel; M12).
              streamController = null;
              teardown();
            },
          });
          armIdle();
          settleWith(
            new Response(stream, {
              status: frame.status,
              statusText: frame.statusText,
              headers: frame.headers,
            }),
          );
          return;
        }
        case 'reply-stream-chunk':
          if (!streamController || frame.seq !== nextSeq) {
            streamController?.error(new Error('cross-realm loopback frame loss detected'));
            streamController = null;
            teardown();
            return;
          }
          streamController.enqueue(frame.data);
          nextSeq++;
          armIdle();
          return;
        case 'reply-stream-end':
          if (streamController && frame.seq === nextSeq) streamController.close();
          else streamController?.error(new Error('cross-realm loopback frame loss detected'));
          streamController = null;
          teardown();
          return;
        case 'reply-stream-error':
          streamController?.error(new Error(frame.message));
          streamController = null;
          teardown();
          return;
      }
    };

    channel.addEventListener('message', onMessage as unknown as EventListener);
    timer = setTimeout(() => {
      settleWith(null);
      teardown();
    }, probeTimeoutMs);
    channel.postMessage({
      type: 'request',
      v: PREVIEW_PORT_FRAME_VERSION,
      requestId,
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: bodyBytes,
      live: true,
    } satisfies PreviewPortFrame);
  });
}

function bodyChunks(body: Exclude<PreviewRequestBody, null>): readonly Uint8Array[] {
  return body instanceof Uint8Array ? [body] : body;
}

function cloneChunk(chunk: Uint8Array): Uint8Array {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  return copy;
}

function bodyStreamFromChunks(body: Exclude<PreviewRequestBody, null>): ReadableStream<Uint8Array> {
  const chunks = bodyChunks(body).map(cloneChunk);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
