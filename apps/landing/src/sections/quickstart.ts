import { QUICKSTART_SNIPPET } from '../public-snippets';
import { renderSnippet } from '../snippet-dom';
import './quickstart.css';

const HEADERS: ReadonlyArray<readonly [name: string, value: string]> = [
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Embedder-Policy', 'credentialless'],
  ['Cross-Origin-Resource-Policy', 'cross-origin'],
];

function buildCode(): HTMLElement {
  const code = document.createElement('div');
  code.className = 'qs-code';
  const comment = document.createElement('div');
  comment.className = 'qs-code-comment';
  comment.textContent = '// 04 — quick start (boot.vite.ts)';
  code.append(comment, renderSnippet(QUICKSTART_SNIPPET, 'qs-code-line'));
  return code;
}

function buildAside(): HTMLElement {
  const aside = document.createElement('div');
  aside.className = 'qs-aside';

  const heading = document.createElement('h3');
  heading.className = 'qs-heading';
  heading.textContent = '! CROSS-ORIGIN ISOLATION + ESM WORKERS';

  const headers = document.createElement('div');
  headers.className = 'qs-headers';
  for (const [name, value] of HEADERS) {
    const row = document.createElement('div');
    row.append(document.createTextNode(`${name}: `));
    const val = document.createElement('span');
    val.className = 'qs-header-value';
    val.textContent = value;
    row.append(val);
    headers.append(row);
  }

  const body = document.createElement('p');
  body.className = 'qs-body';
  body.textContent =
    "The default runtime needs SharedArrayBuffer + Atomics for sync IPC, so the page must be cross-origin isolated with these headers (COEP require-corp also works). Header-less hosts such as GitHub Pages can’t serve that tier; Netlify (config checked in), Cloudflare Pages and Vercel can once they set them. The Worker must be a module build — in Vite set worker: { format: 'es' }.";

  const noCoi = document.createElement('p');
  noCoi.className = 'qs-body';
  noCoi.textContent =
    'Without isolation, createSandbox({ requireCrossOriginIsolation: false }) boots an explicit shared-memory-free tier: eval and files work, execSync throws a named NotImplementedError, child processes run same-realm. The no-COI install/build toolchain (ADR-0375) is on main, unreleased.';

  const install = document.createElement('div');
  install.className = 'qs-install';
  const dollar = document.createElement('span');
  dollar.className = 'qs-dollar';
  dollar.textContent = '$';
  install.append(dollar, document.createTextNode(' npm i @riftydev/sdk @riftydev/runtime-js'));

  const note = document.createElement('p');
  note.className = 'qs-note';
  note.textContent =
    'Declare runtime-js because host code imports its Worker entry. This example is eval/files only; preview also needs a separately bundled same-origin Service Worker.';

  const leaf = document.createElement('div');
  leaf.className = 'qs-leaf';
  leaf.append(document.createTextNode('leaf pkgs run anywhere, no headers:'));
  leaf.append(document.createElement('br'));
  const leafList = document.createElement('span');
  leafList.className = 'qs-leaf-list';
  leafList.textContent = 'io · vfs · npm-client · shell · shadow-registry';
  leaf.append(leafList);

  aside.append(heading, headers, body, noCoi, install, note, leaf);
  return aside;
}

/** 04 — production-buildable Vite host code and its deployment requirements. */
export function renderQuickStart(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'start';
  section.className = 'sec qs';
  const heading = document.createElement('h2');
  heading.className = 'visually-hidden';
  heading.textContent = 'Quick start';
  const grid = document.createElement('div');
  grid.className = 'qs-grid';
  grid.append(buildCode(), buildAside());
  section.append(heading, grid);
  return section;
}
