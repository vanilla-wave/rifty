import type { IconName } from './components/icons.tsx';
import { MONO_FONT_STACK } from './glue/fonts.ts';
import { CLI_REPORT_TEMPLATE } from './templates/cli-report.ts';
import {
  EXPRESS_SQLITE_SERVER_SOURCE,
  EXPRESS_SQLITE_TEMPLATE,
} from './templates/express-sqlite.ts';
import { HONO_API_TEMPLATE } from './templates/hono-api.ts';
import { KOA_API_TEMPLATE } from './templates/koa-api.ts';
import { MARKDOWN_SSG_TEMPLATE } from './templates/markdown-ssg.ts';
import { terminalDevLine } from './templates/project-spec.ts';
import { REACT_VITE_TEMPLATE } from './templates/react-vite/index.ts';
import { defaultProjectSpec, resolveProjectSpec } from './templates/registry.ts';
import { SOCKET_LAB_SERVER_SOURCE, SOCKET_LAB_TEMPLATE } from './templates/socket-lab.ts';
import { TYPESCRIPT_TEMPLATE } from './templates/typescript.ts';

export type PresetMode = 'dev' | 'real-vite';

/**
 * How the preset's dependencies arrive (ADR-0135):
 * - `'instant'` — the project shows up ready; the worker installs silently on
 *   the first-ever boot and skips via the install stamp afterwards.
 * - `'from-scratch'` — the terminal visibly runs `npm install` (per-package
 *   lines) before the dev line; the worker then reuses the stamped tree.
 */
export type PresetSetup = 'instant' | 'from-scratch';

export interface PresetFile {
  /** Workspace-relative path seeded for this preset. */
  readonly path: string;
  readonly content: string;
}

export interface Preset {
  /** Stable id used for the active-selection highlight. */
  readonly id: string;
  /** Short gallery label. */
  readonly label: string;
  /** Grouping header in the gallery. */
  readonly category: string;
  /** Semantic icon key rendered as inline SVG; add new keys in {@link ./components/icons.tsx}. */
  readonly icon: IconName;
  /** Mode the preset runs in; selecting it transitions the live-preview UI. */
  readonly mode: PresetMode;
  /** Sandbox setup kind — drives the terminal boot sequence (ADR-0135). */
  readonly setup: PresetSetup;
  /**
   * For `real-vite` presets: which registered template (ADR-0078) to run,
   * resolved via {@link ./templates/registry.ts}. Omitted means the default template.
   */
  readonly templateId?: string;
  /** One-line description shown under the label. */
  readonly blurb: string;
  /** Mono badge in the template switcher (e.g. `JS` in template yellow). */
  readonly glyph?: { readonly text: string; readonly color: string };
  /** Optional pill (e.g. "live", "~20s") shown next to the label. */
  readonly tag?: { readonly text: string; readonly tone: 'live' | 'slow' };
  /** Project files written under the active root for this preset. */
  readonly files: readonly PresetFile[];
  /** Workspace-relative files opened as editor tabs when this preset loads; first is active. */
  readonly openFiles?: readonly string[];
}

const PROJECT_FILES_SOURCE = `import project from './project.json';
import { describeProject, formatFileList } from './project-summary.js';
import './workspace.css';

export function render() {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app root');

  const fileItems = formatFileList(project.files)
    .map((file) => '<li><code>' + file.path + '</code><span>' + file.reason + '</span></li>')
    .join('');

  app.innerHTML = '<main class="workspace-shell">'
    + '<p class="eyebrow">Project files</p>'
    + '<h1>' + project.name + '</h1>'
    + '<p class="lede">' + describeProject(project) + '</p>'
    + '<section><h2>Open these in Explorer</h2>'
    + '<ul class="file-list">' + fileItems + '</ul></section>'
    + '</main>';
}

render();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.accept(['./project-summary.js', './project.json'], () => {
    render();
  });
}
`;

