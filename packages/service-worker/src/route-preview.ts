/**
 * SW-side routing for a matched `/preview/<port>/*` fetch. Asks the
 * supplied {@link PreviewOwnerBinding} for the realm that owns the
 * registered process, gates on the ready handshake, and forwards the
 * serialised request to that owner over a fresh `MessageChannel`.
 *
 * Lives in its own module so `preview-bridge.ts` stays under the ADR-0024
 * file-size budget.
 *
 * ADR-0031 — the default binding's resolver
 * ({@link FirstWindowOwnerResolver}, wrapped by
 * {@link FirstWindowOwnerBinding}) prefers `event.resultingClientId` then
 * `event.clientId`. The legacy "first controlled window" path remains as a
 * defensive fallback for navigation-preload edge cases (and for tests that
 * simulate fetches without an owning client); each such fallback warns
 * once via `console.warn` so the misroute case is visible in production.
 * ADR-0046 lands the {@link WorkerOwnerBinding} consumer for A-023
 * (SW→Worker direct routing), and the route-preview path here is the
 * single seam both bindings flow through.
 */

import { synthesizePreviewUrl } from '@riftydev/io';
import type { PreviewOwnerBinding, ReadinessSignal } from './preview-owner-binding.ts';
import {
  SW_ERROR_PROTOCOL_VERSION_MISMATCH,
  SW_FRAME_VERSION,
  SW_PREVIEW_REQUEST,
  SW_ROUTING_VERSION,
  type SerializedRequest,
  type SerializedResponse,
  type SwProtocolVersionMismatchError,
} from './protocol.ts';

/**
 * Forward a matched preview fetch to the owning client and translate the
 * client's reply back into a {@link Response}. Returns 503 when the owner
 * cannot be resolved, when the handshake times out, when the client posts a
 * mismatched protocol version, when the owner is detected as gone
 * mid-wait, or when the main thread replies with a
 * `PROTOCOL_VERSION_MISMATCH` error frame.
 *
 * `binding.resolveOwner` is responsible for window vs worker dispatch.
 * `readiness` is the live signal returned by
 * `binding.subscribeReadiness(scope)` — owned by `createPreviewInterceptor`
 * and shared across every in-flight fetch handled by that interceptor.
 */
export async function routePreview(
  scope: ServiceWorkerGlobalScope,
  request: Request,
  match: { port: number; path: string },
  readiness: ReadinessSignal,
  timeoutMs: number,
  clientId: string | null,
  binding: PreviewOwnerBinding,
): Promise<Response> {
  const client = await binding.resolveOwner(scope, request, clientId, match.port);
  if (!client) {
    return new Response(`No client to serve preview port ${match.port}`, { status: 503 });
  }
  if (readiness.isMismatched(client.id)) {
    return new Response('protocol version mismatch', { status: 503 });
  }
  const outcome = await readiness.waitForReady(client.id, timeoutMs);
  if (outcome === 'mismatch') {
    return new Response('protocol version mismatch', { status: 503 });
  }
  if (outcome === 'gone') {
    return new Response(`preview owner ${client.id} departed before handshake`, { status: 503 });
  }
  if (outcome === 'timeout') {
    if (readiness.isMismatched(client.id)) {
      return new Response('protocol version mismatch', { status: 503 });
    }
    return new Response(`preview-bridge not ready within ${timeoutMs}ms`, { status: 503 });
  }

  const channel = new MessageChannel();
  const bodyBytes =
    request.method === 'GET' || request.method === 'HEAD'
      ? null
      : new Uint8Array(await request.arrayBuffer());
  const requestId = readiness.nextRequestId();
  // URL synthesis goes through `synthesizePreviewUrl` from
  // `@riftydev/io/preview-protocol` (ADR-0036). The shape of that contract is
  // pinned by `SW_ROUTING_VERSION` (ADR-0040) — bumping it requires changing
  // the addressing scheme on both peers in lockstep.
  const serialised: SerializedRequest = {
    port: match.port,
    url: `${synthesizePreviewUrl(match.path)}${new URL(request.url).search}`,
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
          // Drift detected by the page-side peer. The SW only sees this as a
          // 503 carrier; logging the structured `(expected, got)` pairs from
          // the SW makes the actual bump visible in DevTools without having
          // to inspect the body.
          console.error('[rifty/service-worker] preview reply protocol mismatch', {
            expected: err.expected,
            got: err.got,
          });
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
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        request: serialised,
      },
      [channel.port2],
    );
  });
}
