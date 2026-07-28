/**
 * Koa API template — a ctx/cookie/router consumer for the generic
 * node-server project runtime (ADR-0130).
 */
import { MONO_FONT_STACK } from '../glue/fonts.ts';
import type { NodeServerProjectSpec } from './project-spec.ts';

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Koa API</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="shell">
      <header class="topline">
        <span>~/workspace $ node src/main.js</span>
        <span id="visits">visits: ...</span>
      </header>
      <h1>Koa notes API</h1>
      <form id="form" autocomplete="off">
        <input id="topic" name="topic" placeholder="topic" value="cookie" />
        <input id="text" name="text" placeholder="note" maxlength="120" />
        <button type="submit">POST</button>
      </form>
      <ol id="notes" aria-live="polite"></ol>
      <footer>client fetch -> Koa middleware -> JSON response</footer>
    </main>
    <script type="module" src="client.js"></script>
  </body>
</html>
`;

const CLIENT_JS = `const list = document.getElementById('notes');
const form = document.getElementById('form');
const topic = document.getElementById('topic');
const text = document.getElementById('text');
const visits = document.getElementById('visits');

async function api(path, init) {
  const res = await fetch(path, init);
  const body = await res.text();
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status + (body ? ' (' + body.slice(0, 120) + ')' : ''));
  return JSON.parse(body);
}

function render(state) {
  visits.textContent = 'visits: ' + state.visits;
  list.replaceChildren(...state.notes.map((note) => {
    const li = document.createElement('li');
    const id = document.createElement('span');
    const topic = document.createElement('strong');
    const body = document.createElement('p');
    id.textContent = '#' + note.id;
    topic.textContent = note.topic;
    body.textContent = note.text;
    li.replaceChildren(id, topic, body);
    return li;
  }));
}

async function refresh() {
  render(await api('api/state'));
}

