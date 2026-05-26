/// <reference lib="webworker" />
/**
 * rifty Service Worker. Lifecycle (install/activate/claim), ping handler for
 * liveness (with version echo for drift detection — ADR-0016/ADR-0040), and
 * the `/preview/<port>/*` fetch interceptor that forwards requests to the
 * controlled window client.
 */

import { installPreviewInterceptor } from './preview-bridge.ts';
import { SW_FRAME_VERSION, SW_PING, SW_PONG, SW_ROUTING_VERSION } from './protocol.ts';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

const pingMismatchWarned = new Set<string>();

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as {
    type?: unknown;
    frameVersion?: unknown;
    routingVersion?: unknown;
  } | null;
  if (!data || typeof data !== 'object' || data.type !== SW_PING) return;
  const source = event.source as Client | ServiceWorker | MessagePort | null;
  const clientId =
    source && 'id' in source && typeof source.id === 'string' ? source.id : '<unknown>';
  const frameOk = data.frameVersion === SW_FRAME_VERSION;
  const routingOk = data.routingVersion === SW_ROUTING_VERSION;
  if (!frameOk || !routingOk) {
    if (!pingMismatchWarned.has(clientId)) {
      pingMismatchWarned.add(clientId);
      const drifted: string[] = [];
      if (!frameOk) drifted.push('frame');
      if (!routingOk) drifted.push('routing');
      console.warn(
        `[rifty/service-worker] ping protocol version mismatch from ${clientId} (${drifted.join(
          '+',
        )}): got frame=${String(data.frameVersion)} routing=${String(
          data.routingVersion,
        )}, want frame=${SW_FRAME_VERSION} routing=${SW_ROUTING_VERSION}`,
      );
    }
    // Do not respond — the host will treat the lack of a pong as a fail
    // distinct from a version-mismatched pong it can't trust.
    return;
  }
  event.source?.postMessage({
    type: SW_PONG,
    frameVersion: SW_FRAME_VERSION,
    routingVersion: SW_ROUTING_VERSION,
    from: 'service-worker',
  });
});

installPreviewInterceptor(self);
