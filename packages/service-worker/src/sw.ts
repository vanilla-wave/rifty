/// <reference lib="webworker" />
/**
 * rifty Service Worker. Lifecycle (install/activate/claim), ping handler for
 * liveness (with version echo for drift detection — ADR-0016), and the
 * `/preview/<port>/*` fetch interceptor that forwards requests to the
 * controlled window client.
 */

import { installPreviewInterceptor } from './preview-bridge.ts';
import { SW_PING, SW_PONG, SW_PROTOCOL_VERSION } from './protocol.ts';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

const pingMismatchWarned = new Set<string>();

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: unknown; version?: unknown } | null;
  if (!data || typeof data !== 'object' || data.type !== SW_PING) return;
  const source = event.source as Client | ServiceWorker | MessagePort | null;
  const clientId =
    source && 'id' in source && typeof source.id === 'string' ? source.id : '<unknown>';
  if (data.version !== SW_PROTOCOL_VERSION) {
    if (!pingMismatchWarned.has(clientId)) {
      pingMismatchWarned.add(clientId);
      console.warn(
        `[rifty/service-worker] ping protocol version mismatch from ${clientId}: got ${String(
          data.version,
        )}, want ${SW_PROTOCOL_VERSION}`,
      );
    }
    // Do not respond — the host will treat the lack of a pong as a fail
    // distinct from a version-mismatched pong it can't trust.
    return;
  }
  event.source?.postMessage({
    type: SW_PONG,
    version: SW_PROTOCOL_VERSION,
    from: 'service-worker',
  });
});

installPreviewInterceptor(self);