const PROJECT_SUMMARY_SOURCE = `export function describeProject(project) {
  return project.name + ' is rendered from ' + project.files.length + ' workspace files. The preview is useful here because Vite has to resolve imports from the in-browser filesystem.';
}

export function formatFileList(files) {
  return files.map((file) => ({
    path: file.path,
    reason: file.reason,
  }));
}
`;

const PROJECT_JSON_SOURCE = `{
  "name": "Workspace anatomy",
  "files": [
    {
      "path": "src/main.js",
      "reason": "entry module served by Vite"
    },
    {
      "path": "src/project-summary.js",
      "reason": "plain JS module imported by the entry"
    },
    {
      "path": "src/project.json",
      "reason": "structured data imported through Vite"
    },
    {
      "path": "src/workspace.css",
      "reason": "CSS imported as part of the module graph"
    }
  ]
}
`;

const WORKSPACE_CSS_SOURCE = `/* Soft Panels preview typography (matches the playground design tokens). */
body {
  margin: 0;
  background: #101218;
  color: rgba(255, 255, 255, 0.85);
  font-family: ${MONO_FONT_STACK};
}

.workspace-shell {
  max-width: 720px;
  padding: 28px;
}

.eyebrow {
  color: #c7f05a;
  font: 600 10px/12px ${MONO_FONT_STACK};
  letter-spacing: 0.2em;
  margin: 0 0 10px;
  text-transform: uppercase;
}

h1 {
  font: 600 26px/32px ${MONO_FONT_STACK};
  letter-spacing: 0;
  color: rgba(255, 255, 255, 0.92);
  margin: 0 0 8px;
}

h2 {
  font: 600 15px/20px ${MONO_FONT_STACK};
  color: rgba(255, 255, 255, 0.85);
  margin: 24px 0 0;
}

.lede {
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  line-height: 19px;
  max-width: 520px;
  margin: 0;
}

.file-list {
  display: grid;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 14px 0 0;
}

.file-list li {
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  display: grid;
  gap: 2px;
  padding: 11px 13px;
}

.file-list span {
  color: rgba(255, 255, 255, 0.5);
  font-size: 11.5px;
  line-height: 16px;
}

code {
  color: #dff7ad;
  font: 400 12px/16px ${MONO_FONT_STACK};
}
`;

const NODE_WORKER_SOURCE = `import './workspace.css';

const notesUrl = new URL('src/runtime-notes.js', window.location.href).href;
let renderVersion = 0;

function freshUrl(url) {
  if (!import.meta.hot) return url;
  const separator = url.includes('?') ? '&' : '?';
  return url + separator + 't=' + Date.now() + '-' + renderVersion;
}

export async function render() {
  renderVersion += 1;
  const { runtimeNotes, renderRuntimeNotes } = await import(/* @vite-ignore */ freshUrl(notesUrl));
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app root');

  app.innerHTML = '<main class="workspace-shell">'
    + '<p class="eyebrow">Node-shaped project</p>'
    + '<h1>Worker runtime map</h1>'
    + '<p class="lede">This example points at the Node-style pieces Rifty uses while the preview stays an ordinary browser render.</p>'
    + '<section><h2>What to inspect</h2>'
    + '<ul class="file-list">' + renderRuntimeNotes(runtimeNotes) + '</ul></section>'
    + '</main>';
}

await render();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.accept('./runtime-notes.js', () => {
    void render();
  });
}
`;

const RUNTIME_NOTES_SOURCE = `export const runtimeNotes = [
  {
    path: 'package.json',
    reason: 'npm metadata the terminal command reads before starting Vite',
  },
  {
    path: 'scripts/inspect-workspace.mjs',
    reason: 'a Node-style script file showing fs/path imports as project code',
  },
  {
    path: 'src/runtime-notes.js',
    reason: 'a module imported by src/main.js and resolved through Vite',
  },
];

export function renderRuntimeNotes(notes) {
  return notes
    .map((note) => '<li><code>' + note.path + '</code><span>' + note.reason + '</span></li>')
    .join('');
}
`;

