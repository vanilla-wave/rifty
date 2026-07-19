/**
 * Shared Workbench ↔ Service Worker preview-bridge wiring.
 *
 * The handler closure receives only what it needs — no Solid imports, no
 * port-binding state — so it stays a pure adapter between two package
 * boundaries (`@riftydev/service-worker` ↔ `@riftydev/net`).
 */
import { type CrossRealmPortHandler, dispatchToPort } from '@riftydev/net';
import {
  type SerializedRequest,
  type SerializedResponse,
  setupPreviewBridge,
} from '@riftydev/service-worker';

/**
 * Mount the page-side preview-bridge handler. Returns the
 * `setupPreviewBridge` teardown unchanged — callers invoke it on adapter close.
 *
 * ADR-0017 phase 1 streaming: this handler passes `response.body` through
 * without buffering; `setupPreviewBridge` picks the carrier per-response via
 * `packSerializedResponse` (transferable stream, else buffered fallback).
 *
 * ADR-0086 fast-path: when the caller supplies the typed `bridge`
 * ({@link CrossRealmPortHandler}), each request takes
 * `bridge.dispatchStruct(...)` — skipping the page→worker `Request` rebuild +
 * `arrayBuffer()` drain. Without a typed handle it falls back to
 * `dispatchToPort(Request)`.
 */
export interface PlaygroundPreviewBridgeOptions {
  readonly ownerToken?: string;
  /**
   * Ports this window serves (ADR-0160). Advertised in the
   * `rifty:preview:ready` frame so the SW routes `/preview/<port>/` by port to
   * THIS window — multi-window isolation. Flows through `opts` into
   * `setupPreviewBridge`'s `PreviewBridgeOptions.ports`.
   */
  readonly ports?: readonly number[];
}

export function mountPlaygroundPreviewBridge(
  bridge?: CrossRealmPortHandler,
  opts: PlaygroundPreviewBridgeOptions = {},
): () => void {
  return setupPreviewBridge(async (req: SerializedRequest): Promise<SerializedResponse> => {
    let response: Response;
    if (bridge) {
      response = await bridge.dispatchStruct({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.body ?? null,
      });
    } else {
      const headers = new Headers(req.headers);
      const init: RequestInit = { method: req.method, headers };
      if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
        const copy = new ArrayBuffer(req.body.byteLength);
        new Uint8Array(copy).set(req.body);
        init.body = copy;
      }
      response = await dispatchToPort(req.port, new Request(req.url, init));
    }
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      body: response.body,
    };
  }, opts);
}
