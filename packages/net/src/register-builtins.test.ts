import { afterEach, describe, expect, it } from 'vitest';
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
});
