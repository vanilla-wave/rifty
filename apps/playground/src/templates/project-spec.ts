/**
 * Runtime-agnostic description of a "real npm project" template (ADR-0078).
 * Worker bootstrap, page-realm orchestrator, and mode machine are driven off
 * this value object instead of inline Vite literals, so a second runnable
 * template is a data change rather than a worker fork.
 *
 * Runtimes (discriminated on `runtime`):
 * - `'vite'` — the shell runs the installed `.bin/vite`; the worker seeds an
 *   index.html and visible Vite config for it.
 * - `'node-server'` — the worker imports the ENTRY itself; the entry is a
 *   long-running Node program (e.g. Express) that calls `listen(port)` and
 *   serves its own HTML. No index.html is seeded — it would shadow the server.
 * - `'node-cli'` — the worker imports the ENTRY itself; the entry runs to
 *   completion and exits without a preview port.
 * - `'npm-dev-server'` — npm runs the project-owned `scripts.dev`; the
 *   installed package owns its HTTP/WebSocket server and preview port.
 *
 * Pure data + pure mapping function: no DOM, no channels, no solid-js (glue
 * altitude). Only `id` crosses a realm boundary (over env as
 * `RIFTY_RFV_TEMPLATE`); each realm re-resolves the full spec locally.
 */

import { serializePackageJson } from '@riftydev/npm-client';

interface BootstrapConfigBase {
  readonly root: string;
  readonly entryPath: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly installDeps: Readonly<Record<string, string>>;
  readonly packageJson: string;
  readonly seedFiles: Readonly<Record<string, string>>;
  readonly bakedNodeModulesUrl?: string;
  readonly bakedNodeModulesTemplateId?: string;
}

export interface ViteBootstrapConfig extends BootstrapConfigBase {
  readonly runtime: 'vite';
  readonly port: number;
}

export interface NodeServerBootstrapConfig extends BootstrapConfigBase {
  readonly runtime: 'node-server';
  readonly port: number;
}

export interface NodeCliBootstrapConfig extends BootstrapConfigBase {
  readonly runtime: 'node-cli';
}

export interface NpmDevServerBootstrapConfig extends BootstrapConfigBase {
  readonly runtime: 'npm-dev-server';
}

export type BootstrapConfig =
  | ViteBootstrapConfig
  | NodeServerBootstrapConfig
  | NodeCliBootstrapConfig
  | NpmDevServerBootstrapConfig;

export interface ProjectEntry {
  /** Root-relative entry path with a leading slash (e.g. `/src/main.js`). */
  readonly relativePath: string;
  /** Template entry-file contents; presets may overwrite this path via files[]. */
  readonly content: string;
}

interface ProjectSpecBase {
  /** Stable template key — the only field that crosses realms (over env). */
  readonly id: string;
  /** Generic UI label, replaces the hardcoded "Real Vite". */
  readonly displayName: string;
  /** npm dependencies to install into the worker-local node_modules. */
  readonly install: Readonly<Record<string, string>>;
  /** npm devDependencies to install into the worker-local node_modules. */
  readonly devDependencies?: Readonly<Record<string, string>>;
  /**
   * Extra package.json `scripts` seeded verbatim (e.g. a Vite template's own
   * `build`/`preview`). Never a dev alias: the derived dev names always win,
   * and only they boot the co-resident dev server ({@link isDevScriptName}).
   */
  readonly scripts?: Readonly<Record<string, string>>;
  /** Defaults to ESM; `false` omits `type` for an ordinary CommonJS package. */
  readonly packageType?: 'module' | false;
  readonly entry: ProjectEntry;
  readonly defaultPort: number;
  readonly estimatedBootSeconds: number;
  /**
   * Same-origin URL of the baked node_modules snapshot (ADR-0135), produced by
   * `pnpm snapshots:bake`. When set and no install stamp matches, the worker
   * restores this tree instead of running `install()`. Runtime-asset
   * availability is separate (ADR-0320). Absent → install as usual.
   */
  readonly bakedNodeModulesUrl?: string;
  /** SHA-256 of the exact uncompressed serialized v3 snapshot bytes. */
  readonly bakedNodeModulesSnapshotId?: string;
  /**
   * Template id recorded inside the baked snapshot. Defaults to this spec's id;
   * set when a template deliberately shares another template's node_modules tree.
   */
  readonly bakedNodeModulesTemplateId?: string;
}

