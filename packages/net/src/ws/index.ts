/**
 * Barrel for the WebSocket layer.
 *
 * - `./in-process.ts` — same-realm URL-routed shim (default `@rifty/net`
 *   export, used by tests and the in-process dev-server).
 * - `./bridge.ts` — opt-in `BroadcastChannel`-backed transport for
 *   cross-realm clients (iframe HMR ↔ playground main thread). Returned by
 *   `createCrossRealmBridge()`.
 */

export { WebSocket, WebSocketServer, WebSocketConnection, State } from './in-process.ts';
export type { WsMessage } from './in-process.ts';
export {
  BridgedWebSocket,
  BridgedWebSocketServer,
  BridgedWebSocketConnection,
  channelNameFor,
  createCrossRealmBridge,
} from './bridge.ts';
export type { CrossRealmBridge } from './bridge.ts';