form.onsubmit = async (event) => {
  event.preventDefault();
  const payload = { topic: topic.value, text: text.value };
  text.value = '';
  try {
    await api('api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await refresh();
  } catch (err) {
    visits.textContent = String(err.message ?? err);
  }
};

refresh().catch((err) => {
  visits.textContent = String(err.message ?? err);
});
`;

const STYLES_CSS = `:root {
  --bg: #0f1312;
  --panel: #18201d;
  --line: #2d3a35;
  --ink: #edf4ef;
  --muted: #8da09a;
  --accent: #93e08f;
  --blue: #8ec8ff;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.5 ${MONO_FONT_STACK};
  padding: 36px 20px;
}

.shell {
  max-width: 650px;
  margin: 0 auto;
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 8px;
  overflow: hidden;
}

.topline {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font: 12px/16px ${MONO_FONT_STACK};
}

h1 {
  margin: 24px 24px 18px;
  color: var(--accent);
  font-size: 28px;
  line-height: 34px;
}

form {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  gap: 8px;
  margin: 0 24px 20px;
}

input, button {
  border: 1px solid var(--line);
  border-radius: 5px;
  background: #101715;
  color: var(--ink);
  font: inherit;
  padding: 9px 10px;
}

button {
  color: var(--accent);
  cursor: pointer;
}

ol {
  display: grid;
  gap: 8px;
  list-style: none;
  margin: 0 24px 24px;
  padding: 0;
}

li {
  display: grid;
  grid-template-columns: 44px 100px 1fr;
  gap: 10px;
  align-items: baseline;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px 12px;
}

li span { color: var(--muted); font-family: ${MONO_FONT_STACK}; }
li strong { color: var(--blue); }
li p { margin: 0; }

footer {
  border-top: 1px dashed var(--line);
  color: var(--muted);
  padding: 13px 24px 18px;
  font: 12px/16px ${MONO_FONT_STACK};
}
`;

export const KOA_API_SERVER_SOURCE = `// Koa API.
// - koa + @koa/router come from a real npm install
// - Koa consumes node:http request/response objects via app.callback()
import Koa from 'koa';
import Router from '@koa/router';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = new Koa();
const router = new Router();
const publicRoot = join(process.cwd(), 'public');

const notes = [
  { id: 1, topic: 'cookies', text: 'Koa ctx.cookies is available on every request' },
  { id: 2, topic: 'router', text: '@koa/router exposes params for /api/notes/:id' },
];
let nextId = 3;

app.use(async (ctx, next) => {
  console.log('[koa] ' + ctx.method + ' ' + ctx.path);
  await next();
});

function readPublic(name) {
  return readFileSync(join(publicRoot, name), 'utf8');
}

async function readJson(ctx) {
  const chunks = [];
  for await (const chunk of ctx.req) {
    chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
  }
  const raw = chunks.join('');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function visitsFor(ctx) {
  const previous = Number(ctx.cookies.get('koa-visits') ?? '0');
  const next = Number.isFinite(previous) ? previous + 1 : 1;
  ctx.cookies.set('koa-visits', String(next), {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  });
  return next;
}

function cookieHeaderFor(ctx) {
  const setCookie = ctx.response.get('set-cookie');
  return Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
}

router.get('/', (ctx) => {
  ctx.type = 'html';
  ctx.body = readPublic('index.html');
});

router.get('/client.js', (ctx) => {
  ctx.type = 'text/javascript; charset=utf-8';
  ctx.body = readPublic('client.js');
});

router.get('/styles.css', (ctx) => {
  ctx.type = 'text/css; charset=utf-8';
  ctx.body = readPublic('styles.css');
});

router.get('/api/state', (ctx) => {
  const visits = visitsFor(ctx);
  ctx.body = { visits, cookieHeader: cookieHeaderFor(ctx), notes };
});

router.get('/api/notes/:id', (ctx) => {
  const id = Number(ctx.params.id);
  const note = notes.find((item) => item.id === id);
  if (!note) {
    ctx.status = 404;
    ctx.body = { error: 'not found', id };
    return;
  }
  ctx.body = note;
});

router.post('/api/notes', async (ctx) => {
  let body = {};
  try {
    body = await readJson(ctx);
  } catch {
    ctx.status = 400;
    ctx.body = { error: 'invalid json' };
    return;
  }
  const topic = typeof body.topic === 'string' && body.topic.trim() ? body.topic.trim() : 'general';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    ctx.status = 400;
    ctx.body = { error: 'text required' };
    return;
  }
  const note = { id: nextId++, topic, text };
  notes.push(note);
  console.log('[koa] INSERT note #' + note.id);
  ctx.status = 201;
  ctx.body = note;
});

app.use(router.routes());
app.use(router.allowedMethods());

const port = Number(process.env.PORT ?? 3332);
createServer(app.callback()).listen(port, () => {
  console.log('koa api listening on port ' + port);
});
`;

export const KOA_API_README = `# Koa API

A small Koa server running as a node-server template.

- \`src/main.js\` — Koa middleware, \`@koa/router\`, cookies, and JSON body parsing.
- \`/\` — HTML returned through \`ctx.body\`.
- \`/api/state\` — cookie-backed visit count plus notes.
- \`/api/notes/:id\` — router params.
- \`/api/notes\` — JSON POST flow through Koa's Node request stream.

The data is in memory, so every nodemon restart — any save to \`src/main.js\` —
starts from the seeded notes again.
`;

export const KOA_API_TEMPLATE: NodeServerProjectSpec = {
  id: 'koa-api',
  displayName: 'Koa API',
  runtime: 'node-server',
  install: { koa: '^2.15.0', '@koa/router': '^12.0.0', nodemon: '3.1.14' },
  entry: { relativePath: '/src/main.js', content: KOA_API_SERVER_SOURCE },
  defaultPort: 3332,
  estimatedBootSeconds: 15,
  extraFiles: {
    '/public/index.html': INDEX_HTML,
    '/public/client.js': CLIENT_JS,
    '/public/styles.css': STYLES_CSS,
    '/README.md': KOA_API_README,
  },
};