const INSPECT_WORKSPACE_SOURCE = `import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const files = readdirSync(root);
const pkg = JSON.parse(readFileSync(join(root.pathname, 'package.json'), 'utf8'));

console.log({ name: pkg.name, files });
`;

const PROJECT_README = `# Workspace anatomy

This preset is useful from the Explorer, not only from the rendered page.

Open src/main.js, src/project-summary.js, src/project.json, and src/workspace.css to see the module graph Vite resolves from Rifty's in-browser filesystem.
`;

const NODE_README = `# Node-shaped project

This preset keeps the preview honest: the browser renders the result, while the interesting project files show the Node-style shape around it.

The terminal prestarts vite. The script under scripts/ is a project file to inspect; the playground shell exposes vite for the dev server and npm install for package experiments.
`;

const REAL_VITE_SOURCE = `// Real npm project mode builds the project from scratch: the terminal runs a
// visible npm install (watch the packages stream in), then boots the actual
// dev server and previews it live. The default template is Vite (vite@^7);
// later runs reuse the tarball cache and the stamped node_modules.
//
// This is your app entry, served by the dev server at /src/main.js.

export function render() {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app root');

  app.innerHTML =
    '<h1>A real npm project, in your browser.</h1>' +
    '<p>This page is served by an actual dev server - its packages installed from' +
    ' npm, running in a Worker, previewed through the rifty SW bridge.</p>';

  document.body.style.margin = '0';
  document.body.style.padding = '3rem';
  document.body.style.background = '#101218';
  document.body.style.color = '#e6e6e6';
  document.body.style.fontFamily = ${JSON.stringify(MONO_FONT_STACK)};
}

render();

if (import.meta.hot) {
  import.meta.hot.accept();
}
`;

const PROJECT_FILES_PRESET: Preset = {
  id: 'project-files',
  label: 'Project files',
  category: 'Files + modules',
  icon: 'zap',
  mode: 'real-vite',
  setup: 'instant',
  templateId: 'vite',
  blurb: 'A small module graph with JS, JSON, CSS, and a README to inspect.',
  glyph: { text: 'JS', color: '#E8D44D' },
  tag: { text: 'instant', tone: 'live' },
  openFiles: ['src/main.js', 'src/project-summary.js', 'src/project.json', 'src/workspace.css'],
  files: [
    { path: 'src/main.js', content: PROJECT_FILES_SOURCE },
    { path: 'src/project-summary.js', content: PROJECT_SUMMARY_SOURCE },
    { path: 'src/project.json', content: PROJECT_JSON_SOURCE },
    { path: 'src/workspace.css', content: WORKSPACE_CSS_SOURCE },
    { path: 'README.md', content: PROJECT_README },
  ],
};

const NODE_WORKER_PRESET: Preset = {
  id: 'node-worker',
  label: 'Node worker map',
  category: 'Files + modules',
  icon: 'play',
  mode: 'real-vite',
  setup: 'instant',
  templateId: 'vite',
  blurb: 'Shows where Node-style project files fit around the worker dev server.',
  glyph: { text: 'N', color: '#9BD060' },
  tag: { text: 'instant', tone: 'live' },
  openFiles: ['src/main.js', 'src/runtime-notes.js', 'scripts/inspect-workspace.mjs'],
  files: [
    { path: 'src/main.js', content: NODE_WORKER_SOURCE },
    { path: 'src/runtime-notes.js', content: RUNTIME_NOTES_SOURCE },
    { path: 'src/workspace.css', content: WORKSPACE_CSS_SOURCE },
    { path: 'scripts/inspect-workspace.mjs', content: INSPECT_WORKSPACE_SOURCE },
    { path: 'README.md', content: NODE_README },
  ],
};

