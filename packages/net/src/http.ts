/**
 * `node:http` over the registry — compatibility re-export.
 *
 * The implementation lives in `http/` (split for the file-size budget in
 * decision-workflow.md after the streaming rewrite landed). This module keeps the historical
 * import path stable for `index.ts`, `register-builtins.ts`, and any
 * downstream consumer.
 */

export {
  IncomingMessage,
  IncomingMessageFromFetch,
  ServerResponse,
  HttpServer,
  createServer,
  get,
  request,
  default,
  STATUS_CODES,
  METHODS,
  maxHeaderSize,
  WebSocketUpgradeSocket,
} from './http/index.ts';
export type { WebSocketBridgeFrame, WebSocketUpgradeSocketOptions } from './http/index.ts';
