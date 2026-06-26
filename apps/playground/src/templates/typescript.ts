import type { ViteProjectSpec } from './project-spec.ts';
import { VITE_TEMPLATE } from './vite.ts';

export const TYPESCRIPT_ENTRY_SOURCE = `import type { LibraryShape } from '@rifty/example-types';
import './styles.css';
import { formatWidgetName } from './format';
import { clamp } from './math';
import { WIDGET_THEME, defineWidget, type Widget } from './model';

const renderUrl = new URL('src/render.ts', window.location.href).href;
let renderVersion = 0;

function freshUrl(url: string): string {
  if (!import.meta.hot) return url;
  const separator = url.includes('?') ? '&' : '?';
  return url + separator + 't=' + Date.now() + '-' + renderVersion;
}

const remoteShape: LibraryShape = {
  id: 'node_modules/@rifty/example-types',
  labels: ['declaration', 'go-to-definition', 'hover'],
};

export const typecheckTarget = {
  id: 'ts-language-service',
  title: 'TypeScript language surface',
  count: 3,
  tags: ['rename', 'references', 'quick-fix'],
  meta: { source: remoteShape.id },
} satisfies Widget;

async function renderApp(): Promise<void> {
  renderVersion += 1;
  const { renderWidget } = await import(/* @vite-ignore */ freshUrl(renderUrl));
  const widget = defineWidget({
    ...typecheckTarget,
    count: clamp(Number(typecheckTarget.count), 0, 99),
  });
  renderWidget(widget, {
    shape: remoteShape,
    theme: WIDGET_THEME,
  });
}

if (Math.random() < 0) {
  console.log(formatWidgetName(typecheckTarget.title));
}

await renderApp();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.accept(['./render.ts', './math.ts', './model.ts', './styles.css'], () => {
    void renderApp();
  });
}
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useDefineForClassFields": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "node_modules/@rifty/example-types/index.d.ts"]
}
`;

const MODEL_TS = `export type WidgetStatus = 'draft' | 'ready';

export interface Widget {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly tags: readonly string[];
  readonly meta: {
    readonly source: string;
  };
  readonly status?: WidgetStatus;
}

export const WIDGET_THEME = 'rifty-ts';

export function defineWidget(widget: Widget): Widget {
  return widget;
}
`;

const MATH_TS = `export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function scaleProgress(value: number, total: number): number {
  if (total <= 0) return 0;
  return clamp(Math.round((value / total) * 100), 0, 100);
}
`;

const RENDER_TS = `import type { LibraryShape } from '@rifty/example-types';
import { scaleProgress } from './math';
import type { Widget } from './model';

export interface RenderOptions {
  readonly shape: LibraryShape;
  readonly theme: string;
}

export function renderWidget(widget: Widget, options: RenderOptions): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app root');

  const score = scaleProgress(widget.count, 5);
  app.innerHTML =
    '<main class="ts-shell" data-theme="' + options.theme + '">' +
    '<p class="eyebrow">' + options.shape.labels.join(' / ') + '</p>' +
    '<h1>' + widget.title + '</h1>' +
    '<meter min="0" max="100" value="' + score + '"></meter>' +
    '<ul>' + widget.tags.map((tag) => '<li>' + tag + '</li>').join('') + '</ul>' +
    '<code>' + widget.meta.source + '</code>' +
    '</main>';
}
`;

const FORMAT_TS = `export function formatWidgetName(value: string): string {
  return value.trim().replace(/\\s+/g, '-').toLowerCase();
}
`;

const STYLES_CSS = `body {
  margin: 0;
  background: #101218;
  color: rgba(255, 255, 255, 0.86);
  font: 13px/19px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.ts-shell {
  display: grid;
  gap: 14px;
  max-width: 680px;
  padding: 28px;
}

.eyebrow {
  color: #8fe3c0;
  font-size: 11px;
  margin: 0;
  text-transform: uppercase;
}

h1 {
  font-size: 25px;
  line-height: 32px;
  margin: 0;
}

meter {
  width: min(320px, 100%);
}

ul {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

li {
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  padding: 6px 8px;
}

code {
  color: #dff7ad;
}
`;

const EXAMPLE_TYPES_PACKAGE_JSON = `{
  "name": "@rifty/example-types",
  "version": "1.0.0",
  "types": "index.d.ts"
}
`;

const EXAMPLE_TYPES_DTS = `declare module '@rifty/example-types' {
  export interface LibraryShape {
    readonly id: string;
    readonly labels: readonly string[];
  }

  export function summarizeShape(shape: LibraryShape): string;
}
`;

export const TYPESCRIPT_TEMPLATE = {
  id: 'typescript',
  displayName: 'TypeScript sandbox',
  runtime: 'vite',
  install: VITE_TEMPLATE.install,
  devDependencies: { typescript: '5.9.3' },
  bakedNodeModulesUrl: '/snapshots/typescript-node-modules.json.gz',
  runtimeSpecifier: 'vite',
  entry: { relativePath: '/src/main.ts', content: TYPESCRIPT_ENTRY_SOURCE },
  defaultPort: 5174,
  estimatedBootSeconds: 20,
  htmlTitle: 'rifty + TypeScript',
  extraFiles: {
    '/tsconfig.json': TSCONFIG_JSON,
    '/src/model.ts': MODEL_TS,
    '/src/math.ts': MATH_TS,
    '/src/render.ts': RENDER_TS,
    '/src/format.ts': FORMAT_TS,
    '/src/styles.css': STYLES_CSS,
    '/node_modules/@rifty/example-types/package.json': EXAMPLE_TYPES_PACKAGE_JSON,
    '/node_modules/@rifty/example-types/index.d.ts': EXAMPLE_TYPES_DTS,
  },
  server: {
    appType: 'spa',
    strictPort: true,
    optimizeDepsDisabled: true,
    host: true,
    allowedHosts: true,
  },
  hmr: { enabled: true },
} satisfies ViteProjectSpec;
