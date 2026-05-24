/// <reference lib="webworker" />
/**
 * rifty Service Worker. Lifecycle (install/activate/claim), ping handler for
 * liveness, and the `/preview/<port>/*` fetch interceptor that forwards
 * requests to a window client for handling by the runtime's port registry.
 */

import { installPreviewInterceptor } from './preview-bridge.ts';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as unknown;
  if (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data as { type: string }).type === '__rifty_sw_ping__'
  ) {
    event.source?.postMessage({ type: '__rifty_sw_pong__', from: 'service-worker' });
  }
});

installPreviewInterceptor(self);
