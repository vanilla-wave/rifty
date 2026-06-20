/**
 * SW-side routing for a matched `/preview/<port>/*` fetch. Asks the
 * {@link PreviewOwnerBinding} for the realm owning the registered process,
 * gates on the ready handshake, and forwards the serialised request to that
 * owner over a fresh `MessageChannel`.
 *
 * Separate module so `preview-bridge.ts` stays under the ADR-0024 file-size budget.
 *
 * ADR-0031 — the default binding's resolver
 * ({@link FirstWindowOwnerResolver}, wrapped by
 * {@link FirstWindowOwnerBinding}) prefers `event.resultingClientId` then
 * `event.clientId`. The legacy "first controlled window" path is a defensive
 * fallback for navigation-preload edge cases (and tests simulating fetches
 * without an owning client); each fallback warns once via `console.warn` so
 * misroutes are visible in production. ADR-0046 lands the
 * {@link WorkerOwnerBinding} consumer for A-023 (SW→Worker direct routing);
 * route-preview is the single seam both bindings flow through.
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

// Error responses need the same CORP+COEP as the success path
// (route-preview.ts ~118-127) or the iframe blocks them under page COEP
// credentialless (D-001). 503/502 honesty: a foreign tab sees the page, not
// ERR_BLOCKED_BY_RESPONSE.
function previewErrorResponse(body: string, status: number): Response {
  const headers = new Headers();
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(body, { status, headers });
}

/**
 * Forward a matched preview fetch to the owning client and translate the
 * reply back into a {@link Response}. Returns 503 when the owner cannot be
 * resolved, the handshake times out, the client posts a mismatched protocol
 * version, the owner is detected gone mid-wait, or the main thread replies
 * with a `PROTOCOL_VERSION_MISMATCH` error frame.
 *
 * `binding.resolveOwner` handles window vs worker dispatch. `readiness` is the
 * live signal from `binding.subscribeReadiness(scope)` — owned by
 * `createPreviewInterceptor` and shared across every in-flight fetch it handles.
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
    return previewErrorResponse(`No client to serve preview port ${match.port}`, 503);
  }
  if (readiness.isMismatched(client.id)) {
    return previewErrorResponse('protocol version mismatch', 503);
  }
  const outcome = await readiness.waitForReady(client.id, timeoutMs);
  if (outcome === 'mismatch') {
    return previewErrorResponse('protocol version mismatch', 503);
  }
  if (outcome === 'gone') {
    return previewErrorResponse(`preview owner ${client.id} departed before handshake`, 503);
  }
  if (outcome === 'timeout') {
    if (readiness.isMismatched(client.id)) {
      return previewErrorResponse('protocol version mismatch', 503);
    }
    return previewErrorResponse(`preview-bridge not ready within ${timeoutMs}ms`, 503);
  }

  const channel = new MessageChannel();
  const bodyBytes =
    request.method === 'GET' || request.method === 'HEAD'
      ? null
      : new Uint8Array(await request.arrayBuffer());
  const requestId = readiness.nextRequestId();
  const headers = Object.fromEntries(request.headers);
  // fetch Request headers never expose content-length (the network layer adds
  // it on the wire); re-derive it from the drained bytes so worker-side body
  // parsers (express.json's typeis.hasBody) see a Node-shaped POST.
  if (bodyBytes && !('content-length' in headers) && !('transfer-encoding' in headers)) {
    headers['content-length'] = String(bodyBytes.byteLength);
  }
  // URL synthesis via `synthesizePreviewUrl` (ADR-0036); contract shape pinned
  // by `SW_ROUTING_VERSION` (ADR-0040) — bumping it changes the addressing
  // scheme on both peers in lockstep.
  const serialised: SerializedRequest = {
    port: match.port,
    url: `${synthesizePreviewUrl(match.path)}${new URL(request.url).search}`,
    method: request.method,
    headers,
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
          // Drift detected by the page-side peer; SW only carries it as a 503.
          // Log the `(expected, got)` pair so the bump shows in DevTools
          // without inspecting the body.
          console.error('[rifty/service-worker] preview reply protocol mismatch', {
            expected: err.expected,
            got: err.got,
          });
          resolve(previewErrorResponse(err.message, 503));
          return;
        }
        resolve(previewErrorResponse(typeof err === 'string' ? err : err.message, 502));
        return;
      }
      const headers = new Headers(data.headers);
      // Page is cross-origin-isolated (COOP same-origin + COEP credentialless —
      // D-001); iframe-loaded preview responses need their own CORP + COEP or
      // the browser blocks them. Only set if absent so handler-supplied values win.
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
        // Defensive: plain ArrayBuffer. `data` is structured-cloned on the wire,
        // so an ArrayBuffer stays an ArrayBuffer.
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
