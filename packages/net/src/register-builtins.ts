/**
 * Side-effect module: registers `node:net`, `node:http`, `node:https` shapes
 * with the shared builtin registry in `@riftydev/io` (ADR-0035). Import this
 * from a higher layer (e.g. `apps/playground` bootstrap or test setup) to
 * enable `require('http')` inside the runtime. Keeping registration here,
 * rather than in runtime-js, preserves the top-down layering rule
 * (runtime-* must not depend on net).
 */
import { registerBuiltin } from '@riftydev/io';
import http, {
  HttpServer as BaseHttpServer,
  type RequestListener,
  type ServerOptions,
  assertSupportedServerOptions,
} from './http/server.ts';
import https from './https.ts';
import net, { type HttpFramedSocket, Server as BaseNetServer } from './net.ts';
import { type PortRegistrationOwner, bindPortRegistrationOwner } from './registry.ts';

let netBuiltinsRegistered = false;

export function registerNetBuiltins(): void {
  if (netBuiltinsRegistered) return;
  netBuiltinsRegistered = true;

  registerBuiltin('net', () => net);
  registerBuiltin('http', () => http);
  // `https` client `request`/`get` route over the page fetch (ADR-0181); the
  // TLS server/socket surface (`createServer`/`Agent`/TLS opts) still throws —
  // ADR-0010 ceiling. Imports always resolve.
  registerBuiltin('https', () => https);
}

registerNetBuiltins();

function createOwnedHttpBuiltin(owner: PortRegistrationOwner): Record<string, unknown> {
  class HttpServer extends BaseHttpServer {
    constructor(handler?: RequestListener) {
      super(handler);
      bindPortRegistrationOwner(this, owner);
    }
  }
  Object.defineProperty(HttpServer, 'name', {
    value: BaseHttpServer.name,
    configurable: true,
  });
  function createServer(
    optionsOrHandler?: ServerOptions | RequestListener,
    maybeHandler?: RequestListener,
  ): HttpServer {
    const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
    if (typeof optionsOrHandler !== 'function') assertSupportedServerOptions(optionsOrHandler);
    return new HttpServer(handler);
  }
  return { ...http, createServer, Server: HttpServer } as Record<string, unknown>;
}

function createOwnedNetBuiltin(owner: PortRegistrationOwner): Record<string, unknown> {
  class Server extends BaseNetServer {
    constructor(handler?: (socket: HttpFramedSocket) => void) {
      super(handler);
      bindPortRegistrationOwner(this, owner);
    }
  }
  Object.defineProperty(Server, 'name', {
    value: BaseNetServer.name,
    configurable: true,
  });
  function createServer(handler?: (socket: HttpFramedSocket) => void): Server {
    return new Server(handler);
  }
  return { ...net, createServer, Server } as Record<string, unknown>;
}

/** Loader-local node:http/node:net modules carrying one causal bind owner. */
export function createNetBuiltinOverrides(
  owner: PortRegistrationOwner,
): ReadonlyMap<string, Record<string, unknown>> {
  return new Map([
    ['node:http', createOwnedHttpBuiltin(owner)],
    ['node:net', createOwnedNetBuiltin(owner)],
  ]);
}
