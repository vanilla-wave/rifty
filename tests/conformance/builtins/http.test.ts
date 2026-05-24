import { http, dispatchToPort, listPorts, unregisterPort } from '@rifty/net';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  for (const p of listPorts()) unregisterPort(p);
});

describe('node:http server via port registry', () => {
  it('responds to a basic GET', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`hello ${req.url}`);
    });
    server.listen(3000);
    expect(listPorts()).toContain(3000);
    const response = await dispatchToPort(3000, new Request('http://x/y'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello /y');
    expect(response.headers.get('content-type')).toBe('text/plain');
  });

  it('handles POST with body', async () => {
    const server = http.createServer(async (req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += typeof c === 'string' ? c : new TextDecoder().decode(c as Uint8Array);
      });
      req.on('end', () => {
        res.statusCode = 201;
        res.end(`got: ${body}`);
      });
    });
    server.listen(3001);
    const response = await dispatchToPort(
      3001,
      new Request('http://x/echo', { method: 'POST', body: 'hello!' }),
    );
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('got: hello!');
  });

  it('close() unregisters the port', async () => {
    const server = http.createServer((_req, res) => res.end('x'));
    server.listen(3002);
    expect(listPorts()).toContain(3002);
    await new Promise<void>((r) => server.close(() => r()));
    expect(listPorts()).not.toContain(3002);
  });

  it('returns 502 when port not listening', async () => {
    const response = await dispatchToPort(9999, new Request('http://x/'));
    expect(response.status).toBe(502);
  });
});
