import * as nativeHttp from 'node:http';
import * as nativeNet from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import http from './http.ts';
import net from './net.ts';
import { createNetBuiltinOverrides } from './register-builtins.ts';
import { isPortRegisteredBy, listPorts, unregisterPort } from './registry.ts';

interface OwnedServer {
  listen(port: number): OwnedServer;
  address(): { readonly port: number } | null;
  close(): OwnedServer;
}

interface ServerBuiltin {
  readonly createServer: () => OwnedServer;
  readonly Server: new () => OwnedServer;
}

function identity(module: ServerBuiltin): {
  readonly factoryName: string;
  readonly serverName: string;
  readonly factoryOwnsConstructor: boolean;
  readonly factoryOwnsPrototype: boolean;
} {
  const server = module.createServer();
  return {
    factoryName: module.createServer.name,
    serverName: module.Server.name,
    factoryOwnsConstructor: server.constructor === module.Server,
    factoryOwnsPrototype: Object.getPrototypeOf(server) === module.Server.prototype,
  };
}

afterEach(() => {
  for (const port of listPorts()) unregisterPort(port);
});

describe('loader-local net builtin ownership', () => {
  it('binds createServer and Server for node:http and node:net', () => {
    const owner = Symbol('selected loader');
    const overrides = createNetBuiltinOverrides(owner);
    const factories = [
      () => (overrides.get('node:http') as unknown as ServerBuiltin).createServer(),
      () => new (overrides.get('node:http') as unknown as ServerBuiltin).Server(),
      () => (overrides.get('node:net') as unknown as ServerBuiltin).createServer(),
      () => new (overrides.get('node:net') as unknown as ServerBuiltin).Server(),
    ];

    for (const create of factories) {
      const server = create().listen(0);
      const port = server.address()?.port;
      expect(port).toBeTypeOf('number');
      expect(isPortRegisteredBy(port as number, owner)).toBe(true);
      server.close();
    }
  });

  it('preserves ordinary and Node factory/constructor identity', () => {
    const overrides = createNetBuiltinOverrides(Symbol('selected loader'));
    const rows = [
      {
        native: nativeHttp as unknown as ServerBuiltin,
        ordinary: http as unknown as ServerBuiltin,
        owned: overrides.get('node:http') as unknown as ServerBuiltin,
      },
      {
        native: nativeNet as unknown as ServerBuiltin,
        ordinary: net as unknown as ServerBuiltin,
        owned: overrides.get('node:net') as unknown as ServerBuiltin,
      },
    ];

    for (const row of rows) {
      const native = identity(row.native);
      const ordinary = identity(row.ordinary);
      const owned = identity(row.owned);
      expect(owned.factoryName).toBe(ordinary.factoryName);
      expect(owned.serverName).toBe(ordinary.serverName);
      for (const observed of [native, ordinary, owned]) {
        expect(observed.factoryName).toBe('createServer');
        expect(observed.factoryOwnsConstructor).toBe(true);
        expect(observed.factoryOwnsPrototype).toBe(true);
      }
    }
  });
});
