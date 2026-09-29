/**
 * Barrel for the streaming `@riftydev/net` HTTP layer (ADR-0017 phase 1) and
 * owner of the `node:http` module object.
 */
import { Agent } from './agent.ts';
import { METHODS, maxHeaderSize } from './methods.ts';
import { IncomingMessage } from './request.ts';
import { ServerResponse } from './response.ts';
import { HttpServer, createServer, get, request } from './server.ts';
import { STATUS_CODES } from './status-codes.ts';

export { IncomingMessage, IncomingMessageFromFetch } from './request.ts';
export { METHODS, maxHeaderSize } from './methods.ts';
export { ServerResponse } from './response.ts';
export { HttpServer, createServer, get, request } from './server.ts';
export { STATUS_CODES } from './status-codes.ts';
export { WebSocketUpgradeSocket } from './upgrade-socket.ts';
export type { WebSocketBridgeFrame, WebSocketUpgradeSocketOptions } from './upgrade-socket.ts';

const http = {
  createServer,
  request,
  get,
  Server: HttpServer,
  IncomingMessage,
  ServerResponse,
  STATUS_CODES,
  METHODS,
  maxHeaderSize,
  Agent,
};
export default http;
