// Standalone Chromium repro for ADR-0548 (no rifty). Usage:
//   node docs/backlog/kernel/reference/nested-worker-notice-drop-repro/server.mjs 5741 &
//   node docs/backlog/kernel/reference/nested-worker-notice-drop-repro/run.mjs 5741 20 explicit-busy
//   node docs/backlog/kernel/reference/nested-worker-notice-drop-repro/run.mjs 5741 20 cascade-busy
// Chromium 148.0.7778.96 (2026-10-25): explicit-busy retained 20/20, cascade-busy 0/20.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const www = join(import.meta.dirname, 'www');
createServer((request, response) => {
  const name = request.url === '/' ? 'index.html' : (request.url ?? '').slice(1).split('?')[0];
  if (!['index.html', 'parent.js', 'child.js'].includes(name)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'content-type': name.endsWith('.html') ? 'text/html' : 'text/javascript',
  });
  response.end(readFileSync(join(www, name)));
}).listen(Number(process.argv[2]));
