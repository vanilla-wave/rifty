/**
 * Hono API template — a small middleware-style Node server consumer for the
 * generic node-server project runtime (ADR-0130).
 *
 * It intentionally avoids sqlite and heavy static middleware: the point is to
 * exercise Hono's `ctx`/middleware request flow over the Node http surface.
 */
import { MONO_FONT_STACK } from '../glue/fonts.ts';
import type { NodeServerProjectSpec } from './project-spec.ts';

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hono API</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="shell">
      <header class="topline">
        <span>~/workspace $ node src/main.js</span>
        <span id="status">connecting</span>
      </header>
      <h1>Hono message API</h1>
      <form id="form" autocomplete="off">
        <input id="author" name="author" placeholder="author" value="guest" />
        <input id="text" name="text" placeholder="message" maxlength="100" />
        <button type="submit">POST</button>
      </form>
      <ol id="messages" aria-live="polite"></ol>
      <footer>client fetch -> Hono route -> JSON response</footer>
    </main>
    <script type="module" src="client.js"></script>
  </body>
</html>
`;

const CLIENT_JS = `const list = document.getElementById('messages');
const form = document.getElementById('form');
const author = document.getElementById('author');
const text = document.getElementById('text');
const status = document.getElementById('status');

async function api(path, init) {
  const res = await fetch(path, init);
  const body = await res.text();
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status + (body ? ' (' + body.slice(0, 120) + ')' : ''));
  return JSON.parse(body);
}

function render(messages) {
  status.textContent = 'GET /api/messages -> ' + messages.length;
  list.replaceChildren(...messages.map((message) => {
    const li = document.createElement('li');
    const id = document.createElement('span');
    const byline = document.createElement('strong');
    const body = document.createElement('p');
    id.textContent = '#' + message.id;
    byline.textContent = message.author;
    body.textContent = message.text;
    li.replaceChildren(id, byline, body);
    return li;
  }));
}

async function refresh() {
  render(await api('api/messages'));
}

form.onsubmit = async (event) => {
  event.preventDefault();
  const payload = { author: author.value, text: text.value };
  text.value = '';
  try {
    await api('api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await refresh();
  } catch (err) {
    status.textContent = String(err.message ?? err);
  }
};

refresh().catch((err) => {
  status.textContent = String(err.message ?? err);
});
`;

const STYLES_CSS = `:root {
  --bg: #101218;
  --panel: #171b23;
  --line: #2a3140;
  --ink: #e6edf3;
  --muted: #8491a3;
  --accent: #f6c768;
  --blue: #80c7ff;
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
  max-width: 620px;
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
  grid-template-columns: 110px 1fr auto;
  gap: 8px;
  margin: 0 24px 20px;
}

input, button {
  border: 1px solid var(--line);
  border-radius: 5px;
  background: #0f131a;
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
  grid-template-columns: 44px 90px 1fr;
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

export const HONO_API_SERVER_SOURCE = `// Hono API.
// - hono + @hono/node-server come from a real npm install
// - requests run through Hono middleware and route handlers
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = new Hono();
const publicRoot = join(process.cwd(), 'public');

const messages = [
  { id: 1, author: 'Ada', text: 'Hono middleware handled this request' },
  { id: 2, author: 'Lin', text: 'POST a message to exercise JSON parsing' },
];
let nextId = 3;

app.use('*', async (ctx, next) => {
  console.log('[hono] ' + ctx.req.method + ' ' + new URL(ctx.req.url).pathname);
  await next();
});

function readPublic(name) {
  return readFileSync(join(publicRoot, name), 'utf8');
}

app.get('/', (ctx) => ctx.html(readPublic('index.html')));

app.get('/client.js', (ctx) => {
  return new Response(readPublic('client.js'), {
    headers: { 'content-type': 'text/javascript; charset=utf-8' },
  });
});

app.get('/styles.css', (ctx) => {
  return new Response(readPublic('styles.css'), {
    headers: { 'content-type': 'text/css; charset=utf-8' },
  });
});

app.get('/api/messages', (ctx) => ctx.json(messages));

app.post('/api/messages', async (ctx) => {
  const body = await ctx.req.json().catch(() => ({}));
  const author = typeof body.author === 'string' && body.author.trim() ? body.author.trim() : 'guest';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return ctx.json({ error: 'text required' }, 400);
  const message = { id: nextId++, author, text };
  messages.push(message);
  console.log('[hono] INSERT message #' + message.id);
  return ctx.json(message, 201);
});

app.notFound((ctx) => ctx.json({ error: 'not found', path: new URL(ctx.req.url).pathname }, 404));

const port = Number(process.env.PORT ?? 3321);
serve({ fetch: app.fetch, port }, () => {
  console.log('hono api listening on port ' + port);
});
`;

export const HONO_API_README = `# Hono API

A small Hono server running as a node-server template.

- \`src/main.js\` — Hono middleware, routes, and \`@hono/node-server\`.
- \`/\` — HTML returned by \`ctx.html()\`.
- \`/api/messages\` — JSON GET/POST flow through Hono's \`ctx\` API.

The data is in memory. Real nodemon restarts the app Worker after source edits.
`;

export const HONO_API_TEMPLATE: NodeServerProjectSpec = {
  id: 'hono-api',
  displayName: 'Hono API',
  runtime: 'node-server',
  install: { hono: '^4.6.0', '@hono/node-server': '^1.13.0' },
  devDependencies: { nodemon: '3.1.14' },
  devRunner: 'nodemon',
  entry: { relativePath: '/src/main.js', content: HONO_API_SERVER_SOURCE },
  defaultPort: 3321,
  estimatedBootSeconds: 15,
  extraFiles: {
    '/public/index.html': INDEX_HTML,
    '/public/client.js': CLIENT_JS,
    '/public/styles.css': STYLES_CSS,
    '/README.md': HONO_API_README,
  },
};
