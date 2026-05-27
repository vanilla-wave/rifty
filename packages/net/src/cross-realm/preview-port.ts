/**
 * Cross-realm preview-port bridge (ADR-0043, supersedes ADR-0025 for the
 * Real Vite path).
 *
 * Bridges the page-realm `dispatchToPort()` to a Worker-realm HTTP-shape
 * listener over `BroadcastChannel`. Used when Real Vite runs in its own
 * kernel-spawned Worker (ADR-0011 phase 2+): the Service Worker still
 * forwards `/preview/<port>/*` fetches to the page (M11 leaves
 * `FirstWindowOwnerResolver` in place — A-023 SW→Worker is sequenced
 * after A-026, per ADR-0011); the page registers a port handler that
 * forwards over this bridge to the Worker.
 *
 * Transport choice: `BroadcastChannel` keeps the kernel API unchanged
 * (no `extraPorts` on `WorkerSpawnSpec`) and matches the HMR bridge's
 * existing choice (ADR-0017 phase 1). The M12 rewrite (ADR-0017) will
 * swap both this bridge and the HMR bridge to dedicated `MessagePort`s
 * once `SerializedResponse` becomes a `ReadableStream`-carrier.
 *
 * Scope today (matches ADR-0017's current `@rifty/net` scope):
 *  - Buffered request/reply only — `body` is a `Uint8Array` or `null`.
 *  - No backpressure / per-connection isolation.
 *  - Same-origin only (BroadcastChannel limit).
 *
 * Out of scope (M12+):
 *  - Streaming `ReadableStream` bodies across the hop.
 *  - Per-connection MessagePort isolation.
 *  - Cross-origin bridging (not a goal — the Worker is same-origin
 *    by construction).
 */

import type { PortHandler } from '../registry.ts';
import { channelNameFor } from '../ws/bridge.ts';

/**
 * Synthetic URL used as the keyed input to {@link channelNameFor} for the
 * preview-port bridge. The dev-server port number is embedded so multiple
 * Real-Vite workers on the same page (future work) don't cross-talk.
 *
 * The shape is `ws://preview-port.local:<port>/__rfv` so it parses through
 * `new URL(...)` (which `channelNameFor` calls internally) without
 * triggering any of the `BridgedWebSocket` URL-validation paths.
 */
export function previewPortChannelUrl(port: number): string {
  return `ws://preview-port.local:${port}/__rfv`;
}

/**
 * Frame shape of every message on the preview-port channel. Discriminated
 * union on `type`. `requestId` matches a `reply` or `error` to its
 * originating `request`.
 *
 * `headers` is a plain object (not a `Headers` instance) because
 * `BroadcastChannel` uses structured clone; `Headers` isn't structured
 * cloneable in every runtime. Each side reconstructs `new Headers(obj)`
 * on receipt.
 */
