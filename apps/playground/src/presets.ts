import {
  EXPRESS_SQLITE_SERVER_SOURCE,
  EXPRESS_SQLITE_TEMPLATE,
  defaultProjectSpec,
  resolveProjectSpec,
  terminalDevLine,
} from '@riftydev/workbench';
import type { IconName } from './components/icons.tsx';
import { MONO_FONT_STACK } from './glue/fonts.ts';

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
  /** Workspace-relative path written next to src/main.js when this preset loads. */
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
   * resolved via `@riftydev/workbench`. Omitted means the default template.
   */
  readonly templateId?: string;
  /** One-line description shown under the label. */
  readonly blurb: string;
  /** Mono badge in the template switcher (e.g. `JS` in template yellow). */
  readonly glyph?: { readonly text: string; readonly color: string };
  /** Optional pill (e.g. "live", "~20s") shown next to the label. */
  readonly tag?: { readonly text: string; readonly tone: 'live' | 'slow' };
  /** Editor source loaded when the preset is selected. */
  readonly source: string;
  /** Additional project files written into /workspace for this preset. */
  readonly files?: readonly PresetFile[];
  /** Workspace-relative files opened as inactive editor tabs when this preset loads. */
  readonly openFiles?: readonly string[];
}

const PROJECT_FILES_SOURCE = `const projectUrl = new URL('src/project.json?import', window.location.href).href;
const summaryUrl = new URL('src/project-summary.js', window.location.href).href;
const { describeProject, formatFileList } = await import(/* @vite-ignore */ summaryUrl);
const project = (await import(/* @vite-ignore */ projectUrl)).default;

const style = document.createElement('style');
style.textContent = 'body{margin:0;background:#101218;color:rgba(255,255,255,.85);font-family:${MONO_FONT_STACK}}.workspace-shell{max-width:720px;padding:28px}.eyebrow{color:#c7f05a;font:600 10px/12px ${MONO_FONT_STACK};letter-spacing:.2em;margin:0 0 10px;text-transform:uppercase}h1{font:600 26px/32px ${MONO_FONT_STACK};letter-spacing:0;color:rgba(255,255,255,.92);margin:0 0 8px}h2{font:600 15px/20px ${MONO_FONT_STACK};color:rgba(255,255,255,.85);margin:24px 0 0}.lede{color:rgba(255,255,255,.55);font-size:13px;line-height:19px;max-width:520px;margin:0}.file-list{display:grid;gap:8px;list-style:none;padding:0;margin:14px 0 0}.file-list li{border:1px solid rgba(255,255,255,.09);border-radius:8px;display:grid;gap:2px;padding:11px 13px}.file-list span{color:rgba(255,255,255,.5);font-size:11.5px;line-height:16px}code{color:#dff7ad;font:400 12px/16px ${MONO_FONT_STACK}}';
document.head.append(style);

const app = document.getElementById('app');
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

const NODE_WORKER_SOURCE = `const notesUrl = new URL('src/runtime-notes.js', window.location.href).href;
const { runtimeNotes, renderRuntimeNotes } = await import(/* @vite-ignore */ notesUrl);

const style = document.createElement('style');
style.textContent = 'body{margin:0;background:#101218;color:rgba(255,255,255,.85);font-family:${MONO_FONT_STACK}}.workspace-shell{max-width:720px;padding:28px}.eyebrow{color:#c7f05a;font:600 10px/12px ${MONO_FONT_STACK};letter-spacing:.2em;margin:0 0 10px;text-transform:uppercase}h1{font:600 26px/32px ${MONO_FONT_STACK};letter-spacing:0;color:rgba(255,255,255,.92);margin:0 0 8px}h2{font:600 15px/20px ${MONO_FONT_STACK};color:rgba(255,255,255,.85);margin:24px 0 0}.lede{color:rgba(255,255,255,.55);font-size:13px;line-height:19px;max-width:520px;margin:0}.file-list{display:grid;gap:8px;list-style:none;padding:0;margin:14px 0 0}.file-list li{border:1px solid rgba(255,255,255,.09);border-radius:8px;display:grid;gap:2px;padding:11px 13px}.file-list span{color:rgba(255,255,255,.5);font-size:11.5px;line-height:16px}code{color:#dff7ad;font:400 12px/16px ${MONO_FONT_STACK}}';
document.head.append(style);

const app = document.getElementById('app');
app.innerHTML = '<main class="workspace-shell">'
  + '<p class="eyebrow">Node-shaped project</p>'
  + '<h1>Worker runtime map</h1>'
  + '<p class="lede">This example points at the Node-style pieces Rifty uses while the preview stays an ordinary browser render.</p>'
  + '<section><h2>What to inspect</h2>'
  + '<ul class="file-list">' + renderRuntimeNotes(runtimeNotes) + '</ul></section>'
  + '</main>';
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
// dev server and previews it live. The default template is Vite (vite@^5);
// later runs reuse the tarball cache and the stamped node_modules.
//
// This is your app entry, served by the dev server at /src/main.js.

document.getElementById('app').innerHTML =
  '<h1>A real npm project, in your browser.</h1>' +
  '<p>This page is served by an actual dev server - its packages installed from' +
  ' npm, running in a Worker, previewed through the rifty SW bridge.</p>';

document.body.style.margin = '0';
document.body.style.padding = '3rem';
document.body.style.background = '#101218';
document.body.style.color = '#e6e6e6';
document.body.style.fontFamily = ${JSON.stringify(MONO_FONT_STACK)};
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
  source: PROJECT_FILES_SOURCE,
  openFiles: ['src/project-summary.js', 'src/project.json'],
  files: [
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
  source: NODE_WORKER_SOURCE,
  openFiles: ['src/runtime-notes.js', 'scripts/inspect-workspace.mjs'],
  files: [
    { path: 'src/runtime-notes.js', content: RUNTIME_NOTES_SOURCE },
    { path: 'src/workspace.css', content: WORKSPACE_CSS_SOURCE },
    { path: 'scripts/inspect-workspace.mjs', content: INSPECT_WORKSPACE_SOURCE },
    { path: 'README.md', content: NODE_README },
  ],
};

const REAL_VITE_PRESET: Preset = {
  id: 'real-vite',
  label: 'Real npm project',
  category: 'Live preview',
  icon: 'rocket',
  mode: 'real-vite',
  setup: 'from-scratch',
  templateId: 'vite',
  blurb: 'Runs a visible npm install in the terminal, then boots the Vite dev server.',
  glyph: { text: 'V', color: '#5FCE96' },
  tag: { text: 'npm install', tone: 'slow' },
  source: REAL_VITE_SOURCE,
};

/**
 * Fullstack demo (node-server template, see the node-server template ADR):
 * the editor program is the SERVER entry; explorer files mirror the template's
 * worker-seeded `extraFiles` so both realms show the same project.
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
  source: EXPRESS_SQLITE_SERVER_SOURCE,
  openFiles: ['public/index.html', 'public/client.js'],
  files: Object.entries(EXPRESS_SQLITE_TEMPLATE.extraFiles).map(([path, content]) => ({
    path: path.replace(/^\/+/, ''),
    content,
  })),
};

export const PRESETS: readonly Preset[] = [
  PROJECT_FILES_PRESET,
  NODE_WORKER_PRESET,
  REAL_VITE_PRESET,
  EXPRESS_SQLITE_PRESET,
];

/** The preset selected at boot. Its source is the default editor content. */
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
  return [terminalDevLine(spec, root)];
}

/** Category render order in the gallery. */
export const CATEGORY_ORDER: readonly string[] = ['Files + modules', 'Live preview'];
