/**
 * Runtime-agnostic description of a "real npm project" template (ADR-0078).
 * Worker bootstrap, page-realm orchestrator, and mode machine are driven off
 * this value object instead of inline Vite literals, so a second runnable
 * template is a data change rather than a worker fork.
 *
 * Pure data + pure mapping function: no DOM, no channels, no solid-js (glue
 * altitude). Only `id` crosses a realm boundary (over env as
 * `RIFTY_RFV_TEMPLATE`); each realm re-resolves the full spec locally.
 */

/** Serializable subset of Vite's `createServer` knobs the worker reconstructs.
 *  Non-serializable plugin instances (the HMR-bridge plugin) are NOT here — the
 *  worker builds them from {@link ProjectSpec.hmr} after resolving the spec. */
export interface ServerSpec {
  readonly appType: string;
  readonly strictPort: boolean;
  readonly optimizeDepsDisabled: boolean;
  readonly host: boolean;
  readonly allowedHosts: boolean;
}

export interface ProjectEntry {
  /** Root-relative entry path with a leading slash (e.g. `/src/main.js`). */
  readonly relativePath: string;
  /** Initial entry-file contents, seeded before the editor source overwrites it. */
  readonly content: string;
}

export interface ProjectSpec {
  /** Stable template key — the only field that crosses realms (over env). */
  readonly id: string;
  /** Generic UI label, replaces the hardcoded "Real Vite". */
  readonly displayName: string;
  /** npm dependencies to install into the worker-local node_modules. */
  readonly install: Readonly<Record<string, string>>;
  /** Dynamic-`import()` specifier the worker loads to get the dev server. */
  readonly runtimeSpecifier: string;
  readonly entry: ProjectEntry;
  readonly defaultPort: number;
  readonly estimatedBootSeconds: number;
  /** `<title>` for the seeded index.html. */
  readonly htmlTitle: string;
  readonly server: ServerSpec;
  readonly hmr: { readonly enabled: boolean };
}

export interface BootstrapConfig {
  readonly root: string;
  readonly port: number;
  readonly entryPath: string;
  readonly runtimeSpecifier: string;
  /** npm package name/version passed to `install()` (derived from the id). */
  readonly packageName: string;
  readonly packageVersion: string;
  readonly installDeps: Readonly<Record<string, string>>;
  /** Serialized package.json written into the project root. */
  readonly packageJson: string;
  readonly server: ServerSpec;
  readonly hmrEnabled: boolean;
  /** Absolute-path → contents map the worker seeds idempotently. */
  readonly seedFiles: Readonly<Record<string, string>>;
}

/**
 * The `<script>` src is RELATIVE and DERIVED from the entry path, so seeded
 * HTML always agrees with the declared entry without escaping the routed
 * `/preview/<port>/` base.
 */
function buildIndexHtml(title: string, entryRelativePath: string): string {
  const scriptSrc = entryRelativePath.replace(/^\/+/, '');
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>${title}</title></head>
  <body>
    <div id="app"></div>
    <script type="module" src="${scriptSrc}"></script>
  </body>
</html>`;
}

export function buildProjectPackageJson(spec: ProjectSpec): {
  readonly name: string;
  readonly version: string;
  readonly json: string;
} {
  const name = `rifty-${spec.id}-app`;
  const version = '0.0.0';
  const json = `${JSON.stringify(
    {
      name,
      version,
      private: true,
      type: 'module',
      scripts: { dev: 'vite', vite: 'vite' },
      dependencies: spec.install,
    },
    null,
    2,
  )}\n`;
  return { name, version, json };
}

/**
 * Pure mapping: ProjectSpec + resolved port/root → the config the worker
 * bootstrap feeds to `install()` / `createServer()` / the seed step. Unit-tested
 * seam where entry/package.json/index.html drift surfaces as a red test rather
 * than a silent "works for vite, breaks for the next template".
 */
export function resolveBootstrapConfig(
  spec: ProjectSpec,
  port: number,
  root: string,
): BootstrapConfig {
  const entryPath = `${root}${spec.entry.relativePath}`;
  const pkg = buildProjectPackageJson(spec);
  const seedFiles: Record<string, string> = {
    [`${root}/index.html`]: buildIndexHtml(spec.htmlTitle, spec.entry.relativePath),
    [entryPath]: spec.entry.content,
    [`${root}/package.json`]: pkg.json,
  };
  return {
    root,
    port,
    entryPath,
    runtimeSpecifier: spec.runtimeSpecifier,
    packageName: pkg.name,
    packageVersion: pkg.version,
    installDeps: spec.install,
    packageJson: pkg.json,
    server: spec.server,
    hmrEnabled: spec.hmr.enabled,
    seedFiles,
  };
}
