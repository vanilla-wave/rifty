import { describe, expect, it } from 'vitest';
import { createServer as createHttpServer } from './http/server.ts';
import { createServer as createNetServer } from './net.ts';

interface AddressInfo {
  readonly address: string;
  readonly family: 'IPv4' | 'IPv6';
  readonly port: number;
}

interface AddressableServer {
  listen(port: number, hostnameOrCb?: string | (() => void), cb?: () => void): this;
  listen(options: { port?: number; host?: string }, cb?: () => void): this;
  address(): AddressInfo | { readonly port: number } | null;
  close(cb?: () => void): this;
}

type ListenCase =
  | { readonly name: string; readonly kind: 'default' }
  | { readonly name: string; readonly kind: 'positional'; readonly host: string }
  | { readonly name: string; readonly kind: 'options'; readonly host: string };

const listenCases: readonly ListenCase[] = [
  { name: 'default host', kind: 'default' },
  { name: 'positional IPv4 host', kind: 'positional', host: '127.0.0.1' },
  { name: 'options IPv4 host', kind: 'options', host: '127.0.0.1' },
  { name: 'IPv4 wildcard host', kind: 'positional', host: '0.0.0.0' },
  { name: 'positional IPv6 host', kind: 'positional', host: '::1' },
  { name: 'options IPv6 host', kind: 'options', host: '::1' },
];

async function listen(server: AddressableServer, testCase: ListenCase): Promise<void> {
  await new Promise<void>((resolve) => {
    if (testCase.kind === 'default') {
      server.listen(0, resolve);
    } else if (testCase.kind === 'positional') {
      server.listen(0, testCase.host, resolve);
    } else {
      server.listen({ port: 0, host: testCase.host }, resolve);
    }
  });
}

async function close(server: AddressableServer): Promise<void> {
  await new Promise<void>((resolve) => server.close(resolve));
}

describe.each([
  ['http.Server', () => createHttpServer()],
  ['net.Server', () => createNetServer()],
] as const)('%s.address()', (_name, create) => {
  it.each(listenCases)(
    'returns the effective virtual AddressInfo for $name only while bound',
    async (testCase) => {
      const server: AddressableServer = create();
      expect(server.address()).toBeNull();

      await listen(server, testCase);
      const address = server.address();
      expect(address?.port).toBeGreaterThanOrEqual(1);
      expect(address?.port).toBeLessThanOrEqual(65535);
      expect(address).toEqual({
        address: '127.0.0.1',
        family: 'IPv4',
        port: address?.port,
      });

      await close(server);
      expect(server.address()).toBeNull();
    },
  );
});
