/**
 * Shared playground ↔ Service Worker preview-bridge wiring.
 *
 * Both M10 dev modes (`devMode.ts` mock Vite and `realVite.ts` real Vite)
 * mount the same `setupPreviewBridge` handler that translates a
 * `SerializedRequest` from the SW into a `dispatchToPort` call against the
 * `@rifty/net` port registry, then returns the streaming `Response` as a
 * `SerializedResponse`. The two adapters had byte-identical copies of this
 * function before — the 2026-05-26 architecture review (sweeping theme 4
 * "Built for the future but not connected" + Приложение → playground →
 * "Дублированный preview-bridge wiring") flagged the divergence-hazard.
 *
 * Extracting here keeps the seam tiny: one function, two call sites. The
 * handler closure deliberately receives only what it needs — no Solid
 * imports, no port-binding state — so it remains a pure adapter between two
 * package boundaries (`@rifty/service-worker` ↔ `@rifty/net`).
 */
import { dispatchToPort } from '@rifty/net';
import {
  type SerializedRequest,
  type SerializedResponse,
  setupPreviewBridge,
} from '@rifty/service-worker';

/**
 * Mount the playground-side preview-bridge handler. Returns the teardown
 * function from `setupPreviewBridge` unchanged — callers store it and call
 * on adapter close.
 *
 * ADR-0017 phase 1 streaming: `response.body` flows through to the bridge
 * as a `ReadableStream` when the runtime supports transferable streams,
 * with a buffered fallback. The handler does not buffer here — the
 * `setupPreviewBridge` plumbing in `@rifty/service-worker` picks the
 * carrier per-response via `packSerializedResponse`.
 */
export function mountPlaygroundPreviewBridge(): () => void {
  return setupPreviewBridge(async (req: SerializedRequest): Promise<SerializedResponse> => {
    const headers = new Headers(req.headers);
    const init: RequestInit = { method: req.method, headers };
    if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
      const copy = new ArrayBuffer(req.body.byteLength);
      new Uint8Array(copy).set(req.body);
      init.body = copy;
    }
    const response = await dispatchToPort(req.port, new Request(req.url, init));
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      body: response.body,
    };
  });
}
