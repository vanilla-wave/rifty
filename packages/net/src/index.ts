export {
  default as net,
  createServer as createNetServer,
  connect as netConnect,
  createConnection as createNetConnection,
  Server as NetServer,
  HttpFramedSocket,
  Socket,
} from './net.ts';
export {
  default as http,
  createServer as createHttpServer,
  get as httpGet,
  request,
  HttpServer,
  IncomingMessage,
  ServerResponse,
  STATUS_CODES,
  METHODS,
  maxHeaderSize,
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
  portChannelNameFor,
  webSocketBridgeClientScript,
} from './ws.ts';
export type {
  CrossRealmBridge,
  WebSocketBridgeClientScriptOptions,
  WebSocketBridgeInstrumentation,
  WsMessage,
} from './ws.ts';

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
// ADR-0185 — cross-realm bind-claim window knob (the `listen()` claim defers
// `'listening'` by this long; injectable so single-realm harnesses/tests can run
// it at 0 and deployments can tune the bound). `releasePort` is the `close()`
// counterpart (mirrors the public `unregisterPort`); `claimPort` stays internal
// to `listen`.
export {
  getDefaultClaimWindowMs,
  releasePort,
  setDefaultClaimWindowMs,
} from './cross-realm/port-claim.ts';
export type {
  CrossRealmPortHandler,
  PreviewDispatchStruct,
} from './cross-realm/preview-port.ts';