/** Template whose installed Vite CLI owns dev/build/preview behavior. */
export interface ViteProjectSpec extends ProjectSpecBase {
  readonly runtime: 'vite';
  /** `<title>` for the seeded index.html. */
  readonly htmlTitle: string;
  /** Root-relative files seeded before Vite starts (tsconfig, sibling modules, .d.ts fixtures). */
  readonly extraFiles?: Readonly<Record<string, string>>;
}

interface NodeProjectSpecBase extends ProjectSpecBase {
  /** Root-relative extra files the WORKER seeds BEFORE the server starts
   *  (e.g. `/public/*` for `express.static`) — page-side preset sync is too
   *  late for assets the first preview request already needs. */
  readonly extraFiles: Readonly<Record<string, string>>;
}

/** Template whose worker runs the entry as a long-running Node server program. */
export interface NodeServerProjectSpec extends NodeProjectSpecBase {
  readonly runtime: 'node-server';
}

/** Template whose worker runs the entry once and surfaces output in the terminal. */
export interface NodeCliProjectSpec extends NodeProjectSpecBase {
  readonly runtime: 'node-cli';
}

/** Template whose package.json `dev` script owns a long-running preview server. */
export interface NpmDevServerProjectSpec extends NodeProjectSpecBase {
  readonly runtime: 'npm-dev-server';
  /** Exact package.json `scripts.dev` body. */
  readonly devCommand: string;
}

export type ProjectSpec =
  | ViteProjectSpec
  | NodeServerProjectSpec
  | NodeCliProjectSpec
  | NpmDevServerProjectSpec;

const NODEMON_VERSION = '3.1.14';
const NODEMON_DEV_COMMAND = 'nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js';

/**
 * The `<script>` src is RELATIVE and DERIVED from the entry path, so seeded
 * HTML always agrees with the declared entry without escaping the routed
 * `/preview/<port>/` base.
 */
