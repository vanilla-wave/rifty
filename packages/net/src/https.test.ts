import { afterEach, describe, expect, it, vi } from 'vitest';
import https from './https.ts';

const decoder = new TextDecoder();

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for condition');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('node:https client request/get over the page fetch (ADR-0181)', () => {
  it('https.get(url, cb) routes over fetch and yields a Node-shaped IncomingMessage', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('hello-tls', { status: 200, headers: { 'content-type': 'text/plain' } }),
      );

    const result = await new Promise<{
      statusCode: number;
      statusMessage: string;
      headers: Record<string, string>;
      body: string;
      isReadable: boolean;
    }>((resolve, reject) => {
      const req = https.get('https://api.example.com/resource', (res) => {
        const chunks: string[] = [];
        res.on('data', (chunk) => chunks.push(decoder.decode(chunk as Uint8Array)));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body: chunks.join(''),
            isReadable: typeof (res as { pipe?: unknown }).pipe === 'function',
          }),
        );
        res.on('error', reject);
      });
      req.on('error', reject);
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('text/plain');
    expect(result.body).toBe('hello-tls');
    expect(result.isReadable).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchSpy.mock.calls[0]![0])).protocol).toBe('https:');
  });

  it('https.request(options, cb) forces https: egress and fires response === callback arg', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    const { cbRes, evRes, statusCode } = await new Promise<{
      cbRes: unknown;
      evRes: unknown;
      statusCode: number;
    }>((resolve, reject) => {
      let cbRes: unknown;
      let evRes: unknown;
      const req = https.request(
        { hostname: 'api.example.com', path: '/x', method: 'GET' },
        (res) => {
          cbRes = res;
          res.on('data', () => {});
          res.on('end', () => resolve({ cbRes, evRes, statusCode: res.statusCode }));
          res.on('error', reject);
        },
      );
      req.on('response', (res: unknown) => {
        evRes = res;
      });
      req.on('error', reject);
      req.end();
    });

    expect(cbRes).toBe(evRes);
    expect(statusCode).toBe(200);
    const calledUrl = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(calledUrl.protocol).toBe('https:');
    expect(calledUrl.hostname).toBe('api.example.com');
  });

  it('supports request(url, options, cb) 3-arg merge, forwarding method + headers over https fetch', async () => {
    let seenInit: RequestInit | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      seenInit = init;
      return new Response('ok', { status: 200 });
    });

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        'https://api.example.com/data',
        { method: 'POST', headers: { 'x-probe': 'yes' } },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(seenInit?.method).toBe('POST');
    expect(new Headers(seenInit?.headers).get('x-probe')).toBe('yes');
    expect(new URL(String(fetchSpy.mock.calls[0]![0])).protocol).toBe('https:');
  });

  it('streams a POST body over https fetch and signals backpressure with drain', async () => {
    const drains: string[] = [];
    let received = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = (init as RequestInit | undefined)?.body;
      if (body instanceof ReadableStream) {
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) received += decoder.decode(value);
        }
      }
      return new Response('server-ok', { status: 200 });
    });

    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = https.request(
        { hostname: 'api.example.com', path: '/upload', method: 'POST' },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve(res.statusCode));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.on('drain', () => drains.push('drain'));
      expect(req.write('a')).toBe(true);
      expect(req.write('b')).toBe(false);
      void waitFor(() => drains.length >= 1)
        .then(() => req.end())
        .catch(reject);
    });

    expect(statusCode).toBe(200);
    expect(received).toBe('ab');
    expect(drains).toEqual(['drain']);
  });

  it('delivers a 204 null-body response without emitting invalid data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    const { statusCode, dataChunks } = await new Promise<{
      statusCode: number;
      dataChunks: number;
    }>((resolve, reject) => {
      let dataChunks = 0;
      const req = https.get('https://api.example.com/empty', (res) => {
        res.on('data', () => {
          dataChunks += 1;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, dataChunks }));
        res.on('error', reject);
      });
      req.on('error', reject);
    });

    expect(statusCode).toBe(204);
    expect(dataChunks).toBe(0);
  });
});

