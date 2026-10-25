import { createServer } from 'node:http';

const port = Number(process.env.RIFTY_NO_COI_RESOURCE_PORT ?? 5413);
const observations = new Map();
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#0a0"/></svg>';

function sendImage(response) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'image/svg+xml');
  response.setHeader('Cache-Control', 'no-store');
  response.end(image);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  const probe = url.searchParams.get('probe');
  const phase = url.searchParams.get('phase');

  if (url.pathname === '/favicon.svg') {
    sendImage(response);
    return;
  }

  if (url.pathname === '/__no-coi-host-resource-seed' && probe) {
    response.statusCode = 204;
    response.setHeader(
      'Set-Cookie',
      `rifty_no_coi_sentinel=${encodeURIComponent(probe)}; Path=/; SameSite=Lax`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.end();
    return;
  }

  if (url.pathname === '/__no-coi-host-resource.svg' && probe && phase) {
    observations.set(`${probe}:${phase}`, {
      method: request.method ?? 'GET',
      url: request.url ?? '',
      secFetchMode: request.headers['sec-fetch-mode'] ?? null,
      secFetchSite: request.headers['sec-fetch-site'] ?? null,
      cookie: request.headers.cookie ?? null,
    });
    sendImage(response);
    return;
  }

  if (url.pathname === '/__no-coi-host-resource-receipt' && probe && phase) {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(observations.get(`${probe}:${phase}`) ?? null));
    return;
  }

  response.statusCode = 404;
  response.end('not found');
});

server.listen(port, '127.0.0.1');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
