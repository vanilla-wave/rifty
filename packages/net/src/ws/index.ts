/**
 * Barrel for the WebSocket layer.
 *
 * - `./in-process.ts` — default URL-routed shim with same-realm fast path and
 *   same-origin cross-realm fallback.
 * - `./bridge.ts` — opt-in compatibility transport returned by
 *   `createCrossRealmBridge()`.
 * - `./browser-client-script.ts` — injectable browser `window.WebSocket` shim.
 */

export { WebSocket, WebSocketServer, WebSocketConnection, State } from './in-process.ts';
export type { WsMessage } from './in-process.ts';
export {
  BridgedWebSocket,
  BridgedWebSocketServer,
  BridgedWebSocketConnection,
  channelNameFor,
  createCrossRealmBridge,
  portChannelNameFor,
} from './bridge.ts';
export type { CrossRealmBridge } from './bridge.ts';
export { webSocketBridgeClientScript } from './browser-client-script.ts';
export type {
  WebSocketBridgeClientScriptOptions,
  WebSocketBridgeInstrumentation,
} from './browser-client-script.ts';
