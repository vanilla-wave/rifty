/**
 * SW-side routing for a matched `/preview/<port>/*` fetch. Resolves the
 * owning window client, gates on the ready handshake, and forwards the
 * serialised request to that client over a fresh `MessageChannel`.
 *
 * Lives in its own module so `preview-bridge.ts` stays under the ADR-0024
 * file-size budget.
 *
 * ADR-0031 — the SW prefers `event.resultingClientId` then `event.clientId`
 * for client lookup. The legacy "first controlled window" path remains as a
 * defensive fallback for navigation-preload edge cases (and for tests that
 * simulate fetches without an owning client); each such fallback warns once
 * via `console.warn` so the misroute case is visible in production.
 */

import type { SerializedResponse } from './body-transport.ts';
import {
  SW_ERROR_PROTOCOL_VERSION_MISMATCH,
  SW_PREVIEW_REQUEST,
  SW_PROTOCOL_VERSION,
  type SerializedRequest,
  type SwProtocolVersionMismatchError,
} from './protocol.ts';
import type { ReadyClientsRegistry } from './ready-clients.ts';

let nextRequestId = 1;

// One-shot dedup: the no-clientId fallback warns once per SW scope so the
// signal is visible without spamming the console on every fetch. Keyed by
// scope identity, which is stable across the SW's lifetime.
const fallbackWarned = new WeakSet<ServiceWorkerGlobalScope>();

/**
 * Look up the window client that owns the in-flight fetch. Prefers the
 * `clientId` carried by the `FetchEvent`. Falls back to the first controlled
 * window only when the event has no id — warns once per scope because in a
 * multi-window page this *will* misroute.
 */
async function resolveOwningClient(
  scope: ServiceWorkerGlobalScope,
  clientId: string | null,
): Promise<Client | null> {
  if (clientId) {
    const direct = (await scope.clients.get(clientId)) as Client | undefined;
    if (direct) return direct;
  }
  const all = await scope.clients.matchAll({ type: 'window', includeUncontrolled: false });
  if (all.length === 0) return null;
  if (!fallbackWarned.has(scope)) {
    fallbackWarned.add(scope);
    // eslint-disable-next-line no-console
    console.warn(
      '[rifty/service-worker] preview fetch had no clientId; falling back to first controlled window',
    );
  }
  return all[0] ?? null;
}

/**
 * Forward a matched preview fetch to the owning client and translate the
 * client's reply back into a {@link Response}. Returns 503 when the owner
 * cannot be resolved, when the handshake times out, when the client posts a
 * mismatched protocol version, or when the main thread replies with a
 * `PROTOCOL_VERSION_MISMATCH` error frame.
 */
export async function routePreview(
  scope: ServiceWorkerGlobalScope,
  request: Request,
  match: { port: number; path: string },
  registry: ReadyClientsRegistry,
  timeoutMs: number,
  clientId: string | null,
): Promise<Response> {
  const client = await resolveOwningClient(scope, clientId);
  if (!client) {
    return new Response(`No client to serve preview port ${match.port}`, { status: 503 });
  }
  if (registry.isMismatched(client.id)) {
    return new Response('protocol version mismatch', { status: 503 });
  }
  const outcome = await registry.waitForReady(client.id, timeoutMs);
  if (outcome === 'mismatch') {
    return new Response('protocol version mismatch', { status: 503 });
  }
  if (outcome === 'timeout') {
    if (registry.isMismatched(client.id)) {
      return new Response('protocol version mismatch', { status: 503 });
    }
    return new Response(`preview-bridge not ready within ${timeoutMs}ms`, { status: 503 });
  }

  const channel = new MessageChannel();
  const bodyBytes =
    request.method === 'GET' || request.method === 'HEAD'
      ? null
      : new Uint8Array(await request.arrayBuffer());
  const requestId = nextRequestId++;
  const serialised: SerializedRequest = {
    port: match.port,
    url: `http://preview.local${match.path}${new URL(request.url).search}`,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: bodyBytes,
  };

  return new Promise<Response>((resolve) => {
    channel.port1.onmessage = (e): void => {
      const data = e.data as
        | SerializedResponse
        | { error: string | SwProtocolVersionMismatchError };
      if ('error' in data) {
        const err = data.error;
        if (typeof err === 'object' && err.kind === SW_ERROR_PROTOCOL_VERSION_MISMATCH) {
          resolve(new Response(err.message, { status: 503 }));
          return;
        }
        resolve(new Response(typeof err === 'string' ? err : err.message, { status: 502 }));
        return;
      }
      const headers = new Headers(data.headers);
      // The playground page is cross-origin-isolated (COOP same-origin + COEP
      // credentialless — D-001). Iframe-loaded preview responses need their
      // own CORP + COEP or the browser blocks them. Set defaults that match
      // the page; explicit handler-supplied values win because Headers.set
      // here would overwrite — only set if absent.
      if (!headers.has('Cross-Origin-Resource-Policy')) {
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      }
      if (!headers.has('Cross-Origin-Embedder-Policy')) {
        headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      }
      let body: BodyInit | null = null;
      const raw = data.body;
      if (raw instanceof ReadableStream) {
        body = raw;
      } else if (raw instanceof Uint8Array) {
        const copy = new ArrayBuffer(raw.byteLength);
        new Uint8Array(copy).set(raw);
        body = copy;
      } else if (raw != null) {
        // Defensive: handle plain ArrayBuffer too. `data` is structured-cloned
        // on the wire, so a Uint8Array view becomes a Uint8Array again, and
        // an ArrayBuffer stays an ArrayBuffer.
        body = raw as ArrayBuffer;
      }
      resolve(new Response(body, { status: data.status, statusText: data.statusText, headers }));
    };
    client.postMessage(
      {
        type: SW_PREVIEW_REQUEST,
        requestId,
        version: SW_PROTOCOL_VERSION,
        request: serialised,
      },
      [channel.port2],
    );
  });
}
