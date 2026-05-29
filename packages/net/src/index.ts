export {
  default as net,
  createServer as createNetServer,
  Server as NetServer,
  HttpFramedSocket,
  Socket,
} from './net.ts';
export {
  default as http,
  createServer as createHttpServer,
  request,
  HttpServer,
  IncomingMessage,
  ServerResponse,
} from './http.ts';
export {
  registerPort,
  unregisterPort,
  getHandler,
  listPorts,
  dispatchToPort,
  onRegistryChange,
} from './registry.ts';
export type { PortHandler } from './registry.ts';
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
} from './ws.ts';
export type { WsMessage, CrossRealmBridge } from './ws.ts';

// ADR-0043 — cross-realm preview-port bridge for Vite-in-Worker (M11 / A-026).
// Bridges page-realm `dispatchToPort()` to a Worker-realm handler over
// `BroadcastChannel`. Symmetric with the HMR bridge primitive in
// `BridgedWebSocketServer`.
export {
  bridgeCrossRealmPreview,
  previewPortChannelUrl,
  serveCrossRealmPreview,
  PREVIEW_PORT_FRAME_VERSION,
} from './cross-realm/preview-port.ts';
export type { CrossRealmPortHandler } from './cross-realm/preview-port.ts';