const TYPESCRIPT_LS_PRESET: Preset = {
  id: 'typescript-ls',
  label: 'TypeScript sandbox',
  category: 'Files + modules',
  icon: 'code',
  mode: 'real-vite',
  setup: 'instant',
  templateId: TYPESCRIPT_TEMPLATE.id,
  blurb: 'Strict TS project seeded with imports, .d.ts resolution, diagnostics, and refactors.',
  glyph: { text: 'TS', color: '#7FB5FF' },
  tag: { text: 'instant', tone: 'live' },
  openFiles: ['src/main.ts', 'tsconfig.json', 'src/model.ts', 'src/math.ts'],
  files: [
    {
      path: TYPESCRIPT_TEMPLATE.entry.relativePath.replace(/^\/+/, ''),
      content: TYPESCRIPT_TEMPLATE.entry.content,
    },
    ...Object.entries(TYPESCRIPT_TEMPLATE.extraFiles).map(([path, content]) => ({
      path: path.replace(/^\/+/, ''),
      content,
    })),
  ],
};

/**
 * The "Real npm project" tile: an ordinary React 19 + Router + TypeScript SPA
 * built from scratch — visible `npm install`, then the real `vite` CLI with the
 * template's own `vite.config.ts`. Fast Refresh comes from
 * `@vitejs/plugin-react`, not from hand-written `import.meta.hot.accept`
 * boundaries. The preset id is unchanged: the launch deep-link, the landing
 * card, and `tools/perf/bench.mjs` all address this tile by `real-vite`.
 */
const REAL_VITE_PRESET: Preset = {
  id: 'real-vite',
  label: 'Real npm project',
  category: 'Live preview',
  icon: 'rocket',
  mode: 'real-vite',
  setup: 'from-scratch',
  templateId: REACT_VITE_TEMPLATE.id,
  blurb: 'Installs React 19 + Router from npm, then boots the Vite dev server with Fast Refresh.',
  glyph: { text: 'RE', color: '#61DAFB' },
  tag: { text: 'npm install', tone: 'slow' },
  openFiles: [
    'src/App.tsx',
    'src/components/StatusBadge.tsx',
    'src/pages/IssueList.tsx',
    'src/data/issues.ts',
    'README.md',
  ],
  files: [
    {
      path: REACT_VITE_TEMPLATE.entry.relativePath.replace(/^\/+/, ''),
      content: REACT_VITE_TEMPLATE.entry.content,
    },
    ...Object.entries(REACT_VITE_TEMPLATE.extraFiles ?? {}).map(([path, content]) => ({
      path: path.replace(/^\/+/, ''),
      content,
    })),
  ],
};

const VITE8_PRESET: Preset = {
  id: 'vite8',
  label: 'Vite 8 (Rolldown)',
  category: 'Live preview',
  icon: 'rocket',
  mode: 'real-vite',
  setup: 'instant',
  templateId: 'vite8',
  blurb: 'Vite 8 + Rolldown WASI dev server, production build, and preview.',
  glyph: { text: 'V8', color: '#E8D44D' },
  tag: { text: 'instant', tone: 'live' },
  openFiles: ['src/main.js'],
  files: [{ path: 'src/main.js', content: REAL_VITE_SOURCE }],
};

/**
 * Fullstack demo (node-server template, see the node-server template ADR):
 * The opened tabs are ordinary seeded files. The server entry is just one file
 * in the preset bundle; public assets mirror the worker-seeded `extraFiles` so
 * both realms show the same project.
 */
const EXPRESS_SQLITE_PRESET: Preset = {
  id: 'express-sqlite',
  label: 'Express + SQLite',
  category: 'Live preview',
  icon: 'layers',
  mode: 'real-vite',
  setup: 'from-scratch',
  templateId: EXPRESS_SQLITE_TEMPLATE.id,
  blurb: 'A client-server app: real Express from npm, SQLite-as-WASM behind node:sqlite.',
  glyph: { text: 'EX', color: '#7FB7E8' },
  tag: { text: 'npm install', tone: 'slow' },
  openFiles: ['src/main.js', 'public/index.html', 'public/client.js'],
  files: [
    {
      path: EXPRESS_SQLITE_TEMPLATE.entry.relativePath.replace(/^\/+/, ''),
      content: EXPRESS_SQLITE_SERVER_SOURCE,
    },
    ...Object.entries(EXPRESS_SQLITE_TEMPLATE.extraFiles).map(([path, content]) => ({
      path: path.replace(/^\/+/, ''),
      content,
    })),
  ],
};