function buildIndexHtml(title: string, entryRelativePath: string): string {
  const scriptSrc = entryRelativePath.replace(/^\/+/, '');
  // Paint the dark preview bg from the FIRST frame: Vite still full-reloads for
  // HTML/config/non-accepted boundaries, before entry JS can style the body.
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>${title}</title><style>html,body{margin:0;background:#101218}</style></head>
  <body>
    <div id="app"></div>
    <script type="module" src="${scriptSrc}"></script>
  </body>
</html>`;
}

/**
 * Exact package.json `dev` body: installed nodemon for the three pinned server
 * templates, otherwise the runtime's direct command.
 */
export function devScriptCommand(spec: ProjectSpec): string {
  if (spec.runtime === 'vite') return 'vite';
  if (spec.runtime === 'npm-dev-server') return spec.devCommand;
  if (spec.runtime === 'node-server' && spec.install.nodemon === NODEMON_VERSION) {
    return NODEMON_DEV_COMMAND;
  }
  return `node ${spec.entry.relativePath.replace(/^\/+/, '')}`;
}

/**
 * Is `name` one of the seeded auto-boot aliases? Runtime execution still
 * selects from the exact resolved script body, not this name. A template's own
 * `scripts` (build/preview) are deliberately NOT dev aliases — `npm run build`
 * must never boot the dev server.
 */
export function isDevScriptName(spec: ProjectSpec, name: string): boolean {
  return Object.hasOwn(devScriptAliases(spec), name);
}

/**
 * The visible terminal line the playground runs to boot a template — the real
 * `vite` CLI with only the template's preferred port for vite templates, `npm run dev`
 * (resolved through the seeded package.json script) for node servers. The node
 * line is `cd <root> && …`-pinned: `npm run` reads package.json from the
 * SESSION cwd, and the auto-boot session may have a persisted/user cwd outside
 * the project.
 */
export function terminalDevLine(spec: ProjectSpec, root: string): string {
  // TODO(backlog: playground/vite-strictport-fallback-proof): browser-prove that
  // Vite's selected fallback port becomes rifty's LIVE/preview port.
  if (spec.runtime === 'vite') return `vite --port ${spec.defaultPort}`;
  return `cd ${root} && npm run dev`;
}

/**
 * The auto-boot aliases derived from the spec. Node projects keep `start` on
 * the direct entry while `dev` may deliberately select an installed supervisor.
 */
function devScriptAliases(spec: ProjectSpec): Record<string, string> {
  const dev = devScriptCommand(spec);
  if (spec.runtime === 'vite') return { dev, vite: dev };
  if (spec.runtime === 'npm-dev-server') return { dev };
  const start = `node ${spec.entry.relativePath.replace(/^\/+/, '')}`;
  return { dev, start };
}

/**
 * package.json `scripts` for a spec: the template's own scripts first, then the
 * derived dev aliases — the aliases win, so a template can never redefine the
 * line the playground boots.
 */
export function projectScripts(spec: ProjectSpec): Record<string, string> {
  return { ...spec.scripts, ...devScriptAliases(spec) };
}

const GIT_INIT_CONFIG = `[core]
\trepositoryformatversion = 0
\tfilemode = false
\tbare = false
\tlogallrefupdates = true
\tsymlinks = false
\tignorecase = true
`;

const PROJECT_GITIGNORE = `node_modules/
dist/
.vite/
.rifty/
*.log
`;

function initializedGitFiles(root: string): Record<string, string> {
  return {
    [`${root}/.git/HEAD`]: 'ref: refs/heads/main\n',
    [`${root}/.git/config`]: GIT_INIT_CONFIG,
    [`${root}/.gitignore`]: PROJECT_GITIGNORE,
  };
}

export function buildProjectPackageJson(spec: ProjectSpec): {
  readonly name: string;
  readonly version: string;
  readonly json: string;
} {
  const name = `rifty-${spec.id}-app`;
  const version = '0.0.0';
  const scripts = projectScripts(spec);
  const json = serializePackageJson({
    name,
    version,
    private: true,
    ...(spec.packageType === false ? {} : { type: 'module' }),
    scripts,
    dependencies: spec.install,
    ...(spec.devDependencies ? { devDependencies: spec.devDependencies } : {}),
  });
  return { name, version, json };
}

function addExtraFiles(
  seedFiles: Record<string, string>,
  root: string,
  extraFiles: Readonly<Record<string, string>>,
): void {
  for (const [relPath, content] of Object.entries(extraFiles)) {
    // Tolerate a missing leading slash — `${root}public/x` would silently
    // seed a sibling of root and express.static/Vite would 404 with no hint.
    const rel = relPath.startsWith('/') ? relPath : `/${relPath}`;
    seedFiles[`${root}${rel}`] = content;
  }
}

/**
 * Pure mapping: ProjectSpec + resolved port/root → the config the worker
 * bootstrap uses for package.json seeding and the seed step.
 * Unit-tested seam where entry/package.json/index.html drift surfaces as a red
 * test rather than a silent "works for vite, breaks for the next template".
 */
export function resolveBootstrapConfig(
  spec: ProjectSpec,
  port: number,
  root: string,
): BootstrapConfig {
  const entryPath = `${root}${spec.entry.relativePath}`;
  const pkg = buildProjectPackageJson(spec);
  const base = {
    root,
    entryPath,
    packageName: pkg.name,
    packageVersion: pkg.version,
    installDeps: spec.install,
    packageJson: pkg.json,
    ...(spec.bakedNodeModulesUrl ? { bakedNodeModulesUrl: spec.bakedNodeModulesUrl } : {}),
    ...(spec.bakedNodeModulesTemplateId
      ? { bakedNodeModulesTemplateId: spec.bakedNodeModulesTemplateId }
      : {}),
  };
  if (
    spec.runtime === 'node-server' ||
    spec.runtime === 'node-cli' ||
    spec.runtime === 'npm-dev-server'
  ) {
    const seedFiles: Record<string, string> = {
      ...initializedGitFiles(root),
      [entryPath]: spec.entry.content,
      [`${root}/package.json`]: pkg.json,
    };
    addExtraFiles(seedFiles, root, spec.extraFiles);
    if (spec.runtime === 'npm-dev-server') {
      return {
        ...base,
        runtime: 'npm-dev-server',
        seedFiles,
      } satisfies NpmDevServerBootstrapConfig;
    }
    if (spec.runtime === 'node-cli') {
      return { ...base, runtime: 'node-cli', seedFiles } satisfies NodeCliBootstrapConfig;
    }
    return {
      ...base,
      runtime: 'node-server',
      port,
      seedFiles,
    } satisfies NodeServerBootstrapConfig;
  }
  const seedFiles: Record<string, string> = {
    ...initializedGitFiles(root),
    [`${root}/index.html`]: buildIndexHtml(spec.htmlTitle, spec.entry.relativePath),
    [entryPath]: spec.entry.content,
    [`${root}/package.json`]: pkg.json,
  };
  addExtraFiles(seedFiles, root, spec.extraFiles ?? {});
  return {
    ...base,
    runtime: 'vite',
    port,
    seedFiles,
  } satisfies ViteBootstrapConfig;
}
