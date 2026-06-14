/**
 * `@riftydev/net` WebSocket compatibility re-export.
 *
 * The implementation lives in `ws/` (split per ADR-0024 after the cross-realm
 * bridge landed in ADR-0017 phase 1). Keep the historical import path stable
 * for `index.ts`, conformance tests, and any downstream consumer.
 */

export {
  WebSocket,
  WebSocketServer,
  WebSocketConnection,
  State,
  BridgedWebSocket,
  BridgedWebSocketServer,
  BridgedWebSocketConnection,
  channelNameFor,
  createCrossRealmBridge,
  portChannelNameFor,
  webSocketBridgeClientScript,
} from './ws/index.ts';
export type {
  CrossRealmBridge,
  WebSocketBridgeClientScriptOptions,
  WebSocketBridgeInstrumentation,
  WsMessage,
} from './ws/index.ts';