/**
 * Socket Lab: runnable capability matrix for the browser socket stack. Passing
 * rows exercise real HTTP/WebSocket/stream semantics; ceiling rows pass only by
 * surfacing the directed loud error.
 */
const SOCKET_LAB_PRESET: Preset = {
  id: 'socket-lab',
  label: 'Socket Lab',
  category: 'Live preview',
  icon: 'terminal',
  mode: 'real-vite',
  setup: 'from-scratch',
  templateId: SOCKET_LAB_TEMPLATE.id,
  blurb: 'HTTP/WebSocket lab over the browser port registry, with raw-socket ceilings marked.',
  glyph: { text: 'SO', color: '#80C7FF' },
  tag: { text: 'npm install', tone: 'slow' },
  openFiles: ['src/main.js', 'public/client.js', 'README.md'],
  files: [
    {
      path: SOCKET_LAB_TEMPLATE.entry.relativePath.replace(/^\/+/, ''),
      content: SOCKET_LAB_SERVER_SOURCE,
    },
    ...Object.entries(SOCKET_LAB_TEMPLATE.extraFiles).map(([path, content]) => ({
      path: path.replace(/^\/+/, ''),
      content,
    })),
  ],
};

const HONO_API_PRESET: Preset = {
  id: 'hono-api',
  label: 'Hono API',
  category: 'Live preview',
  icon: 'terminal',
  mode: 'real-vite',
  setup: 'from-scratch',
  templateId: HONO_API_TEMPLATE.id,
  blurb: 'A middleware-style API: Hono ctx routes, JSON bodies, and VFS-served assets.',
  glyph: { text: 'HN', color: '#F6C768' },
  tag: { text: 'npm install', tone: 'slow' },
  openFiles: ['public/index.html', 'public/client.js'],
  files: [
    {
      path: HONO_API_TEMPLATE.entry.relativePath.replace(/^\/+/, ''),
      content: HONO_API_TEMPLATE.entry.content,
    },
    ...Object.entries(HONO_API_TEMPLATE.extraFiles).map(([path, content]) => ({
      path: path.replace(/^\/+/, ''),
      content,
    })),
  ],
};

const KOA_API_PRESET: Preset = {
  id: 'koa-api',
  label: 'Koa API',
  category: 'Live preview',
  icon: 'terminal',
  mode: 'real-vite',
  setup: 'from-scratch',
  templateId: KOA_API_TEMPLATE.id,
  blurb: 'A ctx-first API: Koa middleware, router params, cookies, and JSON bodies.',
  glyph: { text: 'KOA', color: '#93E08F' },
  tag: { text: 'npm install', tone: 'slow' },
  openFiles: ['public/index.html', 'public/client.js'],
  files: [
    {
      path: KOA_API_TEMPLATE.entry.relativePath.replace(/^\/+/, ''),
      content: KOA_API_TEMPLATE.entry.content,
    },
    ...Object.entries(KOA_API_TEMPLATE.extraFiles).map(([path, content]) => ({
      path: path.replace(/^\/+/, ''),
      content,
    })),
  ],
};

