import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATUS_CODES as HTTP_STATUS_CODES } from '../http.ts';
import { STATUS_CODES as ROOT_STATUS_CODES } from '../index.ts';
import { listPorts, unregisterPort } from '../registry.ts';
import { createServer, get, request } from './server.ts';
import { STATUS_CODES } from './status-codes.ts';

const decoder = new TextDecoder();

function readClientResponse(opts: Parameters<typeof request>[0]): Promise<{
  statusCode: number;
  body: string;
}> {
  const req = request(opts);
  return new Promise((resolve, reject) => {
    req.on('response', (res: unknown) => {
      const chunks: string[] = [];
      const msg = res as {
        statusCode: number;
        on(event: 'data', cb: (chunk: Uint8Array) => void): void;
        on(event: 'end', cb: () => void): void;
        on(event: 'error', cb: (err: Error) => void): void;
      };
      msg.on('data', (chunk) => chunks.push(decoder.decode(chunk)));
      msg.on('end', () => resolve({ statusCode: msg.statusCode, body: chunks.join('') }));
      msg.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const port of listPorts()) unregisterPort(port);
});

describe('http.request — local registered port loopback', () => {
  it('routes localhost URL requests through the in-process port registry', async () => {
    const port = 4301;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`local ${req.url}`);
    }).listen(port);

    const response = await readClientResponse(`http://localhost:${port}/health?ready=1`);

    expect(response).toEqual({ statusCode: 200, body: 'local /health?ready=1' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('routes loopback option requests for 127.0.0.1 and 0.0.0.0', async () => {
    const port = 4302;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    createServer((req, res) => {
      res.end(`hit ${req.url}`);
    }).listen(port);

    await expect(
      readClientResponse({ hostname: '127.0.0.1', port, path: '/ipv4' }),
    ).resolves.toEqual({ statusCode: 200, body: 'hit /ipv4' });
    await expect(
      readClientResponse({ hostname: '0.0.0.0', port, path: '/wildcard' }),
    ).resolves.toEqual({ statusCode: 200, body: 'hit /wildcard' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('routes IPv6 loopback option requests through the in-process port registry', async () => {
    const port = 4307;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    createServer((req, res) => {
      res.end(`ipv6 ${req.url}`);
    }).listen(port);

    const response = await readClientResponse({ hostname: '::1', port, path: '/ipv6' });

    expect(response).toEqual({ statusCode: 200, body: 'ipv6 /ipv6' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps external hosts on fetch even when the port is registered', async () => {
    const port = 4303;
    createServer((_req, res) => {
      res.end('local');
    }).listen(port);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('external'));

    const response = await readClientResponse(`http://example.com:${port}/health`);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ statusCode: 200, body: 'external' });
  });

  it('keeps option-object host aliases on fetch when the host is external', async () => {
    const port = 4306;
    createServer((_req, res) => {
      res.end('local');
    }).listen(port);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('external host'));

    const response = await readClientResponse({
      host: 'example.com',
      port,
      path: '/health',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ statusCode: 200, body: 'external host' });
  });

  it('fails unregistered loopback ports with Node-shaped ECONNREFUSED (no host egress)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no listener'));

    const err = await readClientResponse('http://localhost:4399/health').then(
      () => null,
      (e: Error & { code?: string; errno?: number; syscall?: string; port?: number }) => e,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(err).toMatchObject({
      code: 'ECONNREFUSED',
      errno: -111,
      syscall: 'connect',
      address: '127.0.0.1',
      port: 4399,
    });
    expect(err?.message).toBe('connect ECONNREFUSED 127.0.0.1:4399');
  });

  it('routes the whole 127.0.0.0/8 block through the registry', async () => {
    const port = 4308;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    createServer((req, res) => {
      res.end(`block ${req.url}`);
    }).listen(port);

    const response = await readClientResponse({ hostname: '127.1.2.3', port, path: '/block' });

    expect(response).toEqual({ statusCode: 200, body: 'block /block' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps non-http protocols on fetch even when the port is registered', async () => {
    const port = 4305;
    createServer((_req, res) => {
      res.end('local');
    }).listen(port);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('https egress'));

    const response = await readClientResponse({ protocol: 'https:', hostname: 'localhost', port });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ statusCode: 200, body: 'https egress' });
  });
});

describe('http.get — request sugar', () => {
  it('ends the request immediately and routes registered loopback ports', async () => {
    const port = 4304;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    createServer((req, res) => {
      res.end(`get ${req.url}`);
    }).listen(port);

    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = get(`http://localhost:${port}/via-get`, (res) => {
        const chunks: string[] = [];
        res.on('data', (chunk) => chunks.push(decoder.decode(chunk as Uint8Array)));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: chunks.join('') }));
        res.on('error', reject);
      });
      req.on('error', reject);
    });

    expect(response).toEqual({ statusCode: 200, body: 'get /via-get' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('node:http named exports', () => {
  it('re-exports STATUS_CODES through the compatibility barrels', () => {
    expect(HTTP_STATUS_CODES).toBe(STATUS_CODES);
    expect(ROOT_STATUS_CODES).toBe(STATUS_CODES);
  });
});

describe('http.request — Node ClientRequest call shapes', () => {
  it('supports the 3-arg request(url, options, cb) form with method/header overrides', async () => {
    const port = 4310;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    createServer((req, res) => {
      res.end(`${req.method} ${req.url} x=${req.headers['x-probe']}`);
    }).listen(port);

    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = request(
        `http://localhost:${port}/three-arg`,
        { method: 'POST', headers: { 'x-probe': 'yes' } },
        (res) => {
          const chunks: string[] = [];
          res.on('data', (chunk) => chunks.push(decoder.decode(chunk as Uint8Array)));
          res.on('end', () => resolve({ statusCode: res.statusCode, body: chunks.join('') }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(response).toEqual({ statusCode: 200, body: 'POST /three-arg x=yes' });
  });

  it('treats end(callback) as a finish callback, not a body chunk', async () => {
    const port = 4311;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    const bodies: string[] = [];
    createServer((req, res) => {
      const chunks: string[] = [];
      req.on('data', (chunk) => chunks.push(decoder.decode(chunk as Uint8Array)));
      req.on('end', () => {
        bodies.push(chunks.join(''));
        res.end('ok');
      });
    }).listen(port);

    let finishCalled = false;
    const response = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = request({ hostname: 'localhost', port, method: 'POST', path: '/' }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ statusCode: res.statusCode }));
      });
      req.on('error', reject);
      req.write('payload');
      req.end(() => {
        finishCalled = true;
      });
    });

    expect(response.statusCode).toBe(200);
    expect(finishCalled).toBe(true);
    expect(bodies).toEqual(['payload']);
  });

  it('write() returns true and a bare repeated end() does not double-dispatch', async () => {
    const port = 4312;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    let hits = 0;
    createServer((_req, res) => {
      hits += 1;
      res.end('once');
    }).listen(port);

    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = request({ hostname: 'localhost', port, method: 'POST', path: '/' }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      expect(req.write('chunk')).toBe(true);
      req.end();
      req.end();
    });
    // Drain microtasks so a buggy double-dispatch would have landed.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(statusCode).toBe(200);
    expect(hits).toBe(1);
  });

  it('emits ERR_STREAM_WRITE_AFTER_END for write()/end(chunk) after end', async () => {
    const port = 4313;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    createServer((_req, res) => {
      res.end('ok');
    }).listen(port);

    const errors: Array<Error & { code?: string }> = [];
    await new Promise<void>((resolve) => {
      const req = request({ hostname: 'localhost', port, method: 'POST', path: '/' }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      });
      req.on('error', (err) => errors.push(err as Error & { code?: string }));
      req.end();
      expect(req.write('late')).toBe(false);
      req.end('also late');
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(errors.map((e) => e.code)).toEqual([
      'ERR_STREAM_WRITE_AFTER_END',
      'ERR_STREAM_WRITE_AFTER_END',
    ]);
  });
});
