/// <reference lib="webworker" />
/**
 * rifty Service Worker. Lifecycle (install/activate/claim), ping handler for
 * liveness (with version echo for drift detection — ADR-0016/ADR-0040), and
 * the `/preview/<port>/*` fetch interceptor that forwards requests to the
 * controlled window client.
 */

import { createControlPingHandler } from './control-ping.ts';
import { installPreviewInterceptor } from './preview-bridge.ts';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', createControlPingHandler());

installPreviewInterceptor(self);