type PreviewPortFrame =
  | {
      readonly type: 'request';
      readonly requestId: string;
      readonly method: string;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: Uint8Array | null;
    }
  | {
      readonly type: 'reply';
      readonly requestId: string;
      readonly status: number;
      readonly statusText: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: Uint8Array | null;
    }
  | {
      readonly type: 'error';
      readonly requestId: string;
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
  // Monotonic + random suffix so concurrent dispatches on the same
  // channel don't collide. The counter resets per realm; collisions
  // across realms are guarded by the random tail.
  return `r${++counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Worker side. Open the bridge channel and serve every `request` frame
 * through `dispatch`. The worker's `dispatch` is typically
 * `(req) => dispatchToPort(<the dev-server port>, req)`, but accepting a
 * generic `Request → Promise<Response>` keeps the helper test-friendly
 * (no global registry dependency in unit tests).
 *
 * Returns a teardown function that closes the channel and detaches the
 * listener. Idempotent.
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

    const requestInit: RequestInit = {
      method: frame.method,
      headers: frame.headers,
    };
    if (frame.body !== null && frame.method !== 'GET' && frame.method !== 'HEAD') {
      // Copy into a fresh ArrayBuffer so the structured-clone view from
      // BroadcastChannel doesn't get re-shared with downstream consumers
      // that may keep references past the request lifetime.
      const copy = new ArrayBuffer(frame.body.byteLength);
      new Uint8Array(copy).set(frame.body);
      requestInit.body = copy;
    }

    try {
      const response = await dispatch(new Request(frame.url, requestInit));
      const bodyBytes =
        response.body === null ? null : new Uint8Array(await response.arrayBuffer());
      const reply: PreviewPortFrame = {
        type: 'reply',
        requestId: frame.requestId,
        status: response.status,
        statusText: response.statusText,
        headers: headersToObject(response.headers),
        body: bodyBytes,
      };
      channel.postMessage(reply);
    } catch (err) {
      const errFrame: PreviewPortFrame = {
        type: 'error',
        requestId: frame.requestId,
        message: err instanceof Error ? err.message : String(err),
      };
      channel.postMessage(errFrame);
    }
  };

  // Cast through `EventListener` because BroadcastChannel's typed
  // event-listener parameter is `EventListener | EventListenerObject |
  // null`; our handler is structurally compatible but TS wants the
  // sync `void` signature without the `Promise<void>` form.
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
 * `Request` to whichever worker is serving the matching preview-port
 * channel and resolves with the matching `reply`. Caller wires this
 * via `registerPort(port, handler)`.
 *
 * The returned handler exposes a `.dispose()` to close the underlying
 * channel and reject in-flight requests with a `502 dispose`. Callers
 * should call `dispose()` from their teardown path (e.g. the Real Vite
 * adapter's `close()`) AFTER `unregisterPort(port)` so the registry
 * stops surfacing requests through this handler first.
 *
 * Per-request timeout defaults to 30 s. If no `reply` (or `error`) frame
 * arrives within `timeoutMs`, the handler resolves with a `502` Response
 * — never throws — to keep the upstream preview-bridge happy.
 */
export interface CrossRealmPortHandler extends PortHandler {
  dispose(): void;
}

export function bridgeCrossRealmPreview(
  port: number,
  opts: { readonly timeoutMs?: number } = {},
): CrossRealmPortHandler {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const channelName = channelNameFor(previewPortChannelUrl(port));
  const channel = new BroadcastChannel(channelName);
  const pending = new Map<
    string,
    {
      resolve(response: Response): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as PreviewPortFrame;
    if (frame.type === 'request') return; // Page-side ignores its own request frames echo'd by the channel back to it; BroadcastChannel does NOT echo to the same realm, but cross-realm broadcasts will reach the page if a future worker reflects them. Defensive.
    const waiter = pending.get(frame.requestId);
    if (!waiter) return;
    pending.delete(frame.requestId);
    clearTimeout(waiter.timer);
    if (frame.type === 'error') {
      waiter.resolve(
        new Response(frame.message, {
          status: 502,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
      );
      return;
    }
    const body: BodyInit | null = frame.body
      ? (() => {
          const copy = new ArrayBuffer(frame.body.byteLength);
          new Uint8Array(copy).set(frame.body);
          return copy;
        })()
      : null;
    waiter.resolve(
      new Response(body, {
        status: frame.status,
        statusText: frame.statusText,
        headers: frame.headers,
      }),
    );
  };

  channel.addEventListener('message', onMessage as unknown as EventListener);

  let torn = false;

  const handler = (async (request: Request): Promise<Response> => {
    if (torn) {
      return new Response('preview-port bridge disposed', { status: 502 });
    }
    const requestId = nextRequestId();
    const bodyBytes =
      request.method === 'GET' || request.method === 'HEAD'
        ? null
        : new Uint8Array(await request.arrayBuffer());
    const frame: PreviewPortFrame = {
      type: 'request',
      requestId,
      method: request.method,
      url: request.url,
      headers: headersToObject(request.headers),
      body: bodyBytes,
    };
    const promise = new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve(
          new Response(`preview-port bridge timeout after ${timeoutMs}ms`, {
            status: 502,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }),
        );
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
