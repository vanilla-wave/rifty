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
  HttpServer,
  type RequestListener,
  type ServerOptions,
  createServer as createHttpServer,
} from './http/server.ts';
import https from './https.ts';
import net, {
  type HttpFramedSocket,
  Server as NetServer,
  createServer as createNetServer,
} from './net.ts';
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

/** Loader-local node:http/node:net modules carrying one causal bind owner. */
export function createNetBuiltinOverrides(
  owner: PortRegistrationOwner,
): ReadonlyMap<string, Record<string, unknown>> {
  const OwnedHttpServer = new Proxy(HttpServer, {
    construct(target, args, newTarget) {
      const server = Reflect.construct(target, args, newTarget) as HttpServer;
      bindPortRegistrationOwner(server, owner);
      return server;
    },
  });
  const ownedCreateHttpServer = (
    optionsOrHandler?: ServerOptions | RequestListener,
    maybeHandler?: RequestListener,
  ): HttpServer => {
    const server =
      optionsOrHandler === undefined
        ? maybeHandler === undefined
          ? createHttpServer()
          : createHttpServer({}, maybeHandler)
        : typeof optionsOrHandler === 'function'
          ? createHttpServer(optionsOrHandler)
          : createHttpServer(optionsOrHandler, maybeHandler);
    bindPortRegistrationOwner(server, owner);
    return server;
  };
  const OwnedNetServer = new Proxy(NetServer, {
    construct(target, args, newTarget) {
      const server = Reflect.construct(target, args, newTarget) as NetServer;
      bindPortRegistrationOwner(server, owner);
      return server;
    },
  });
  const ownedCreateNetServer = (handler?: (socket: HttpFramedSocket) => void): NetServer => {
    const server = createNetServer(handler);
    bindPortRegistrationOwner(server, owner);
    return server;
  };

  return new Map([
    [
      'node:http',
      { ...http, createServer: ownedCreateHttpServer, Server: OwnedHttpServer } as Record<
        string,
        unknown
      >,
    ],
    [
      'node:net',
      { ...net, createServer: ownedCreateNetServer, Server: OwnedNetServer } as Record<
        string,
        unknown
      >,
    ],
  ]);
}
