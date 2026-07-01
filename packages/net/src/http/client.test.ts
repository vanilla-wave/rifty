import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
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

function listenOn(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise((resolve) => server.listen(port, () => resolve()));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const port of listPorts()) unregisterPort(port);
});

describe('http.request — local registered port loopback', () => {
  it('routes localhost URL requests through the in-process port registry', async () => {
    const port = 4301;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    await listenOn(
      createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`local ${req.url}`);
      }),
      port,
    );

    const response = await readClientResponse(`http://localhost:${port}/health?ready=1`);

    expect(response).toEqual({ statusCode: 200, body: 'local /health?ready=1' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('delivers response body chunks as Buffers so the canonical `b += chunk` idiom yields utf8 (Node parity)', async () => {
    const port = 4320;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('loopback must not hit fetch'));
    await listenOn(
      createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('héllo wörld'); // multi-byte utf8 — a Uint8Array would stringify to CSV bytes
      }),
      port,
    );

    const body = await new Promise<string>((resolve, reject) => {
      const req = get(`http://localhost:${port}/`, (res) => {
        let b = '';
        // The canonical Node http-client idiom: concatenate chunks with `+=`, no
        // explicit decode. It yields utf8 only because chunks are Buffers (whose
        // toString is utf8) — a raw Uint8Array stringifies to CSV byte values.
        res.on('data', (chunk) => {
          b += String(chunk);
        });
        res.on('end', () => resolve(b));
        res.on('error', reject);
      });
      req.on('error', reject);
    });

    expect(body).toBe('héllo wörld');
  });

  it('routes loopback option requests for 127.0.0.1 and 0.0.0.0', async () => {
    const port = 4302;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    await listenOn(
      createServer((req, res) => {
        res.end(`hit ${req.url}`);
      }),
      port,
    );

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
    await listenOn(
      createServer((req, res) => {
        res.end(`ipv6 ${req.url}`);
      }),
      port,
    );

    const response = await readClientResponse({ hostname: '::1', port, path: '/ipv6' });

    expect(response).toEqual({ statusCode: 200, body: 'ipv6 /ipv6' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('routes IPv4-mapped IPv6 loopback through the registry instead of fetch egress', async () => {
    const port = 4309;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    await listenOn(
      createServer((req, res) => {
        res.end(`mapped ${req.url}`);
      }),
      port,
    );

    const response = await readClientResponse({
      hostname: '::ffff:127.0.0.1',
      port,
      path: '/mapped',
    });

    expect(response).toEqual({ statusCode: 200, body: 'mapped /mapped' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps external hosts on fetch even when the port is registered', async () => {
    const port = 4303;
    await listenOn(
      createServer((_req, res) => {
        res.end('local');
      }),
      port,
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('external'));

    const response = await readClientResponse(`http://example.com:${port}/health`);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ statusCode: 200, body: 'external' });
  });

  it('keeps option-object host aliases on fetch when the host is external', async () => {
    const port = 4306;
    await listenOn(
      createServer((_req, res) => {
        res.end('local');
      }),
      port,
    );
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
    await listenOn(
      createServer((req, res) => {
        res.end(`block ${req.url}`);
      }),
      port,
    );

    const response = await readClientResponse({ hostname: '127.1.2.3', port, path: '/block' });

    expect(response).toEqual({ statusCode: 200, body: 'block /block' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps non-http protocols on fetch even when the port is registered', async () => {
    const port = 4305;
    await listenOn(
      createServer((_req, res) => {
        res.end('local');
      }),
      port,
    );
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
    await listenOn(
      createServer((req, res) => {
        res.end(`get ${req.url}`);
      }),
      port,
    );

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
    await listenOn(
      createServer((req, res) => {
        res.end(`${req.method} ${req.url} x=${req.headers['x-probe']}`);
      }),
      port,
    );

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
    await listenOn(
      createServer((req, res) => {
        const chunks: string[] = [];
        req.on('data', (chunk) => chunks.push(decoder.decode(chunk as Uint8Array)));
        req.on('end', () => {
          bodies.push(chunks.join(''));
          res.end('ok');
        });
      }),
      port,
    );

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
    await listenOn(
      createServer((_req, res) => {
        hits += 1;
        res.end('once');
      }),
      port,
    );

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
    await listenOn(
      createServer((_req, res) => {
        res.end('ok');
      }),
      port,
    );

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

  it('streams local request body writes before end and preserves chunk boundaries', async () => {
    const port = 4314;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    const observed: string[] = [];
    await listenOn(
      createServer((req, res) => {
        req.on('data', (chunk) => observed.push(decoder.decode(chunk as Uint8Array)));
        req.on('end', () => res.end(observed.join('|')));
      }),
      port,
    );

    const response = new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = request(
        { hostname: 'localhost', port, method: 'POST', path: '/stream' },
        (res) => {
          const chunks: string[] = [];
          res.on('data', (chunk) => chunks.push(decoder.decode(chunk as Uint8Array)));
          res.on('end', () => resolve({ statusCode: res.statusCode, body: chunks.join('') }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      expect(req.write('a')).toBe(true);
      void waitFor(() => observed.length === 1)
        .then(() => {
          req.write('b');
          req.end('c');
        })
        .catch(reject);
    });

    expect(await response).toEqual({ statusCode: 200, body: 'a|b|c' });
  });

  it('returns false while the live request body stream is full and emits drain after pull', async () => {
    const port = 4315;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not handle loopback'));
    await listenOn(
      createServer((req, res) => {
        req.on('data', () => {});
        req.on('end', () => res.end('ok'));
      }),
      port,
    );

    const drains: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = request(
        { hostname: 'localhost', port, method: 'POST', path: '/drain' },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.on('drain', () => drains.push('drain'));
      expect(req.write('a')).toBe(true);
      expect(req.write('b')).toBe(false);
      void waitFor(() => drains.length === 1)
        .then(() => req.end())
        .catch(reject);
    });

    expect(drains).toEqual(['drain']);
  });
});

describe('http.request — external WebSocket client upgrade', () => {
  it('opens a native WebSocket for non-local hosts and bridges RFC6455 data frames', async () => {
    FakeNativeWebSocket.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeNativeWebSocket);
    const key = 'AQIDBAUGBwgJCgsMDQ4PEA==';

    const upgraded = new Promise<WebSocketClientShape>((resolve, reject) => {
      const req = request({
        hostname: 'example.com',
        path: '/socket',
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': key,
          'sec-websocket-protocol': 'chat',
        },
      });
      req.on('upgrade', (res: unknown, socket: unknown) => {
        const response = res as {
          statusCode: number;
          headers: Record<string, string>;
        };
        expect(response.statusCode).toBe(101);
        expect(response.headers['sec-websocket-accept']).toBe(acceptKey(key));
        expect(response.headers['sec-websocket-protocol']).toBe('chat');
        resolve(socket as WebSocketClientShape);
      });
      req.on('error', reject);
      req.end();
    });

    await waitFor(() => FakeNativeWebSocket.instances.length === 1);
    const native = FakeNativeWebSocket.instances[0]!;
    expect(native.url).toBe('ws://example.com/socket');
    expect(native.protocols).toEqual(['chat']);
    native.open('chat');

    const socket = await upgraded;
    const inbound: string[] = [];
    socket.on('data', (chunk) => {
      inbound.push(parseServerFrame(Buffer.from(chunk)).payload.toString('utf8'));
    });
    expect(socket.write(encodeClientFrame(0x1, Buffer.from('hello')))).toBe(true);
    await waitFor(() => native.sent.length === 1);
    expect(native.sent[0]).toBe('hello');

    native.receive('world');
    await waitFor(() => inbound.includes('world'));
    socket.destroy();
  });
});

interface WebSocketClientShape {
  write(chunk: Uint8Array): boolean;
  destroy(): void;
  on(event: 'data', cb: (chunk: Uint8Array) => void): void;
}

class FakeNativeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeNativeWebSocket[] = [];

  readonly url: string;
  readonly protocols: readonly string[];
  readyState = FakeNativeWebSocket.CONNECTING;
  binaryType: BinaryType = 'blob';
  protocol = '';
  readonly sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];

  constructor(url: string, protocols?: string | readonly string[]) {
    super();
    this.url = url;
    this.protocols =
      typeof protocols === 'string' ? [protocols] : protocols === undefined ? [] : [...protocols];
    FakeNativeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === FakeNativeWebSocket.CLOSED) return;
    this.readyState = FakeNativeWebSocket.CLOSED;
    this.dispatchEvent(closeEvent(code ?? 1005, reason ?? ''));
  }

  open(protocol = ''): void {
    this.protocol = protocol;
    this.readyState = FakeNativeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  receive(data: string | ArrayBuffer): void {
    this.dispatchEvent(messageEvent(data));
  }
}

function messageEvent(data: string | ArrayBuffer): MessageEvent {
  if (typeof MessageEvent !== 'undefined') return new MessageEvent('message', { data });
  const event = new Event('message') as MessageEvent & { data: string | ArrayBuffer };
  Object.defineProperty(event, 'data', { value: data });
  return event;
}

function closeEvent(code: number, reason: string): CloseEvent {
  if (typeof CloseEvent !== 'undefined') return new CloseEvent('close', { code, reason });
  const event = new Event('close') as CloseEvent & { code: number; reason: string };
  Object.defineProperties(event, {
    code: { value: code },
    reason: { value: reason },
  });
  return event;
}

function acceptKey(key: string): string {
  return createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
}

function encodeClientFrame(opcode: number, payload: Buffer): Buffer {
  if (payload.length >= 126) throw new Error('test frame helper only supports short payloads');
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] = masked[i]! ^ mask[i % 4]!;
  return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, masked]);
}

function parseServerFrame(buf: Buffer): { opcode: number; payload: Buffer } {
  const opcode = buf[0]! & 0x0f;
  const len = buf[1]! & 0x7f;
  return { opcode, payload: Buffer.from(buf.subarray(2, 2 + len)) };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for condition');
}