describe('node:https TLS/socket controls throw, never silently honored (ADR-0181 D3)', () => {
  it('throws NotImplementedError for rejectUnauthorized:false naming the refused option', () => {
    let caught: Error | undefined;
    try {
      https.request({ hostname: 'api.example.com', rejectUnauthorized: false });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.name).toBe('NotImplementedError');
    expect(caught?.message).toContain('node:https.rejectUnauthorized');
  });

  it.each(['cert', 'key', 'ca', 'pfx', 'passphrase', 'ciphers', 'secureProtocol', 'servername'])(
    'throws NotImplementedError for TLS option %s',
    (option) => {
      expect(() =>
        https.request({ hostname: 'api.example.com', [option]: 'value' } as Record<
          string,
          unknown
        >),
      ).toThrow(new RegExp(`node:https\\.${option}`));
    },
  );

  it('throws for a custom agent instance (no socket pool in the browser)', () => {
    expect(() =>
      https.request({ hostname: 'api.example.com', agent: { maxSockets: 1 } } as Record<
        string,
        unknown
      >),
    ).toThrow(/node:https\.agent/);
  });

  it('does NOT throw for rejectUnauthorized:true — the browser already validates TLS', () => {
    // The TLS guard runs synchronously at creation, so no dispatch is needed to
    // prove the option is honoured (it matches the browser) rather than refused.
    expect(() =>
      https.request({ hostname: 'api.example.com', rejectUnauthorized: true }),
    ).not.toThrow();
  });

  it('does NOT throw when agent is the benign globalAgent or false', () => {
    expect(() =>
      https.request({ hostname: 'api.example.com', agent: https.globalAgent } as Record<
        string,
        unknown
      >),
    ).not.toThrow();
    expect(() =>
      https.request({ hostname: 'api.example.com', agent: false } as Record<string, unknown>),
    ).not.toThrow();
  });
});

describe('node:https server + Agent surface stays a loud throw (ADR-0010 ceiling)', () => {
  it('createServer throws NotImplementedError naming createServer + TLS termination', () => {
    let caught: Error | undefined;
    try {
      https.createServer();
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.name).toBe('NotImplementedError');
    expect(caught?.message).toContain('node:https.createServer');
    expect(caught?.message).toContain('TLS termination');
  });

  it('new Agent() throws NotImplementedError', () => {
    const construct = () => new https.Agent();
    let caught: Error | undefined;
    try {
      construct();
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.name).toBe('NotImplementedError');
    expect(caught?.message).toContain('node:https.Agent');
  });
});

describe('node:https.globalAgent is a benign config object (ADR-0181 D2)', () => {
  it('is a truthy object whose config reads never throw', () => {
    expect(typeof https.globalAgent).toBe('object');
    expect(https.globalAgent).toBeTruthy();
    expect(() => https.globalAgent.maxSockets).not.toThrow();
    expect(https.globalAgent.maxSockets).toBe(Number.POSITIVE_INFINITY);
    expect(https.globalAgent.protocol).toBe('https:');
  });
});

describe('loopback https has no in-browser TLS server (pairs with ADR-0180 D4)', () => {
  it('throws naming the loopback gap instead of leaking to the real loopback', () => {
    expect(() => https.get('https://localhost:8443/x')).toThrow(
      /loopback https targets have no in-browser TLS server/,
    );
    expect(() => https.request({ hostname: '127.0.0.1', port: 8443, path: '/' })).toThrow(
      /loopback https targets have no in-browser TLS server/,
    );
  });

  it('does not call fetch for a loopback https target', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('leak'));
    try {
      https.get('https://localhost:8443/x');
    } catch {
      /* expected throw */
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('node:https module surface', () => {
  it('imports with the expected client + ceiling surface', () => {
    expect(https).toBeDefined();
    expect(typeof https.request).toBe('function');
    expect(typeof https.get).toBe('function');
    expect(typeof https.createServer).toBe('function');
    expect(typeof https.Agent).toBe('function');
  });
});
