import { MONO_FONT_STACK } from '../glue/fonts.ts';
/**
 * The Express + SQLite template — a full client-server app as the second
 * registered {@link ProjectSpec} (ADR-0078's "data change, not a worker fork").
 *
 * What it demonstrates end-to-end: real `express@4` installed from npm inside
 * the worker, an HTTP server on the virtual network (SW preview routing,
 * including POST/PATCH/DELETE bodies), static files served from the VFS, and
 * `node:sqlite` (`DatabaseSync` over the sql.js WASM engine, ADR-0065) as the
 * database.
 *
 * Sources double as preset content: the entry is an ordinary initial editor tab
 * (the root-relative `<root>/src/main.js`, ADR-0165 §4), `extraFiles` are both
 * worker-seeded (so the first preview request already sees them) and shown in
 * the page-side explorer through the preset's `files`.
 */
import type { NodeServerProjectSpec } from './project-spec.ts';

export const EXPRESS_SQLITE_SERVER_SOURCE = `// Express + SQLite, running in your browser.
// - express comes from a real npm install (check node_modules in the explorer)
// - node:sqlite is rifty's DatabaseSync over SQLite compiled to WebAssembly
// - every request below travels browser -> Service Worker -> this Worker
import express from 'express';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(\`
  CREATE TABLE todos (
    id    INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    done  INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO todos (title, done) VALUES
    ('Boot Express inside a Web Worker', 1),
    ('Route requests through the Service Worker', 1),
    ('Persist rows in SQLite-as-WASM', 0);
\`);
console.log('[db] CREATE TABLE todos + 3 seed rows');

const app = express();
app.use(express.json());

// Log every incoming request (API and static alike) before routing — the
// worker's stdout lands in the playground terminal.
app.use((req, _res, next) => {
  console.log('[http] ' + req.method + ' ' + req.url);
  next();
});

app.use(express.static('public'));

app.get('/api/todos', (_req, res) => {
  res.json(db.prepare('SELECT id, title, done FROM todos ORDER BY id').all());
});

app.post('/api/todos', (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title) return res.status(400).json({ error: 'title required' });
  const { lastInsertRowid } = db.prepare('INSERT INTO todos (title) VALUES (?)').run(title);
  console.log('[db] INSERT todos #' + lastInsertRowid + ' "' + title + '"');
  res.status(201).json(db.prepare('SELECT id, title, done FROM todos WHERE id = ?').get(lastInsertRowid));
});

app.patch('/api/todos/:id', (req, res) => {
  const done = req.body?.done ? 1 : 0;
  const { changes } = db.prepare('UPDATE todos SET done = ? WHERE id = ?').run(done, Number(req.params.id));
  if (changes === 0) return res.status(404).json({ error: 'no such todo' });
  console.log('[db] UPDATE todos #' + req.params.id + ' done=' + done);
  res.json(db.prepare('SELECT id, title, done FROM todos WHERE id = ?').get(Number(req.params.id)));
});

app.delete('/api/todos/:id', (req, res) => {
  const { changes } = db.prepare('DELETE FROM todos WHERE id = ?').run(Number(req.params.id));
  if (changes === 0) return res.status(404).json({ error: 'no such todo' });
  console.log('[db] DELETE todos #' + req.params.id);
  res.status(204).end();
});

const port = Number(process.env.PORT ?? 3210);
app.listen(port, () => {
  console.log('express + node:sqlite listening on port ' + port);
});
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>rifty · express + sqlite</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="term">
      <header class="term__bar">
        <span class="term__path">~/workspace $ node src/main.js</span>
        <span class="term__status" id="status" data-state="boot">connecting…</span>
      </header>
      <h1 class="term__title">todos<span class="cursor">▌</span></h1>
      <p class="term__sub">
        every row below is a SQLite record in WebAssembly memory, served by a real
        Express app inside a Web Worker
      </p>
      <form id="add-form" class="add" autocomplete="off">
        <span class="add__prompt" aria-hidden="true">&gt;</span>
        <input id="add-input" class="add__input" name="title" placeholder="INSERT INTO todos…" maxlength="120" />
        <button class="add__btn" type="submit">add</button>
      </form>
      <ul id="list" class="rows" aria-live="polite"></ul>
      <footer class="trace">
        <span>iframe</span><span class="trace__arrow">→</span>
        <span>service worker</span><span class="trace__arrow">→</span>
        <span>web worker</span><span class="trace__arrow">→</span>
        <span>express</span><span class="trace__arrow">→</span>
        <span class="trace__db">sqlite.wasm</span>
      </footer>
    </main>
    <script type="module" src="client.js"></script>
  </body>
</html>
`;