const CLI_REPORT_PRESET: Preset = {
  id: 'cli-report',
  label: 'CLI report',
  category: 'Live preview',
  icon: 'terminal',
  mode: 'real-vite',
  setup: 'from-scratch',
  templateId: CLI_REPORT_TEMPLATE.id,
  blurb: 'A run-to-completion Node CLI: npm dependency, VFS input, stdout, exit code.',
  glyph: { text: 'CLI', color: '#9BD060' },
  tag: { text: 'npm install', tone: 'slow' },
  openFiles: ['data/packages.yml', 'README.md'],
  files: [
    {
      path: CLI_REPORT_TEMPLATE.entry.relativePath.replace(/^\/+/, ''),
      content: CLI_REPORT_TEMPLATE.entry.content,
    },
    ...Object.entries(CLI_REPORT_TEMPLATE.extraFiles).map(([path, content]) => ({
      path: path.replace(/^\/+/, ''),
      content,
    })),
  ],
};

const MARKDOWN_SSG_PRESET: Preset = {
  id: 'markdown-ssg',
  label: 'Markdown SSG',
  category: 'Live preview',
  icon: 'file-output',
  mode: 'real-vite',
  setup: 'from-scratch',
  templateId: MARKDOWN_SSG_TEMPLATE.id,
  blurb: 'A filesystem-heavy static-site build: markdown in, generated HTML out.',
  glyph: { text: 'MD', color: '#8BD3FF' },
  tag: { text: 'npm install', tone: 'slow' },
  openFiles: ['content/intro.md', 'content/runtime.md'],
  files: [
    {
      path: MARKDOWN_SSG_TEMPLATE.entry.relativePath.replace(/^\/+/, ''),
      content: MARKDOWN_SSG_TEMPLATE.entry.content,
    },
    ...Object.entries(MARKDOWN_SSG_TEMPLATE.extraFiles).map(([path, content]) => ({
      path: path.replace(/^\/+/, ''),
      content,
    })),
  ],
};

export const PRESETS: readonly Preset[] = [
  PROJECT_FILES_PRESET,
  NODE_WORKER_PRESET,
  TYPESCRIPT_LS_PRESET,
  REAL_VITE_PRESET,
  VITE8_PRESET,
  EXPRESS_SQLITE_PRESET,
  SOCKET_LAB_PRESET,
  HONO_API_PRESET,
  KOA_API_PRESET,
  CLI_REPORT_PRESET,
  MARKDOWN_SSG_PRESET,
];

/** The preset selected at boot. Its files/openFiles seed the initial workspace tabs. */
export const DEFAULT_PRESET: Preset = PROJECT_FILES_PRESET;

/**
 * The terminal lines that boot a preset (ADR-0135). BOTH setup kinds boot the
 * template's dev line; the instant/from-scratch difference lives in the WORKER
 * realm (carried over `RIFTY_RFV_SETUP`), not in the page boot lines.
 *
 * from-scratch's visible `npm install` runs INSIDE the worker — the realm that
 * owns the OPFS tree the preview is served from — streamed to the terminal
 * (per-package lines, ADR-0134). It cannot run on the page: the page realm is
 * memory-backed (sync OPFS is worker-only), so a page-side install would land
 * in a store the preview never reads. Single source for first boot AND
 * preset-switch restart.
 */
export function presetBootLines(preset: Preset, root: string): readonly string[] {
  const spec = preset.templateId ? resolveProjectSpec(preset.templateId) : defaultProjectSpec();
  const dev = terminalDevLine(spec, root);
  // instant: node_modules is pre-seeded from the baked snapshot (owner-seed), so the
  // dev line just runs. from-scratch is Node-faithful — an EXPLICIT `npm install`
  // populates node_modules first (the dev line never installs as a side effect; a
  // bare `npm run dev` without it fails with a real "Cannot find module"). `dev` may
  // carry a leading `cd <root> &&` (node templates) — strip it; cwd is pinned once.
  if (preset.setup !== 'from-scratch') return [dev];
  const bareDev = dev.replace(/^cd \S+ && /, '');
  return [`cd ${root} && npm install && ${bareDev}`];
}

/** Category render order in the gallery. */
export const CATEGORY_ORDER: readonly string[] = ['Files + modules', 'Live preview'];
