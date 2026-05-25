/**
 * `node:http` over the registry — compatibility re-export.
 *
 * The implementation lives in `http/` (split per ADR-0024 file-size budget
 * after the streaming rewrite landed). This module keeps the historical
 * import path stable for `index.ts`, `register-builtins.ts`, and any
 * downstream consumer.
 */

export {
  IncomingMessage,
  IncomingMessageFromFetch,
  ServerResponse,
  HttpServer,
  createServer,
  request,
  default,
} from './http/index.ts';