const CLIENT_JS = `// Plain browser module. All fetch() paths are RELATIVE so they stay under the
// routed /preview/<port>/ base; the Service Worker carries them to the server.
const list = document.getElementById('list');
const form = document.getElementById('add-form');
const input = document.getElementById('add-input');
const status = document.getElementById('status');

async function api(path, init) {
  const res = await fetch(path, init);
  if (!res.ok && res.status !== 204) {
    const detail = (await res.text()).slice(0, 120);
    throw new Error(path + ' -> HTTP ' + res.status + (detail ? ' (' + detail + ')' : ''));
  }
  return res.status === 204 ? null : res.json();
}

function render(todos) {
  status.textContent = 'SELECT * FROM todos — ' + todos.length + ' row' + (todos.length === 1 ? '' : 's');
  status.dataset.state = 'ok';
  list.replaceChildren(
    ...todos.map((todo) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.dataset.done = todo.done ? '1' : '0';

      const toggle = document.createElement('button');
      toggle.className = 'row__toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-label', todo.done ? 'mark not done' : 'mark done');
      toggle.textContent = todo.done ? '[x]' : '[ ]';
      toggle.onclick = () => mutate('api/todos/' + todo.id, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ done: !todo.done }),
      });

      const id = document.createElement('span');
      id.className = 'row__id';
      id.textContent = '#' + todo.id;

      const title = document.createElement('span');
      title.className = 'row__title';
      title.textContent = todo.title;

      const del = document.createElement('button');
      del.className = 'row__delete';
      del.type = 'button';
      del.setAttribute('aria-label', 'delete');
      del.textContent = 'DROP';
      del.onclick = () => mutate('api/todos/' + todo.id, { method: 'DELETE' });

      li.append(toggle, id, title, del);
      return li;
    }),
  );
}

async function refresh() {
  render(await api('api/todos'));
}

async function mutate(path, init) {
  try {
    await api(path, init);
    await refresh();
  } catch (err) {
    status.textContent = String(err.message ?? err);
    status.dataset.state = 'err';
  }
}

form.onsubmit = (event) => {
  event.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  input.value = '';
  void mutate('api/todos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
};

refresh().catch((err) => {
  status.textContent = String(err.message ?? err);
  status.dataset.state = 'err';
});
`;

const STYLES_CSS = `:root {
  --bg: #0b0e14;
  --panel: #10141d;
  --line: #1d2433;
  --ink: #d7e0ea;
  --dim: #5d6b80;
  --teal: #84d8c8;
  --lime: #c6f26b;
  --red: #ff6b6b;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: start center;
  padding: 48px 20px;
  background:
    radial-gradient(1200px 500px at 50% -10%, rgba(132, 216, 200, 0.07), transparent 60%),
    repeating-linear-gradient(0deg, transparent 0 2px, rgba(255, 255, 255, 0.012) 2px 4px),
    var(--bg);
  color: var(--ink);
  font: 14px/1.55 ${MONO_FONT_STACK};
}

.term {
  width: min(560px, 100%);
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  padding: 0 26px 22px;
  overflow: hidden;
}

.term__bar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0 -26px 26px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
  font-size: 12px;
  color: var(--dim);
}

.term__status[data-state='ok'] { color: var(--teal); }
.term__status[data-state='err'] { color: var(--red); }

.term__title {
  margin: 0;
  font-size: 34px;
  letter-spacing: 0.04em;
  color: var(--lime);
}

.cursor {
  animation: blink 1.1s steps(1) infinite;
  color: var(--teal);
}

@keyframes blink { 50% { opacity: 0; } }

.term__sub {
  margin: 6px 0 24px;
  max-width: 44ch;
  color: var(--dim);
}

.add {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 4px 4px 12px;
  background: rgba(0, 0, 0, 0.25);
}

.add:focus-within { border-color: var(--teal); }

.add__prompt { color: var(--teal); }

.add__input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  padding: 8px 0;
}

.add__input::placeholder { color: var(--dim); }

.add__btn {
  border: 1px solid var(--teal);
  border-radius: 4px;
  background: transparent;
  color: var(--teal);
  font: inherit;
  padding: 6px 14px;
  cursor: pointer;
}

.add__btn:hover { background: rgba(132, 216, 200, 0.12); }

.rows {
  list-style: none;
  margin: 22px 0 26px;
  padding: 0;
  display: grid;
  gap: 6px;
}

.row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  animation: land 0.18s ease-out;
}

@keyframes land {
  from { opacity: 0; transform: translateY(4px); }
}

.row__toggle, .row__delete {
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  padding: 0;
}

.row__toggle { color: var(--teal); }

.row__id { color: var(--dim); font-size: 12px; min-width: 3ch; }

.row__title { flex: 1; }

.row[data-done='1'] .row__title {
  color: var(--dim);
  text-decoration: line-through;
  text-decoration-color: var(--teal);
}

.row__delete { color: var(--dim); font-size: 11px; letter-spacing: 0.08em; }

.row__delete:hover { color: var(--red); }

.trace {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--dim);
  border-top: 1px dashed var(--line);
  padding-top: 14px;
}

.trace__arrow { color: var(--teal); }

.trace__db { color: var(--lime); }
`;

export const EXPRESS_SQLITE_README = `# Express + SQLite (in your browser)

A real client-server app: \`express@4\` installed from npm inside a Web Worker,
serving a static client from the VFS and a JSON API backed by \`node:sqlite\` —
rifty's DatabaseSync over SQLite compiled to WebAssembly.

- \`src/main.js\` — the server. Edit it, then re-run the dev script from the
  terminal to restart.
- \`public/\` — the client the server serves with \`express.static\`.
- The preview iframe talks to the server through the Service Worker: every
  fetch crosses iframe -> SW -> Worker -> Express -> sqlite.wasm and back.

The database lives in WASM memory: restarting the server resets the rows
(OPFS-backed persistence is a tracked follow-up).
`;

export const EXPRESS_SQLITE_TEMPLATE: NodeServerProjectSpec = {
  id: 'express-sqlite',
  displayName: 'Express + SQLite',
  runtime: 'node-server',
  install: { express: '^4.19.0' },
  entry: { relativePath: '/src/main.js', content: EXPRESS_SQLITE_SERVER_SOURCE },
  defaultPort: 3210,
  estimatedBootSeconds: 15,
  sqlite: true,
  extraFiles: {
    '/public/index.html': INDEX_HTML,
    '/public/client.js': CLIENT_JS,
    '/public/styles.css': STYLES_CSS,
    '/README.md': EXPRESS_SQLITE_README,
  },
};
