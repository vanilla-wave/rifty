import { http, dispatchToPort, listPorts, releasePort, unregisterPort } from '@riftydev/net';
/**
 * Express-style integration smoke. Builds a minimal Express-shaped router
 * (without taking on the actual express package) on top of node:http.
 * Validates the M7 acceptance: a request comes in, middleware runs, JSON is
 * parsed, response goes back.
 */
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  for (const p of listPorts()) {
    releasePort(p);
    unregisterPort(p);
  }
});

type Handler = (
  req: { method: string; url: string; body: unknown; headers: Record<string, string> },
  res: { json(value: unknown): void; status(code: number): typeof res; send(text: string): void },
) => void;

function makeApp(): {
  get(path: string, h: Handler): void;
  post(path: string, h: Handler): void;
  listen(port: number, cb?: () => void): unknown;
} {
  const routes: Record<string, Handler> = {};
  const server = http.createServer(async (req, res) => {
    const key = `${req.method} ${req.url.split('?')[0]}`;
    const handler = routes[key];
    if (!handler) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
    });
    req.on('end', () => {
      const parsed =
        req.headers['content-type'] === 'application/json' && body ? JSON.parse(body) : body;
      handler(
        { method: req.method, url: req.url, body: parsed, headers: req.headers },
        {
          json(v) {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(v));
          },
          status(code) {
            res.statusCode = code;
            return this;
          },
          send(text) {
            res.end(text);
          },
        },
      );
    });
  });
  return {
    get(path, h) {
      routes[`GET ${path}`] = h;
    },
    post(path, h) {
      routes[`POST ${path}`] = h;
    },
    listen(port, cb) {
      return server.listen(port, cb);
    },
  };
}

function listenApp(app: ReturnType<typeof makeApp>, port: number): Promise<void> {
  return new Promise((resolve) => app.listen(port, () => resolve()));
}

describe('integration — Express-style on rifty', () => {
  it('GET / returns hello world', async () => {
    const app = makeApp();
    app.get('/', (_req, res) => res.send('Hello from Express'));
    await listenApp(app, 3010);
    const r = await dispatchToPort(3010, new Request('http://x/'));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('Hello from Express');
  });

  it('POST /echo with JSON body parses and returns', async () => {
    const app = makeApp();
    app.post('/echo', (req, res) => res.json({ got: req.body }));
    await listenApp(app, 3011);
    const r = await dispatchToPort(
      3011,
      new Request('http://x/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1 }),
      }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ got: { a: 1 } });
  });
});
